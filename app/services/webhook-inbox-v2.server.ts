import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  canonicalQueuePayload,
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  QueueIdempotencyConflictError,
} from "./job-outbox.server";
import {
  normalizeShopifyFinancialSnapshotV2,
  type ShopifyFinancialSnapshotV2,
} from "./financial-v2";
import { reconcileCanonicalFinancialOrderV2 } from "./financial-ledger-v2.server";
import {
  assertOrderNotSuppressed,
  PrivacyOrderSuppressedError,
} from "./order-privacy-guard.server";

const FINANCIAL_TOPICS = new Set([
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "REFUNDS_CREATE",
]);
const FINANCIAL_JOB_TYPES = ["RECONCILE_ORDER", "RECONCILE_REFUND"];
const DEFAULT_INBOX_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;

type InboxDb = PrismaClient | Prisma.TransactionClient;

function retryDelay(attempts: number) {
  return Math.min(60 * 60_000, 1_000 * 2 ** Math.max(1, attempts));
}

function processableInbox(now: Date) {
  return {
    OR: [
      {
        processingState: { in: ["PENDING", "RETRY"] },
        nextAttemptAt: { lte: now },
      },
      {
        processingState: "PROCESSING",
        processingLeaseUntil: { lte: now },
      },
    ],
  };
}

function boundedIdentifier(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const candidate = String(value).trim();
  return /^[A-Za-z0-9_:/.-]{1,200}$/.test(candidate) ? candidate : null;
}

function shopifyGid(kind: "Order" | "Refund", value: unknown) {
  const candidate = boundedIdentifier(value);
  if (!candidate) return null;
  if (candidate.startsWith(`gid://shopify/${kind}/`)) return candidate;
  return /^[0-9]+$/.test(candidate)
    ? `gid://shopify/${kind}/${candidate}`
    : null;
}

function optionalTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function topicName(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

export function sanitizeFinancialWebhookV2(
  topicValue: string,
  payloadValue: unknown,
) {
  const topic = topicName(topicValue);
  if (!FINANCIAL_TOPICS.has(topic))
    throw new Error("Unsupported financial webhook topic.");
  if (
    !payloadValue ||
    typeof payloadValue !== "object" ||
    Array.isArray(payloadValue)
  )
    throw new Error("Financial webhook payload is invalid.");
  const payload = payloadValue as Record<string, unknown>;
  const orderId = shopifyGid(
    "Order",
    topic === "REFUNDS_CREATE"
      ? (payload.order_id ?? payload.orderId)
      : (payload.admin_graphql_api_id ?? payload.id),
  );
  const resourceId = shopifyGid(
    topic === "REFUNDS_CREATE" ? "Refund" : "Order",
    payload.admin_graphql_api_id ?? payload.id,
  );
  if (!orderId || !resourceId)
    throw new Error(
      "Financial webhook is missing its canonical resource identity.",
    );
  const sourceOccurredAt = optionalTimestamp(
    payload.updated_at ?? payload.processed_at ?? payload.created_at,
  );
  return {
    topic,
    sourceOccurredAt,
    payload: {
      schemaVersion: 2,
      topic,
      orderId,
      resourceId,
      sourceOccurredAt: sourceOccurredAt?.toISOString() ?? null,
    },
  };
}

export async function acceptFinancialWebhookV2(args: {
  db: PrismaClient;
  shop: string;
  topic: string;
  shopifyEventId: string;
  payload: unknown;
  receivedAt?: Date;
}) {
  const eventId = boundedIdentifier(args.shopifyEventId);
  if (!eventId) throw new Error("Shopify webhook identity is invalid.");
  const merchant = await args.db.merchant.findUnique({
    where: { shop: args.shop },
  });
  if (!merchant) throw new Error("Webhook store is not installed.");
  const sanitized = sanitizeFinancialWebhookV2(args.topic, args.payload);
  const payloadJson = canonicalQueuePayload(sanitized.payload);
  const jobType =
    sanitized.topic === "REFUNDS_CREATE"
      ? "RECONCILE_REFUND"
      : "RECONCILE_ORDER";

  return args.db.$transaction(async (tx) => {
    await assertOrderNotSuppressed({
      tx,
      merchantId: merchant.id,
      orderId: sanitized.payload.orderId,
    });
    const existing = await tx.webhookInbox.findUnique({
      where: {
        merchantId_shopifyEventId: {
          merchantId: merchant.id,
          shopifyEventId: eventId,
        },
      },
    });
    if (existing) {
      if (
        existing.topic !== sanitized.topic ||
        existing.payloadJson !== payloadJson
      )
        throw new QueueIdempotencyConflictError();
      return { inbox: existing, duplicate: true };
    }
    const inbox = await tx.webhookInbox.create({
      data: {
        merchantId: merchant.id,
        shopifyEventId: eventId,
        topic: sanitized.topic,
        sourceOccurredAt: sanitized.sourceOccurredAt,
        receivedAt: args.receivedAt,
        payloadSchemaVersion: 2,
        payloadJson,
      },
    });
    await enqueueJob({
      db: tx,
      merchantId: merchant.id,
      type: jobType,
      idempotencyKey: `webhook:${eventId}`,
      payloadSchemaVersion: 2,
      payload: { inboxId: inbox.id, orderId: sanitized.payload.orderId },
    });
    return { inbox, duplicate: false };
  });
}

export async function markFinancialWebhookProcessedV2(args: {
  db: InboxDb;
  merchantId: string;
  inboxId: string;
  leaseToken: string;
  processedAt?: Date;
}) {
  const processedAt = args.processedAt ?? new Date();
  const updated = await args.db.webhookInbox.updateMany({
    where: {
      id: args.inboxId,
      merchantId: args.merchantId,
      processingState: "PROCESSING",
      processingLeaseToken: args.leaseToken,
      processingLeaseUntil: { gt: processedAt },
    },
    data: {
      processingState: "PROCESSED",
      processedAt,
      processingLeaseToken: null,
      processingLeaseUntil: null,
      lastErrorCode: null,
    },
  });
  if (updated.count !== 1) throw new Error("STALE_WEBHOOK_INBOX_LEASE");
}

async function claimFinancialWebhookInboxV2(args: {
  db: PrismaClient;
  merchantId: string;
  inboxId: string;
  workerId: string;
  now: Date;
  leaseMs: number;
  maxAttempts: number;
}) {
  return args.db.$transaction(async (tx) => {
    const current = await tx.webhookInbox.findFirst({
      where: { id: args.inboxId, merchantId: args.merchantId },
    });
    if (!current) throw new Error("WEBHOOK_INBOX_NOT_FOUND");
    if (
      current.processingState === "PROCESSED" ||
      current.processingState === "SUPPRESSED"
    ) {
      return { duplicate: true as const, inbox: current, leaseToken: null };
    }
    if (current.attempts >= args.maxAttempts) {
      const exhausted = await tx.webhookInbox.updateMany({
        where: {
          id: current.id,
          merchantId: args.merchantId,
          attempts: { gte: args.maxAttempts },
          ...processableInbox(args.now),
        },
        data: {
          processingState: "DEAD_LETTER",
          processingLeaseToken: null,
          processingLeaseUntil: null,
          lastErrorCode: "ATTEMPTS_EXHAUSTED",
        },
      });
      if (exhausted.count === 1) {
        const priorIncident = await tx.incident.findFirst({
          where: {
            merchantId: args.merchantId,
            status: "OPEN",
            category: "FINANCIAL_RECONCILIATION_DEAD_LETTER",
            detailsJson: { contains: current.id },
          },
        });
        if (!priorIncident) {
          await tx.incident.create({
            data: {
              merchantId: args.merchantId,
              severity: "SEV2",
              category: "FINANCIAL_RECONCILIATION_DEAD_LETTER",
              summary:
                "A Shopify financial event exhausted automatic reconciliation retries.",
              detailsJson: canonicalQueuePayload({ inboxId: current.id }),
              actor: "SYSTEM",
            },
          });
        }
      }
      return { duplicate: false as const, inbox: current, leaseToken: null };
    }
    const leaseToken = `${args.workerId}:${randomUUID()}`;
    const claimed = await tx.webhookInbox.updateMany({
      where: {
        id: current.id,
        merchantId: args.merchantId,
        attempts: { lt: args.maxAttempts },
        ...processableInbox(args.now),
      },
      data: {
        processingState: "PROCESSING",
        attempts: { increment: 1 },
        processingLeaseToken: leaseToken,
        processingLeaseUntil: new Date(args.now.getTime() + args.leaseMs),
        lastErrorCode: null,
      },
    });
    if (claimed.count !== 1) throw new Error("WEBHOOK_INBOX_NOT_CLAIMABLE");
    return {
      duplicate: false as const,
      inbox: await tx.webhookInbox.findUniqueOrThrow({
        where: { id: current.id },
      }),
      leaseToken,
    };
  });
}

async function scheduleFinancialWebhookRetryV2(args: {
  db: PrismaClient;
  merchantId: string;
  inbox: Awaited<ReturnType<typeof claimFinancialWebhookInboxV2>>["inbox"];
  leaseToken: string;
  orderId: string;
  reason: string;
  now: Date;
}) {
  const retryAt = new Date(
    args.now.getTime() + retryDelay(args.inbox.attempts),
  );
  return args.db.$transaction(async (tx) => {
    const released = await tx.webhookInbox.updateMany({
      where: {
        id: args.inbox.id,
        merchantId: args.merchantId,
        processingState: "PROCESSING",
        processingLeaseToken: args.leaseToken,
        processingLeaseUntil: { gt: args.now },
      },
      data: {
        processingState: "RETRY",
        nextAttemptAt: retryAt,
        processingLeaseToken: null,
        processingLeaseUntil: null,
        lastErrorCode: args.reason.slice(0, 120),
      },
    });
    if (released.count !== 1) throw new Error("STALE_WEBHOOK_INBOX_LEASE");
    const jobType =
      args.inbox.topic === "REFUNDS_CREATE"
        ? "RECONCILE_REFUND"
        : "RECONCILE_ORDER";
    await enqueueJob({
      db: tx,
      merchantId: args.merchantId,
      type: jobType,
      idempotencyKey: `inbox-retry:${args.inbox.id}:${args.inbox.attempts}`,
      payloadSchemaVersion: 2,
      payload: { inboxId: args.inbox.id, orderId: args.orderId },
      nextRunAt: retryAt,
    });
    return retryAt;
  });
}

async function renewFinancialWebhookLeaseV2(args: {
  db: PrismaClient;
  merchantId: string;
  inboxId: string;
  leaseToken: string;
  now: Date;
  leaseMs: number;
}) {
  const renewed = await args.db.webhookInbox.updateMany({
    where: {
      id: args.inboxId,
      merchantId: args.merchantId,
      processingState: "PROCESSING",
      processingLeaseToken: args.leaseToken,
      processingLeaseUntil: { gt: args.now },
    },
    data: {
      processingLeaseUntil: new Date(args.now.getTime() + args.leaseMs),
    },
  });
  if (renewed.count !== 1) throw new Error("STALE_WEBHOOK_INBOX_LEASE");
}

export async function processFinancialWebhookInboxV2(args: {
  db: PrismaClient;
  merchantId: string;
  inboxId: string;
  assignmentSecret: string;
  fetchOrder: (orderId: string) => Promise<ShopifyFinancialSnapshotV2>;
  now?: Date;
  workerId?: string;
  leaseMs?: number;
  maxAttempts?: number;
  leaseClock?: () => Date;
}) {
  const now = args.now ?? new Date();
  const leaseClock =
    args.leaseClock ?? (args.now ? () => args.now! : () => new Date());
  const leaseMs = Math.min(
    5 * 60_000,
    Math.max(1_000, args.leaseMs ?? DEFAULT_INBOX_LEASE_MS),
  );
  const maxAttempts = Math.min(
    100,
    Math.max(1, args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
  );
  const claimed = await claimFinancialWebhookInboxV2({
    db: args.db,
    merchantId: args.merchantId,
    inboxId: args.inboxId,
    workerId: args.workerId ?? "financial-inline",
    now,
    leaseMs,
    maxAttempts,
  });
  if (claimed.duplicate) return { duplicate: true as const };
  if (!claimed.leaseToken) throw new Error("WEBHOOK_INBOX_ATTEMPTS_EXHAUSTED");
  const leaseToken = claimed.leaseToken;
  try {
    const inbox = claimed.inbox;
    const payload = JSON.parse(inbox.payloadJson) as { orderId?: unknown };
    if (typeof payload.orderId !== "string")
      throw new Error("INBOX_PAYLOAD_INVALID");
    const source = await args.fetchOrder(payload.orderId);
    if (
      source.merchantId !== args.merchantId ||
      source.orderId !== payload.orderId
    )
      throw new Error("FETCHED_ORDER_SCOPE_MISMATCH");
    const reconciliationStartedAt = leaseClock();
    await renewFinancialWebhookLeaseV2({
      db: args.db,
      merchantId: args.merchantId,
      inboxId: inbox.id,
      leaseToken,
      now: reconciliationStartedAt,
      leaseMs,
    });
    const order = normalizeShopifyFinancialSnapshotV2(source);
    const result = await reconcileCanonicalFinancialOrderV2({
      db: args.db,
      merchantId: args.merchantId,
      order,
      assignmentSecret: args.assignmentSecret,
      assertAuthority: async (tx) => {
        const checkedAt = leaseClock();
        const authorized = await tx.webhookInbox.updateMany({
          where: {
            id: inbox.id,
            merchantId: args.merchantId,
            processingState: "PROCESSING",
            processingLeaseToken: leaseToken,
            processingLeaseUntil: { gt: checkedAt },
          },
          data: { processingLeaseToken: leaseToken },
        });
        if (authorized.count !== 1)
          throw new Error("STALE_WEBHOOK_INBOX_LEASE");
      },
    });
    const completedAt = leaseClock();
    const terminalTestOnly =
      result.order.reconciliationState === "TEST_ONLY" &&
      order.unresolvedReasons.length === 0;
    if (
      (result.order.reconciliationState !== "RECONCILED" &&
        !terminalTestOnly) ||
      result.conflicts.length > 0
    ) {
      const retryAt = await scheduleFinancialWebhookRetryV2({
        db: args.db,
        merchantId: args.merchantId,
        inbox,
        leaseToken,
        orderId: payload.orderId,
        reason: result.conflicts.length
          ? "FINANCIAL_ATTRIBUTION_CONFLICT"
          : "FINANCIAL_RECONCILIATION_PENDING",
        now: completedAt,
      });
      return {
        duplicate: false as const,
        result,
        retryScheduled: true as const,
        retryAt,
      };
    }
    await markFinancialWebhookProcessedV2({
      db: args.db,
      merchantId: args.merchantId,
      inboxId: args.inboxId,
      leaseToken,
      processedAt: completedAt,
    });
    return {
      duplicate: false as const,
      result,
      retryScheduled: false as const,
    };
  } catch (error) {
    if (error instanceof PrivacyOrderSuppressedError) {
      const acknowledgedAt = leaseClock();
      const acknowledged = await args.db.webhookInbox.updateMany({
        where: {
          id: args.inboxId,
          merchantId: args.merchantId,
          processingState: "PROCESSING",
          processingLeaseToken: leaseToken,
          processingLeaseUntil: { gt: acknowledgedAt },
        },
        data: {
          processingState: "SUPPRESSED",
          payloadJson: "{}",
          processedAt: acknowledgedAt,
          processingLeaseToken: null,
          processingLeaseUntil: null,
          lastErrorCode: "PRIVACY_ORDER_SUPPRESSED",
        },
      });
      if (acknowledged.count !== 1)
        throw new Error("STALE_WEBHOOK_INBOX_LEASE");
      return {
        duplicate: false as const,
        suppressed: true as const,
        retryScheduled: false as const,
      };
    }
    const errorCode =
      error instanceof Error
        ? error.message.replace(/[^A-Z0-9_]+/gi, "_").slice(0, 120)
        : "FINANCIAL_RECONCILIATION_FAILED";
    const failedAt = leaseClock();
    await args.db.webhookInbox.updateMany({
      where: {
        id: args.inboxId,
        merchantId: args.merchantId,
        processingState: "PROCESSING",
        processingLeaseToken: leaseToken,
        processingLeaseUntil: { gt: failedAt },
      },
      data: {
        processingState: "RETRY",
        processingLeaseToken: null,
        processingLeaseUntil: null,
        lastErrorCode: errorCode,
        nextAttemptAt: new Date(
          failedAt.getTime() + retryDelay(claimed.inbox.attempts),
        ),
      },
    });
    throw error;
  }
}

export async function runFinancialReconciliationJobsV2(args: {
  db: PrismaClient;
  merchantId: string;
  workerId: string;
  assignmentSecret: string;
  fetchOrder: (orderId: string) => Promise<ShopifyFinancialSnapshotV2>;
  now?: Date;
  limit?: number;
}) {
  const now = args.now ?? new Date();
  const jobs = await claimJobs({
    db: args.db,
    workerId: args.workerId,
    merchantId: args.merchantId,
    types: FINANCIAL_JOB_TYPES,
    now,
    limit: args.limit ?? 25,
  });
  const outcomes = [];
  for (const job of jobs) {
    try {
      const payload = JSON.parse(job.payloadJson) as { inboxId?: unknown };
      if (typeof payload.inboxId !== "string")
        throw new Error("JOB_PAYLOAD_INVALID");
      const result = await processFinancialWebhookInboxV2({
        db: args.db,
        merchantId: args.merchantId,
        inboxId: payload.inboxId,
        assignmentSecret: args.assignmentSecret,
        fetchOrder: args.fetchOrder,
        workerId: args.workerId,
        now: args.now,
      });
      await completeJob({
        db: args.db,
        merchantId: args.merchantId,
        jobId: job.id,
        leaseToken: job.leaseToken!,
        resultRef: result.duplicate
          ? "INBOX_DUPLICATE"
          : result.retryScheduled
            ? `INBOX_RETRY:${result.retryAt.toISOString()}`
            : "INBOX_PROCESSED",
        now: args.now ?? new Date(),
      });
      outcomes.push({
        jobId: job.id,
        ok: true,
        resultRef: result.duplicate
          ? "DUPLICATE"
          : result.retryScheduled
            ? "RETRY_SCHEDULED"
            : "PROCESSED",
      });
    } catch (error) {
      const errorCode =
        error instanceof Error
          ? error.message.replace(/[^A-Z0-9_]+/gi, "_").slice(0, 120)
          : "FINANCIAL_RECONCILIATION_FAILED";
      try {
        await failJob({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          leaseToken: job.leaseToken!,
          errorCode,
          now: args.now ?? new Date(),
        });
      } catch {
        // A replacement worker owns an expired/reclaimed lease.
      }
      outcomes.push({ jobId: job.id, ok: false, errorCode });
    }
  }
  return outcomes;
}

import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { prepareAutopilotOpportunity } from "./autopilot-preparation.server";
import { syncProducts } from "./governance.server";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
} from "./job-outbox.server";
import {
  ensureCurrentPixelEndpoint,
  type AdminGraphql,
} from "./measurement-reliability.server";

export const AUTOPILOT_PREPARATION_JOB = "AUTOPILOT_PREPARATION";
const MAX_ATTEMPTS = 5;

type PreparationPayload = {
  shop: string;
  endpoint: string;
  preferredProductId: string | null;
  cutoverReceiptId: string | null;
};

function parsePayload(value: string): PreparationPayload {
  const parsed = JSON.parse(value) as Partial<PreparationPayload>;
  if (
    typeof parsed.shop !== "string" ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(parsed.shop) ||
    typeof parsed.endpoint !== "string" ||
    (parsed.preferredProductId !== null &&
      (typeof parsed.preferredProductId !== "string" ||
        !/^[A-Za-z0-9:_-]{1,160}$/.test(parsed.preferredProductId))) ||
    (parsed.cutoverReceiptId != null &&
      (typeof parsed.cutoverReceiptId !== "string" ||
        !/^[A-Za-z0-9:_-]{1,160}$/.test(parsed.cutoverReceiptId)))
  ) throw new Error("AUTOPILOT_PREPARATION_PAYLOAD_INVALID");
  const endpoint = new URL(parsed.endpoint);
  const local = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(endpoint.hostname);
  if (
    endpoint.pathname !== "/storefront/events" ||
    endpoint.search || endpoint.hash ||
    (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:"))
  ) throw new Error("AUTOPILOT_PREPARATION_ENDPOINT_INVALID");
  return {
    shop: parsed.shop,
    endpoint: endpoint.toString(),
    preferredProductId: parsed.preferredProductId ?? null,
    cutoverReceiptId: parsed.cutoverReceiptId ?? null,
  };
}

function preparationKey(payload: PreparationPayload) {
  const scope = createHash("sha256")
    .update(
      `${payload.endpoint}\n${payload.preferredProductId ?? "auto"}\n${payload.cutoverReceiptId ?? "legacy"}`,
    )
    .digest("hex")
    .slice(0, 24);
  return `autopilot-preparation:v1:${scope}`;
}

async function assertPreparationAuthority(args: {
  db: PrismaClient | Prisma.TransactionClient;
  merchantId: string;
  jobId: string;
  leaseToken: string;
  now: Date;
}) {
  // Runtime authority is always locked before the job lease. Uninstall follows
  // the same order, so either this unit finishes first and uninstall neutralizes
  // it, or the worker observes the uninstall and performs no serving mutation.
  const control = await args.db.runtimeControl.upsert({
    where: { merchantId: args.merchantId },
    create: { merchantId: args.merchantId },
    update: { merchantId: args.merchantId },
  });
  if (control.killSwitch && /uninstall/i.test(control.reason ?? ""))
    throw new Error("AUTOPILOT_PREPARATION_INACTIVE");
  const current = await args.db.job.updateMany({
    where: {
      id: args.jobId,
      merchantId: args.merchantId,
      status: "RUNNING",
      leaseToken: args.leaseToken,
      leaseUntil: { gt: args.now },
    },
    data: { merchantId: args.merchantId },
  });
  if (current.count !== 1) throw new Error("STALE_JOB_LEASE");
}

export async function enqueueAutopilotPreparation(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  endpoint: string;
  preferredProductId?: string | null;
  cutoverReceiptId?: string | null;
  explicitRetry?: boolean;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const payload = parsePayload(JSON.stringify({
    shop: args.shop,
    endpoint: args.endpoint,
    preferredProductId: args.preferredProductId ?? null,
    cutoverReceiptId: args.cutoverReceiptId ?? null,
  }));
  return args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findFirst({
      where: { id: args.merchantId, shop: payload.shop },
      select: { id: true },
    });
    if (!merchant) throw new Error("AUTOPILOT_PREPARATION_TENANT_MISMATCH");
    const control = await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    if (control.killSwitch && /uninstall/i.test(control.reason ?? ""))
      throw new Error("AUTOPILOT_PREPARATION_INACTIVE");
    const job = await enqueueJob({
      db: tx,
      merchantId: args.merchantId,
      type: AUTOPILOT_PREPARATION_JOB,
      idempotencyKey: preparationKey(payload),
      payload,
      nextRunAt: now,
    });
    if (!args.explicitRetry || !["COMPLETED", "DEAD_LETTER"].includes(job.status))
      return job;
    const retried = await tx.job.updateMany({
      where: {
        id: job.id,
        merchantId: args.merchantId,
        status: { in: ["COMPLETED", "DEAD_LETTER"] },
      },
      data: {
        status: "RETRY",
        attempts: 0,
        nextRunAt: now,
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: null,
        resultRef: null,
      },
    });
    return retried.count === 1
      ? tx.job.findUniqueOrThrow({ where: { id: job.id } })
      : job;
  });
}

async function recordFailure(args: {
  db: PrismaClient;
  merchantId: string;
  jobId: string;
  errorCode: string;
  terminal: boolean;
  now: Date;
}) {
  await Promise.all([
    args.db.merchantNotice.upsert({
      where: {
        merchantId_dedupeKey: {
          merchantId: args.merchantId,
          dedupeKey: `autopilot-preparation:${args.jobId}`,
        },
      },
      create: {
        merchantId: args.merchantId,
        dedupeKey: `autopilot-preparation:${args.jobId}`,
        kind: "PREPARATION_FAILED",
        title: args.terminal
          ? "Pagnetic preparation needs a retry"
          : "Pagnetic will retry preparation",
        detail: args.terminal
          ? "Preparation reached its retry limit. Use Prepare opportunity to authorize one new attempt chain."
          : "The original storefront is unchanged while Pagnetic retries the failed preparation step.",
        actionLabel: args.terminal ? "Prepare opportunity" : null,
        actionHref: "/app",
        metadataJson: JSON.stringify({ jobId: args.jobId, errorCode: args.errorCode }),
      },
      update: {
        status: "OPEN",
        title: args.terminal
          ? "Pagnetic preparation needs a retry"
          : "Pagnetic will retry preparation",
        detail: args.terminal
          ? "Preparation reached its retry limit. Use Prepare opportunity to authorize one new attempt chain."
          : "The original storefront is unchanged while Pagnetic retries the failed preparation step.",
        actionLabel: args.terminal ? "Prepare opportunity" : null,
        metadataJson: JSON.stringify({ jobId: args.jobId, errorCode: args.errorCode }),
        resolvedAt: null,
      },
    }),
    args.db.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: "system:autopilot-preparation-worker",
        action: "autopilot_preparation_failed",
        resourceType: "JOB",
        resourceId: args.jobId,
        detailsJson: JSON.stringify({ errorCode: args.errorCode, terminal: args.terminal }),
        createdAt: args.now,
      },
    }),
  ]);
}

export async function runAutopilotPreparationJobs(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  graphql: AdminGraphql;
  workerId: string;
  now?: Date;
  clock?: () => Date;
  limit?: number;
}) {
  const claimNow = args.now ?? new Date();
  const jobs = await claimJobs({
    db: args.db,
    merchantId: args.merchantId,
    workerId: args.workerId,
    types: [AUTOPILOT_PREPARATION_JOB],
    limit: args.limit ?? 2,
    leaseMs: 5 * 60_000,
    maxAttempts: MAX_ATTEMPTS,
    now: claimNow,
  });
  const outcomes: Array<{
    jobId: string;
    ok: boolean;
    resultRef?: string | null;
    errorCode?: string;
  }> = [];
  for (const job of jobs) {
    const leaseToken = job.leaseToken!;
    const authorityNow = () => args.clock?.() ?? new Date();
    const assertActive = (db: PrismaClient | Prisma.TransactionClient) =>
      assertPreparationAuthority({
        db,
        merchantId: args.merchantId,
        jobId: job.id,
        leaseToken,
        now: authorityNow(),
      });
    try {
      const payload = parsePayload(job.payloadJson);
      if (payload.shop !== args.shop)
        throw new Error("AUTOPILOT_PREPARATION_TENANT_MISMATCH");
      const merchant = await args.db.merchant.findFirst({
        where: { id: args.merchantId, shop: args.shop },
        select: { id: true },
      });
      if (!merchant) throw new Error("AUTOPILOT_PREPARATION_TENANT_MISMATCH");
      await assertActive(args.db);

      const productCount = await args.db.product.count({
        where: { merchantId: args.merchantId },
      });
      if (!productCount || payload.cutoverReceiptId) {
        await syncProducts({
          db: args.db,
          shop: args.shop,
          actor: "system:autopilot-preparation-worker",
          graphql: (query) => args.graphql(query),
          assertActive,
        });
      }
      await assertActive(args.db);
      const [currentPlan, candidateNotice] = await Promise.all([
        args.db.autopilotPlan.findFirst({
          where: { merchantId: args.merchantId, state: { not: "INVALIDATED" } },
          select: { id: true },
        }),
        args.db.merchantNotice.findFirst({
          where: {
            merchantId: args.merchantId,
            kind: "CANDIDATE_TIE",
            status: "OPEN",
          },
          select: { id: true },
        }),
      ]);
      const pendingCutover = payload.cutoverReceiptId
        ? null
        : await args.db.actionReceipt.findFirst({
            where: {
              merchantId: args.merchantId,
              action: "SELECT_TEST_STORE_V2_CUTOVER",
            },
            select: { id: true },
          });
      const prepared =
        !currentPlan &&
        !pendingCutover &&
        (!candidateNotice || payload.preferredProductId)
        ? await prepareAutopilotOpportunity({
            db: args.db,
            merchantId: args.merchantId,
            actor: "system:autopilot-preparation-worker",
            preferredProductId: payload.preferredProductId ?? undefined,
            cutoverReceiptId: payload.cutoverReceiptId ?? undefined,
            now: claimNow,
            assertActive,
          })
        : null;
      await assertActive(args.db);
      const pixel = await ensureCurrentPixelEndpoint({
        db: args.db,
        merchantId: args.merchantId,
        shop: args.shop,
        endpoint: payload.endpoint,
        graphql: args.graphql,
        assertActive,
      });
      const preparedPlanId = prepared && "plan" in prepared && prepared.plan
        ? prepared.plan.id
        : null;
      const resultRef = currentPlan?.id ?? preparedPlanId ?? pixel.credential.id;
      const completedAt = authorityNow();
      await assertActive(args.db);
      await completeJob({
        db: args.db,
        merchantId: args.merchantId,
        jobId: job.id,
        leaseToken,
        resultRef,
        now: completedAt,
      });
      await args.db.merchantNotice.updateMany({
        where: {
          merchantId: args.merchantId,
          dedupeKey: `autopilot-preparation:${job.id}`,
          status: "OPEN",
        },
        data: { status: "RESOLVED", resolvedAt: completedAt },
      });
      outcomes.push({ jobId: job.id, ok: true, resultRef });
    } catch (error) {
      const errorCode = error instanceof Error && /^[A-Z0-9_:-]{2,120}$/.test(error.message)
        ? error.message.slice(0, 120)
        : "AUTOPILOT_PREPARATION_FAILED";
      const failedAt = authorityNow();
      try {
        const failed = await failJob({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          leaseToken,
          errorCode,
          maxAttempts: MAX_ATTEMPTS,
          now: failedAt,
        });
        await recordFailure({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          errorCode,
          terminal: failed.status === "DEAD_LETTER",
          now: failedAt,
        });
      } catch (leaseError) {
        if (!(leaseError instanceof Error) || leaseError.message !== "STALE_JOB_LEASE")
          throw leaseError;
      }
      outcomes.push({ jobId: job.id, ok: false, errorCode });
    }
  }
  return outcomes;
}

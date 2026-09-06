import { createHash, createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readCustomerPrivacyScope, type CustomerPrivacyLease } from "./customer-privacy-queue.server";
import { discoverCustomerPrivacyGraph, privacyChunks, type CustomerPrivacyGraph } from "./customer-privacy-graph.server";
import { stagePrivacyIdentitySuppression } from "./identity-privacy-guard.server";
import { stagePrivacyOrderSuppression } from "./order-privacy-guard.server";
import { invalidateExperimentsForPrivacy } from "./privacy-analysis.server";
import { encryptField, decryptField } from "./field-encryption.server";
import { privacyHash } from "./privacy.server";
import { privacyLookupKeys, privacyRequestLookupSecret } from "./privacy-lookup-keys.server";
import { privacyRequestStorageSecret } from "./privacy-storage-keys.server";

const GRAPH_KIND = "ERASURE_GRAPH";
const PHASES = ["SUPPRESS", "DISCOVER", "FINANCIAL", "IDENTITY", "VERIFY"] as const;
type Phase = typeof PHASES[number];
type Progress = { version: 1; scopeHash: string; phase: Phase; cursor: number; totalOrders: number };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PRIVACY_ERASURE_PROGRESS_INVALID");
  return value as Record<string, unknown>;
}

function authority(lease: CustomerPrivacyLease, now: Date): Prisma.PrivacyRequestWhereInput {
  return { id: lease.request.id, requestType: "CUSTOMERS_REDACT", status: "PROCESSING_ORDER_SCOPE",
    leaseToken: lease.token, attempts: lease.request.attempts, leaseUntil: { gt: now }, dueAt: { gt: now }, completedAt: null,
    scopeCiphertext: lease.request.scopeCiphertext, shopHash: lease.request.shopHash,
    lookupKeyId: lease.request.lookupKeyId, scopeKeyId: lease.request.scopeKeyId };
}

function progress(details: Record<string, unknown>, scopeHash: string, total: number): Progress {
  if (!details.erasure) return { version: 1, scopeHash, phase: "SUPPRESS", cursor: 0, totalOrders: total };
  const value = object(details.erasure);
  if (value.version !== 1 || value.scopeHash !== scopeHash || value.totalOrders !== total ||
    !PHASES.includes(value.phase as Phase) || !Number.isSafeInteger(value.cursor) ||
    Number(value.cursor) < 0 || Number(value.cursor) >= total) throw new Error("PRIVACY_ERASURE_PROGRESS_INVALID");
  return value as Progress;
}

function touches(value: unknown, refs: Set<string>): boolean {
  if (typeof value === "string") return refs.has(value) ||
    value.split(/[^A-Za-z0-9_-]+/).some((token) => refs.has(token)) ||
    [...value.matchAll(/gid:\/\/shopify\/Order\/[1-9]\d*/g)].some((match) => refs.has(match[0]));
  if (Array.isArray(value)) return value.some((item) => touches(item, refs));
  return Boolean(value && typeof value === "object" && Object.values(value).some((item) => touches(item, refs)));
}

// Cursor-bounded scans of auxiliary records, with exact values rather than a
// SQL substring match that could erase order 110 when order 11 is requested.
async function removeOperationalReferences(tx: Prisma.TransactionClient, merchantId: string, graph: CustomerPrivacyGraph) {
  const refs = new Set([graph.orderId, ...graph.assignmentIds, ...graph.decisionIds,
    ...graph.eventIds, ...graph.financialRecordIds, ...graph.identities.map((item) => item.value)]);
  const tables = ["webhookInbox", "job", "outboxEvent", "auditLog", "actionReceipt"] as const;
  for (const table of tables) {
    let cursor: string | undefined;
    for (;;) {
      // Each delegate has a distinct generated signature; all five share these
      // common query fields. Select only identifier-bearing operational fields.
      const query = { where: { merchantId, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" as const }, take: 500 };
      const rows = table === "webhookInbox" ? await tx.webhookInbox.findMany({ ...query,
        select: { id: true, payloadJson: true, shopifyEventId: true } }) :
        table === "job" ? await tx.job.findMany({ ...query,
          select: { id: true, payloadJson: true, idempotencyKey: true, resultRef: true } }) :
        table === "outboxEvent" ? await tx.outboxEvent.findMany({ ...query,
          select: { id: true, payloadJson: true, aggregateId: true, idempotencyKey: true } }) :
        table === "auditLog" ? await tx.auditLog.findMany({ ...query,
          select: { id: true, detailsJson: true, resourceId: true } }) :
        await tx.actionReceipt.findMany({ ...query, select: { id: true, responseRef: true, idempotencyKey: true } });
      const targets = rows.filter((row) => Object.values(row).some((value) => {
        if (typeof value !== "string") return false;
        if (touches(value, refs)) return true;
        try { return touches(JSON.parse(value), refs); } catch { return false; }
      })).map((row) => row.id);
      // Capture the next cursor before deletion, then use id>cursor instead of
      // a removed Prisma cursor on the following page.
      for (const id of targets) refs.add(id);
      if (targets.length) {
        const where = { merchantId, id: { in: targets } };
        if (table === "webhookInbox") await tx.webhookInbox.deleteMany({ where });
        else if (table === "job") await tx.job.deleteMany({ where });
        else if (table === "outboxEvent") await tx.outboxEvent.deleteMany({ where });
        else if (table === "auditLog") await tx.auditLog.deleteMany({ where });
        else await tx.actionReceipt.deleteMany({ where });
      }
      if (rows.length < 500) break;
      const next = rows[rows.length - 1]?.id;
      if (!next || next === cursor) throw new Error("PRIVACY_ERASURE_CURSOR_INVALID");
      cursor = next;
    }
  }
}

async function revokeIntersectingCopies(tx: Prisma.TransactionClient, args: {
  shop: string; orderId: string; environment: Record<string, string | undefined>;
}) {
  const shops = privacyLookupKeys(args.environment).secrets.map((key) => privacyHash(key, args.shop));
  let after: string | undefined;
  for (;;) {
    const requests = await tx.privacyRequest.findMany({ where: { requestType: "CUSTOMERS_DATA_REQUEST",
      shopHash: { in: shops }, scopeCiphertext: { not: null }, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" }, take: 100 });
    for (const request of requests) {
      const scope = readCustomerPrivacyScope({ request,
        privacySecret: privacyRequestLookupSecret(request, args.environment),
        scopeSecret: privacyRequestStorageSecret(request, args.environment) });
      if (!scope.orderIds.includes(args.orderId)) continue;
      await tx.privacyRequest.updateMany({ where: { id: request.id, scopeCiphertext: request.scopeCiphertext },
        data: { status: request.completedAt ? "DELIVERED_COPY_REVOKED_BY_REDACTION" : "REVIEW_REQUIRED_REDACTED",
          nextRunAt: null, leaseToken: null, leaseUntil: null, lastErrorCode: "PRIVACY_COPY_REVOKED" } });
      await tx.privacyArtifactChunk.deleteMany({ where: { requestId: request.id, kind: "CUSTOMER_DATA_COPY" } });
    }
    if (requests.length < 100) return;
    after = requests[requests.length - 1].id;
  }
}

export async function processCustomerPrivacyErasureStep(args: {
  db: PrismaClient; lease: CustomerPrivacyLease; environment?: Record<string, string | undefined>; now?: Date;
}) {
  if (args.lease.request.requestType !== "CUSTOMERS_REDACT") throw new Error("PRIVACY_ERASURE_REQUEST_TYPE_INVALID");
  const environment = args.environment ?? process.env;
  const secret = privacyRequestLookupSecret(args.lease.request, environment);
  const scopeSecret = privacyRequestStorageSecret(args.lease.request, environment);
  const scope = readCustomerPrivacyScope({ request: args.lease.request, privacySecret: secret, scopeSecret });
  const scopeHash = createHmac("sha256", secret).update("pagnetic-privacy-erasure-scope-v1\0")
    .update(JSON.stringify([args.lease.request.id, scope.shop, scope.orderIds])).digest("hex");
  const previous = progress(object(JSON.parse(args.lease.request.detailsJson)), scopeHash, scope.orderIds.length);
  const suppression = previous.phase === "SUPPRESS" ? await stagePrivacyOrderSuppression({ db: args.db,
    lease: args.lease, scopeSecret, secret, offset: previous.cursor, now: args.now }) : null;
  return args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { shop: scope.shop }, select: { id: true } });
    if (merchant) await tx.runtimeControl.upsert({ where: { merchantId: merchant.id }, create: { merchantId: merchant.id }, update: { merchantId: merchant.id } });
    const locked = await tx.privacyRequest.updateMany({ where: authority(args.lease, args.now ?? new Date()),
      data: { leaseToken: args.lease.token } });
    if (locked.count !== 1) throw new Error("PRIVACY_LEASE_LOST");
    const request = await tx.privacyRequest.findUniqueOrThrow({ where: { id: args.lease.request.id } });
    const details = object(JSON.parse(request.detailsJson));
    const current = progress(details, scopeHash, scope.orderIds.length);
    const orderId = scope.orderIds[current.cursor];
    let next: Progress;
    let activeErasureVerified = false;
    if (current.phase === "SUPPRESS") {
      if (!suppression) throw new Error("PRIVACY_ERASURE_PROGRESS_INVALID");
      next = { ...current, phase: suppression.allScopeStaged ? "DISCOVER" : "SUPPRESS",
        cursor: suppression.allScopeStaged ? 0 : suppression.nextOffset };
    } else {
      if (current.phase === "DISCOVER") {
        const graph = merchant ? await discoverCustomerPrivacyGraph({ tx, merchantId: merchant.id,
          orderId, authorizedOrderIds: scope.orderIds }) : null;
        if (graph) {
          for (const ids of privacyChunks(graph.experimentIds)) await invalidateExperimentsForPrivacy(tx, {
            merchantId: merchant!.id, experimentIds: ids, now: args.now ?? new Date() });
          for (const identities of privacyChunks(graph.identities)) await stagePrivacyIdentitySuppression(tx,
            { shop: scope.shop, requestId: request.id, secret, identities });
        }
        const payloadCiphertext = encryptField({ version: 1, requestId: request.id, scopeHash,
          ordinal: current.cursor, orderId, graph }, scopeSecret);
        await tx.privacyArtifactChunk.create({ data: { requestId: request.id, kind: GRAPH_KIND,
          ordinal: current.cursor, payloadCiphertext,
          ciphertextHash: createHash("sha256").update(payloadCiphertext).digest("hex"), expiresAt: request.dueAt! } });
      } else {
        const artifact = await tx.privacyArtifactChunk.findUniqueOrThrow({ where: { requestId_kind_ordinal: {
          requestId: request.id, kind: GRAPH_KIND, ordinal: current.cursor } } });
        const envelope = artifact.payloadCiphertext.startsWith("enc:v1:") ? decryptField<{
          version: number; requestId: string; scopeHash: string; ordinal: number; orderId: string; graph: CustomerPrivacyGraph | null;
        }>(artifact.payloadCiphertext, scopeSecret) : null;
        if (!envelope || createHash("sha256").update(artifact.payloadCiphertext).digest("hex") !== artifact.ciphertextHash ||
          envelope.version !== 1 || envelope.requestId !== request.id || envelope.scopeHash !== scopeHash ||
          envelope.ordinal !== current.cursor || envelope.orderId !== orderId)
          throw new Error("PRIVACY_ERASURE_GRAPH_INVALID");
        const graph = envelope.graph;
        if (merchant && (!graph || graph.merchantId !== merchant.id)) throw new Error("PRIVACY_ERASURE_MERCHANT_CHANGED");
        if (current.phase === "FINANCIAL") {
          await revokeIntersectingCopies(tx, { shop: scope.shop, orderId, environment });
          if (merchant && graph) {
            await removeOperationalReferences(tx, merchant.id, graph);
            await tx.attributionV2.deleteMany({ where: { merchantId: merchant.id, orderLine: { order: { merchantId: merchant.id, shopifyOrderId: orderId } } } });
            await tx.refundLedger.deleteMany({ where: { merchantId: merchant.id, shopifyOrderId: orderId } });
            await tx.orderLedger.deleteMany({ where: { merchantId: merchant.id, shopifyOrderId: orderId } });
            await tx.financialOrderRevision.deleteMany({ where: { merchantId: merchant.id, shopifyOrderId: orderId } });
            await tx.storeOrder.deleteMany({ where: { merchantId: merchant.id, shopifyOrderId: orderId } });
          }
        } else if (current.phase === "IDENTITY" && merchant && graph) {
          for (const ids of privacyChunks(graph.eventIds)) await tx.commerceEvent.deleteMany({ where: { merchantId: merchant.id, id: { in: ids } } });
          for (const ids of privacyChunks(graph.assignmentIds)) {
            if (await tx.attributionV2.count({ where: { merchantId: merchant.id, assignmentId: { in: ids } } }) ||
              await tx.orderAttribution.count({ where: { merchantId: merchant.id, assignmentId: { in: ids } } }))
              throw new Error("PRIVACY_ERASURE_LINK_REMAINS");
            await tx.visitorOutcome.deleteMany({ where: { merchantId: merchant.id, assignmentId: { in: ids } } });
          }
          for (const ids of privacyChunks(graph.decisionIds)) {
            await tx.renderEvent.deleteMany({ where: { merchantId: merchant.id, decisionId: { in: ids } } });
            await tx.actionReceipt.deleteMany({ where: { merchantId: merchant.id, responseRef: { in: ids } } });
            await tx.decision.deleteMany({ where: { merchantId: merchant.id, id: { in: ids } } });
          }
          for (const ids of privacyChunks(graph.assignmentIds)) await tx.assignment.deleteMany({ where: { merchantId: merchant.id, id: { in: ids } } });
        } else if (current.phase === "VERIFY" && merchant && graph) {
          const remaining = await Promise.all([
            tx.storeOrder.count({ where: { merchantId: merchant.id, shopifyOrderId: orderId } }),
            tx.orderLedger.count({ where: { merchantId: merchant.id, shopifyOrderId: orderId } }),
            tx.refundLedger.count({ where: { merchantId: merchant.id, shopifyOrderId: orderId } }),
            tx.financialOrderRevision.count({ where: { merchantId: merchant.id, shopifyOrderId: orderId } }),
          ]);
          if (remaining.some(Boolean)) throw new Error("PRIVACY_ERASURE_RECORD_REMAINS");
          for (const ids of privacyChunks(graph.assignmentIds)) if (await tx.assignment.count({ where: { merchantId: merchant.id, id: { in: ids } } })) throw new Error("PRIVACY_ERASURE_RECORD_REMAINS");
          for (const ids of privacyChunks(graph.decisionIds)) if (await tx.decision.count({ where: { merchantId: merchant.id, id: { in: ids } } })) throw new Error("PRIVACY_ERASURE_RECORD_REMAINS");
          for (const ids of privacyChunks(graph.eventIds)) if (await tx.commerceEvent.count({ where: { merchantId: merchant.id, id: { in: ids } } })) throw new Error("PRIVACY_ERASURE_RECORD_REMAINS");
        }
      }
      const end = current.cursor + 1 === scope.orderIds.length;
      activeErasureVerified = current.phase === "VERIFY" && end;
      const nextPhase = end && !activeErasureVerified ? PHASES[PHASES.indexOf(current.phase) + 1] : current.phase;
      next = { ...current, phase: nextPhase, cursor: end ? 0 : current.cursor + 1 };
    }
    const finishedAt = args.now ?? new Date();
    const saved = await tx.privacyRequest.updateMany({ where: authority(args.lease, finishedAt), data: {
      status: activeErasureVerified ? "ACTIVE_DATA_ERASED_BACKUP_REVIEW" : "PENDING_ORDER_SCOPE",
      nextRunAt: activeErasureVerified ? null : finishedAt, attempts: 0, leaseToken: null, leaseUntil: null, lastErrorCode: null,
      detailsJson: JSON.stringify({ ...details, erasure: { ...next, state: activeErasureVerified ? "ACTIVE_GRAPH_ERASED_RETAINED_RECORDS_REVIEW_REQUIRED" : "PROCESSING",
        updatedAt: finishedAt.toISOString(), activeGraphErasureVerified: activeErasureVerified,
        retainedEncryptedScopeAndGraph: true, retainedIdentityTombstones: true,
        retainedAggregateReviewRequired: true, operationalReferenceReviewRequired: true,
        backupErasureVerified: false, offVolumeJournalVerified: false },
        activeDataErasureVerified: false, backupErasureVerified: false }),
    } });
    if (saved.count !== 1) throw new Error("PRIVACY_LEASE_LOST");
    return { phase: next.phase, cursor: next.cursor, activeGraphErasureVerified: activeErasureVerified,
      requestCompleted: false, backupErasureVerified: false };
  }, { timeout: 30_000 });
}

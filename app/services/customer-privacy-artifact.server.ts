import { createHash, createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { collectCustomerPrivacyExport } from "./customer-privacy-export.server";
import { readCustomerPrivacyScope, type CustomerPrivacyLease } from "./customer-privacy-queue.server";
import { encryptField } from "./field-encryption.server";

const KIND = "CUSTOMER_DATA_COPY";
const ARTIFACT_TTL_MS = 7 * 86_400_000;
const MAX_CHUNK_BYTES = 5 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("PRIVACY_EXPORT_PROGRESS_INVALID");
  return value as Record<string, unknown>;
}

function authority(lease: CustomerPrivacyLease, now: Date): Prisma.PrivacyRequestWhereInput {
  return {
    id: lease.request.id, requestType: "CUSTOMERS_DATA_REQUEST",
    status: "PROCESSING_ORDER_SCOPE", leaseToken: lease.token,
    attempts: lease.request.attempts, completedAt: null,
    leaseUntil: { gt: now }, dueAt: { gt: now },
    scopeCiphertext: lease.request.scopeCiphertext, shopHash: lease.request.shopHash,
    lookupKeyId: lease.request.lookupKeyId,
    scopeKeyId: lease.request.scopeKeyId,
  };
}

// One order per transaction. A saved cursor and encrypted chunk commit together;
// crashes cannot advance past missing data or exhaust retry counts on progress.
// This is collection, NOT customer delivery or verified request fulfillment.
export async function processCustomerPrivacyExportStep(args: {
  db: PrismaClient; lease: CustomerPrivacyLease; scopeSecret: string;
  privacySecret: string; now?: Date;
}) {
  if (args.lease.request.requestType !== "CUSTOMERS_DATA_REQUEST")
    throw new Error("PRIVACY_EXPORT_REQUEST_TYPE_INVALID");
  const scope = readCustomerPrivacyScope({ request: args.lease.request,
    scopeSecret: args.scopeSecret, privacySecret: args.privacySecret });
  const scopeHash = createHmac("sha256", args.privacySecret)
    .update("pagnetic-privacy-export-scope-v1\0")
    .update(JSON.stringify([args.lease.request.id, scope.shop, scope.orderIds])).digest("hex");
  return args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { shop: scope.shop }, select: { id: true } });
    // Serialize with erasure/canonical ingestion before locking request authority.
    if (merchant) await tx.runtimeControl.upsert({ where: { merchantId: merchant.id },
      create: { merchantId: merchant.id }, update: { merchantId: merchant.id } });
    const startedAt = args.now ?? new Date();
    const locked = await tx.privacyRequest.updateMany({ where: authority(args.lease, startedAt),
      data: { leaseToken: args.lease.token } });
    if (locked.count !== 1) throw new Error("PRIVACY_LEASE_LOST");
    const request = await tx.privacyRequest.findUniqueOrThrow({ where: { id: args.lease.request.id } });
    const details = object(JSON.parse(request.detailsJson));
    const progress = details.export === undefined ? null : object(details.export);
    const offset = progress ? Number(progress.nextOffset) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= scope.orderIds.length ||
      (progress && (progress.version !== 1 || progress.scopeHash !== scopeHash ||
        progress.totalOrders !== scope.orderIds.length))) throw new Error("PRIVACY_EXPORT_PROGRESS_INVALID");
    const previous = await tx.privacyArtifactChunk.aggregate({
      where: { requestId: request.id, kind: KIND },
      _count: true, _min: { ordinal: true, expiresAt: true }, _max: { ordinal: true },
    });
    if (previous._count !== offset || (offset > 0 &&
      (previous._min.ordinal !== 0 || previous._max.ordinal !== offset - 1 ||
        !previous._min.expiresAt || previous._min.expiresAt <= startedAt)))
      throw new Error("PRIVACY_EXPORT_ARTIFACT_GAP_OR_EXPIRED");
    const orderId = scope.orderIds[offset];
    const data = merchant ? await collectCustomerPrivacyExport({ tx, merchantId: merchant.id, orderIds: [orderId] }) : null;
    const envelope = {
      version: 1, requestId: request.id, scopeHash, orderOrdinal: offset, orderId,
      collectedAt: startedAt.toISOString(), export: data,
      merchantAbsentAtCollection: !merchant,
      backupSearchVerified: false, customerIdentityJoinAvailable: false,
      deliveryConfirmed: false,
    };
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_CHUNK_BYTES)
      throw new Error("PRIVACY_EXPORT_CHUNK_TOO_LARGE");
    const ciphertext = encryptField(envelope, args.scopeSecret);
    const expiresAt = new Date(Math.min(startedAt.getTime() + ARTIFACT_TTL_MS, request.dueAt!.getTime()));
    await tx.privacyArtifactChunk.create({ data: {
      requestId: request.id, kind: KIND, ordinal: offset, payloadCiphertext: ciphertext,
      ciphertextHash: createHash("sha256").update(ciphertext).digest("hex"), expiresAt,
    } });
    const finishedAt = args.now ?? new Date();
    if (previous._min.expiresAt && previous._min.expiresAt <= finishedAt)
      throw new Error("PRIVACY_EXPORT_ARTIFACT_GAP_OR_EXPIRED");
    const ready = offset + 1 === scope.orderIds.length;
    const saved = await tx.privacyRequest.updateMany({ where: authority(args.lease, finishedAt), data: {
      status: ready ? "EXPORT_READY_OWNER_DELIVERY" : "PENDING_ORDER_SCOPE",
      nextRunAt: ready ? null : finishedAt, attempts: 0, leaseToken: null, leaseUntil: null,
      lastErrorCode: null,
      detailsJson: JSON.stringify({ ...details, deliveryConfirmed: false,
        export: { version: 1, scopeHash, totalOrders: scope.orderIds.length, nextOffset: offset + 1,
          state: ready ? "ACTIVE_DATA_COLLECTED_DELIVERY_AND_SCOPE_REVIEW_REQUIRED" : "COLLECTING",
          collectedAt: finishedAt.toISOString(), expiresAt: (previous._min.expiresAt ?? expiresAt).toISOString(),
          backupSearchVerified: false, customerIdentityJoinAvailable: false } }),
    } });
    if (saved.count !== 1) throw new Error("PRIVACY_LEASE_LOST");
    return { processedOrderCount: offset + 1, totalOrders: scope.orderIds.length, readyForDelivery: ready };
  }, { timeout: 30_000 });
}

// Expiry is enforced in storage as well as future download authorization.
// A purged undelivered request remains open for explicit scope/delivery review.
export async function purgeExpiredCustomerPrivacyArtifacts(args: { db: PrismaClient; now?: Date }) {
  const now = args.now ?? new Date();
  return args.db.$transaction(async (tx) => {
    const expired = await tx.privacyArtifactChunk.findMany({ where: { kind: "CUSTOMER_DATA_COPY", expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: 100, select: { id: true, requestId: true } });
    if (!expired.length) return 0;
    // Request locks precede artifact mutations, as in the collection worker.
    await tx.privacyRequest.updateMany({ where: {
      id: { in: [...new Set(expired.map((row) => row.requestId))].sort() }, completedAt: null,
      requestType: "CUSTOMERS_DATA_REQUEST",
    }, data: { status: "REVIEW_REQUIRED_EXPORT_EXPIRED", nextRunAt: null,
      leaseToken: null, leaseUntil: null, lastErrorCode: "PRIVACY_EXPORT_EXPIRED" } });
    const result = await tx.privacyArtifactChunk.deleteMany({ where: {
      id: { in: expired.map((row) => row.id) }, expiresAt: { lte: now },
    } });
    return result.count;
  });
}

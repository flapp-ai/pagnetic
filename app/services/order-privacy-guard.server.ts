import { createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { privacyHash } from "./privacy.server";
import { assertPrivacyLookupKeyCoverage, privacyLookupKeyId, privacyLookupKeys } from "./privacy-lookup-keys.server";
import { privacyOrderIds } from "./customer-privacy-scope.server";
import { readCustomerPrivacyScope, type CustomerPrivacyLease } from "./customer-privacy-queue.server";

export class PrivacyOrderSuppressedError extends Error {
  constructor() { super("PRIVACY_ORDER_SUPPRESSED"); this.name = "PrivacyOrderSuppressedError"; }
}

export function privacyOrderHash(secret: string, orderId: string) {
  const [canonical] = privacyOrderIds([orderId]);
  return createHmac("sha256", secret).update("pagnetic-order-suppression-v1\0").update(canonical).digest("hex");
}

export async function lockMerchantPrivacy(tx: Prisma.TransactionClient, merchantId: string) {
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: { shop: true } });
  if (!merchant) throw new PrivacyOrderSuppressedError();
  await tx.runtimeControl.upsert({ where: { merchantId }, create: { merchantId }, update: { merchantId } });
  return merchant;
}

// Caller must supply its actual write transaction. Runtime -> privacy request ->
// experiment/assignment is the common order for suppression and financial work.
export async function assertOrderNotSuppressed(args: {
  tx: Prisma.TransactionClient; merchantId: string; orderId: string; secret?: string;
  environment?: Record<string, string | undefined>;
}) {
  const merchant = await lockMerchantPrivacy(args.tx, args.merchantId);
  const keys = args.secret ? { active: args.secret, secrets: [args.secret], legacy: args.secret } : privacyLookupKeys(args.environment);
  await assertPrivacyLookupKeyCoverage(args.tx, keys);
  const suppressed = await args.tx.privacyOrderSuppression.findFirst({ where: { OR: keys.secrets.map((secret) => ({
    shopHash: privacyHash(secret, merchant.shop), orderHash: privacyOrderHash(secret, args.orderId),
  })) }, select: { id: true } });
  if (suppressed) throw new PrivacyOrderSuppressedError();
}

// One bounded, replay-safe batch. A caller must finish all batches before erasure
// and persist an independent suppression journal before considering backups safe.
export async function stagePrivacyOrderSuppression(args: {
  db: PrismaClient; lease: CustomerPrivacyLease; scopeSecret: string; secret: string;
  offset?: number; now?: Date;
}) {
  const offset = args.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("PRIVACY_SCOPE_OFFSET_INVALID");
  const scope = readCustomerPrivacyScope({ request: args.lease.request, scopeSecret: args.scopeSecret, privacySecret: args.secret });
  if (args.lease.request.requestType !== "CUSTOMERS_REDACT" || offset > scope.orderIds.length)
    throw new Error("PRIVACY_SCOPE_INVALID");
  return args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { shop: scope.shop }, select: { id: true } });
    if (merchant) await tx.runtimeControl.upsert({ where: { merchantId: merchant.id },
      create: { merchantId: merchant.id }, update: { merchantId: merchant.id } });
    const now = args.now ?? new Date();
    const authorized = await tx.privacyRequest.updateMany({ where: {
      id: args.lease.request.id, requestType: "CUSTOMERS_REDACT", status: "PROCESSING_ORDER_SCOPE",
      leaseToken: args.lease.token, attempts: args.lease.request.attempts,
      leaseUntil: { gt: now }, dueAt: { gt: now }, completedAt: null,
      scopeCiphertext: args.lease.request.scopeCiphertext, shopHash: args.lease.request.shopHash,
    }, data: { leaseToken: args.lease.token } });
    if (authorized.count !== 1) throw new Error("STALE_PRIVACY_LEASE");
    for (let start = 0; start < offset; start += 500) {
      const preceding = scope.orderIds.slice(start, Math.min(offset, start + 500));
      const count = await tx.privacyOrderSuppression.count({ where: {
        shopHash: args.lease.request.shopHash,
        orderHash: { in: preceding.map((id) => privacyOrderHash(args.secret, id)) },
      } });
      if (count !== preceding.length) throw new Error("PRIVACY_SUPPRESSION_BATCH_GAP");
    }
    const batch = scope.orderIds.slice(offset, offset + 100);
    for (const orderId of batch) {
      const shopHash = args.lease.request.shopHash;
      const orderHash = privacyOrderHash(args.secret, orderId);
      await tx.privacyOrderSuppression.upsert({ where: { shopHash_orderHash: { shopHash, orderHash } },
        create: { shopHash, orderHash, requestId: args.lease.request.id, lookupKeyId: privacyLookupKeyId(args.secret) },
        update: { orderHash, lookupKeyId: privacyLookupKeyId(args.secret) } });
    }
    const finishedAt = args.now ?? new Date();
    const current = await tx.privacyRequest.findUniqueOrThrow({ where: { id: args.lease.request.id } });
    const details: unknown = JSON.parse(current.detailsJson);
    if (!details || typeof details !== "object" || Array.isArray(details)) throw new Error("PRIVACY_REQUEST_DETAILS_INVALID");
    const previous = (details as Record<string, unknown>).suppression;
    const scopeHash = createHmac("sha256", args.secret).update("pagnetic-privacy-suppression-scope-v1\0")
      .update(JSON.stringify(scope.orderIds)).digest("hex");
    const previousProgress = previous && typeof previous === "object" ? previous as Record<string, unknown> : {};
    const priorOffset = previousProgress.scopeHash === scopeHash && Number.isSafeInteger(previousProgress.nextOffset) &&
      Number(previousProgress.nextOffset) >= 0 && Number(previousProgress.nextOffset) <= scope.orderIds.length
      ? Number(previousProgress.nextOffset) : 0;
    const nextOffset = Math.max(priorOffset, offset + batch.length);
    const stillAuthorized = await tx.privacyRequest.updateMany({ where: {
      id: args.lease.request.id, status: "PROCESSING_ORDER_SCOPE", leaseToken: args.lease.token,
      attempts: args.lease.request.attempts, leaseUntil: { gt: finishedAt }, dueAt: { gt: finishedAt }, completedAt: null,
    }, data: { leaseToken: args.lease.token, detailsJson: JSON.stringify({ ...details,
      suppression: { version: 1, lookupKeyId: privacyLookupKeyId(args.secret), scopeHash,
        totalOrders: scope.orderIds.length, nextOffset, state: nextOffset === scope.orderIds.length ? "SCOPE_STAGED" : "PARTIAL",
        verifiedAt: finishedAt.toISOString(), backupJournalVerified: false } }) } });
    if (stillAuthorized.count !== 1) throw new Error("STALE_PRIVACY_LEASE");
    return { staged: batch.length, nextOffset: offset + batch.length,
      allScopeStaged: offset + batch.length === scope.orderIds.length };
  });
}

import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { encryptField } from "./field-encryption.server";
import { processCustomerPrivacyErasureStep } from "./customer-privacy-erasure.server";
import { processCustomerPrivacyExportStep } from "./customer-privacy-artifact.server";
import { readCustomerPrivacyScope, releaseCustomerPrivacyFailure } from "./customer-privacy-queue.server";
import { privacyHash, processPrivacyWebhook } from "./privacy.server";
import { privacyLookupKeyId, privacyLookupKeys, privacyRequestLookupSecret } from "./privacy-lookup-keys.server";
import { privacyRequestStorageSecret, privacyStorageKeyId, privacyStorageKeys } from "./privacy-storage-keys.server";
import { privacyReceiptInstallationHash, type PrivacyReceipt } from "./privacy-receipt.server";
import { recoveryHoldShape } from "./recovery-hold.server";
import { privacyInstallationGenerationHash } from "./privacy-installation-generation.server";
import { assertCustomerPrivacyDeliveryAudit } from "./customer-privacy-access.server";

const REQUEST_DOMAIN = "pagnetic-customer-privacy-request-v1\0";

function idempotencyKey(secret: string, shop: string, receipt: PrivacyReceipt) {
  const shopHash = privacyHash(secret, shop);
  const body = receipt.providerRequestId
    ? [shopHash, receipt.type, receipt.providerRequestId]
    : [shopHash, receipt.type, receipt.subjectHash, null, receipt.orderIds];
  return createHmac("sha256", secret).update(REQUEST_DOMAIN).update(JSON.stringify(body)).digest("hex");
}

function reviewReason(db: PrismaClient, requestId: string, code: string) {
  return db.privacyRequest.updateMany({ where: { id: requestId, completedAt: null }, data: {
    status: code === "PRIVACY_RECOVERY_DATA_REQUEST" ? "REVIEW_REQUIRED_EXPORT" : "REVIEW_REQUIRED_ERASURE",
    nextRunAt: null, leaseToken: null, leaseUntil: null, lastErrorCode: code,
  } });
}

async function ensureCustomerRequest(args: {
  db: PrismaClient; receipt: PrivacyReceipt; secret: string; environment: Record<string, string | undefined>; now: Date;
}) {
  const { db, receipt, secret, environment, now } = args;
  const key = idempotencyKey(secret, receipt.shop, receipt);
  const existing = await db.privacyRequest.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.requestType !== receipt.type || existing.subjectHash !== receipt.subjectHash || existing.shopHash !== privacyHash(secret, receipt.shop))
      throw new Error("PRIVACY_RECEIPT_SCOPE_CONFLICT");
    if (receipt.orderIds.length) {
      const storage = privacyStorageKeys(environment);
      const scopeSecret = storage.secrets.find((candidate) => privacyStorageKeyId(candidate) === existing.scopeKeyId);
      if (!scopeSecret) throw new Error("PRIVACY_STORAGE_KEY_HISTORY_MISSING");
      const scope = readCustomerPrivacyScope({ request: existing, privacySecret: secret, scopeSecret });
      if (JSON.stringify(scope.orderIds) !== JSON.stringify(receipt.orderIds)) throw new Error("PRIVACY_RECEIPT_SCOPE_CONFLICT");
    } else if (existing.scopeCiphertext !== null) {
      throw new Error("PRIVACY_RECEIPT_SCOPE_CONFLICT");
    }
    return existing;
  }
  if (!["CUSTOMERS_REDACT", "CUSTOMERS_DATA_REQUEST"].includes(receipt.type) || receipt.orderIds.length === 0)
    throw new Error("PRIVACY_RECOVERY_SCOPE_REVIEW_REQUIRED");
  const storage = privacyStorageKeys(environment);
  const merchant = await db.merchant.findUnique({ where: { shop: receipt.shop }, select: { id: true, installedAt: true } });
  const scopeCiphertext = encryptField({ version: 2, shop: receipt.shop, orderIds: receipt.orderIds,
    installationGenerationHash: merchant ? privacyInstallationGenerationHash(secret, receipt.shop, merchant) : null }, storage.active);
  try {
    return await db.privacyRequest.create({ data: {
      shopHash: privacyHash(secret, receipt.shop), requestType: receipt.type,
      subjectHash: receipt.subjectHash, idempotencyKey: key, scopeCiphertext,
      scopeKeyId: privacyStorageKeyId(storage.active), requestedAt: new Date(receipt.receivedAt),
      nextRunAt: now, dueAt: new Date(Date.parse(receipt.receivedAt) + 30 * 86_400_000),
      lookupKeyId: privacyLookupKeyId(secret), status: "PENDING_ORDER_SCOPE", detailsJson: JSON.stringify({
        scopeVersion: 2, directCustomerProfileDataStored: false, pseudonymousTelemetryStored: true,
        customerIdentityJoinAvailable: false, orderIdentifiersProvided: receipt.orderIds.length,
        orderLinkedRecordsMayExist: true, deliveryConfirmed: false, activeDataErasureVerified: false,
        backupErasureVerified: false, recoveryReceiptReplay: true,
      }),
    } });
  } catch (error) {
    const retry = await db.privacyRequest.findUnique({ where: { idempotencyKey: key } });
    if (retry) return ensureCustomerRequest(args);
    throw error;
  }
}

async function collectRequest(db: PrismaClient, requestId: string, shop: string,
  environment: Record<string, string | undefined>, now: Date) {
  const started = Date.now();
  for (let step = 0; step < 2_000 && Date.now() - started < 30_000; step += 1) {
    const stepNow = new Date(Math.max(now.getTime(), Date.now()));
    const current = await db.privacyRequest.findUnique({ where: { id: requestId } });
    if (!current) throw new Error("PRIVACY_RECOVERY_REQUEST_MISSING");
    if (current.status === "EXPORT_READY_OWNER_DELIVERY") return true;
    if (current.status === "OWNER_CONFIRMED_SECURE_DELIVERY" || current.completedAt) {
      await assertCustomerPrivacyDeliveryAudit({ db, request: current, shop, environment });
      return true;
    }
    if (current.status.startsWith("REVIEW_REQUIRED_")) return false;
    if (current.attempts >= 10) { await reviewReason(db, requestId, "PRIVACY_RECOVERY_RETRY_LIMIT"); return false; }
    if (!current.dueAt || current.dueAt <= stepNow) {
      await reviewReason(db, requestId, "PRIVACY_RECOVERY_DEADLINE");
      return false;
    }
    if (current.status === "PROCESSING_ORDER_SCOPE" && current.leaseUntil && current.leaseUntil > stepNow) return false;
    const token = randomUUID();
    const claimed = await db.privacyRequest.updateMany({ where: {
      id: requestId, requestType: "CUSTOMERS_DATA_REQUEST", completedAt: null,
      status: { in: ["PENDING_ORDER_SCOPE", "PROCESSING_ORDER_SCOPE"] }, dueAt: { gt: stepNow },
      leaseUntil: current.status === "PROCESSING_ORDER_SCOPE" ? { lte: stepNow } : undefined,
    }, data: { status: "PROCESSING_ORDER_SCOPE", leaseToken: token,
      leaseUntil: new Date(Math.min(stepNow.getTime() + 60_000, current.dueAt.getTime())),
      attempts: { increment: 1 }, nextRunAt: null } });
    if (!claimed.count) continue;
    const request = await db.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
    try {
      await processCustomerPrivacyExportStep({ db, lease: { token, request }, now: stepNow,
        scopeSecret: privacyRequestStorageSecret(request, environment),
        privacySecret: privacyRequestLookupSecret(request, environment) });
    } catch (error) {
      await releaseCustomerPrivacyFailure({ db, lease: { token, request }, code: "PRIVACY_FULFILLMENT_FAILED", now: stepNow });
      return false;
    }
  }
  throw new Error("PRIVACY_RECOVERY_STEP_LIMIT");
}

async function eraseRequest(db: PrismaClient, requestId: string, environment: Record<string, string | undefined>, now: Date) {
  const started = Date.now();
  for (let step = 0; step < 2_000 && Date.now() - started < 30_000; step += 1) {
    const stepNow = new Date(Math.max(now.getTime(), Date.now()));
    const current = await db.privacyRequest.findUnique({ where: { id: requestId } });
    if (!current) throw new Error("PRIVACY_RECOVERY_REQUEST_MISSING");
    if (current.status === "ACTIVE_DATA_ERASED_BACKUP_REVIEW") return true;
    if (current.status.startsWith("REVIEW_REQUIRED_")) return false;
    if (current.attempts >= 10) { await reviewReason(db, requestId, "PRIVACY_RECOVERY_RETRY_LIMIT"); return false; }
    if (!current.dueAt || current.dueAt <= stepNow) {
      await reviewReason(db, requestId, "PRIVACY_RECOVERY_DEADLINE");
      return false;
    }
    if (current.status === "PROCESSING_ORDER_SCOPE" && current.leaseUntil && current.leaseUntil > stepNow) return false;
    const token = randomUUID();
    const claimed = await db.privacyRequest.updateMany({ where: {
      id: requestId, completedAt: null, status: { in: ["PENDING_ORDER_SCOPE", "PROCESSING_ORDER_SCOPE"] },
      dueAt: { gt: stepNow }, leaseUntil: current.status === "PROCESSING_ORDER_SCOPE" ? { lte: stepNow } : undefined,
    }, data: { status: "PROCESSING_ORDER_SCOPE", leaseToken: token, leaseUntil: new Date(Math.min(stepNow.getTime() + 60_000, current.dueAt.getTime())), attempts: { increment: 1 }, nextRunAt: null } });
    if (!claimed.count) continue;
    const request = await db.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
    try {
      await processCustomerPrivacyErasureStep({ db, environment, now: stepNow, lease: { token, request } });
    } catch (error) {
      await releaseCustomerPrivacyFailure({ db, lease: { token, request }, code: "PRIVACY_FULFILLMENT_FAILED", now: stepNow });
      return false;
    }
  }
  throw new Error("PRIVACY_RECOVERY_STEP_LIMIT");
}

export async function replayPrivacyReceipt(args: {
  db: PrismaClient; receipt: PrivacyReceipt; receiptKey: Buffer; environment?: Record<string, string | undefined>; now?: Date;
}) {
  const environment = args.environment ?? process.env;
  const now = args.now ?? new Date();
  if (args.receipt.type === "SHOP_REDACT") {
    const merchant = await args.db.merchant.findUnique({ where: { shop: args.receipt.shop }, select: { id: true, installedAt: true } });
    if (!merchant) return { ok: true, action: "already-erased" as const };
    if (!args.receipt.installationHash || privacyReceiptInstallationHash(args.receiptKey, args.receipt.shop, merchant) !== args.receipt.installationHash) {
      return { ok: false, action: "review-reinstalled" as const };
    }
    const lookup = privacyLookupKeys(environment).secrets.find((key) => privacyLookupKeyId(key) === args.receipt.lookupKeyId);
    if (!lookup) throw new Error("PRIVACY_LOOKUP_KEY_HISTORY_MISSING");
    await processPrivacyWebhook({ db: args.db, shop: args.receipt.shop, type: "SHOP_REDACT", payload: {}, secret: lookup, now });
    return { ok: !(await args.db.merchant.findUnique({ where: { shop: args.receipt.shop }, select: { id: true } })), action: "shop-erased" as const };
  }
  const keys = privacyLookupKeys(environment).secrets;
  const lookup = keys.find((key) => privacyLookupKeyId(key) === args.receipt.lookupKeyId);
  if (!lookup) throw new Error("PRIVACY_LOOKUP_KEY_HISTORY_MISSING");
  const request = await ensureCustomerRequest({ db: args.db, receipt: args.receipt, secret: lookup, environment, now });
  if (args.receipt.type === "CUSTOMERS_DATA_REQUEST")
    return { ok: await collectRequest(args.db, request.id, args.receipt.shop, environment, now),
      action: request.status === "OWNER_CONFIRMED_SECURE_DELIVERY" ? "data-copy-delivery-authenticated" as const : "data-copy-collected" as const };
  return { ok: await eraseRequest(args.db, request.id, environment, now), action: "customer-erased" as const };
}

export async function replayPrivacyInventory(args: {
  db: PrismaClient;
  receipts: Array<{ name: string; receipt: PrivacyReceipt; key: Buffer }>;
  names: string[];
  afterNames: string[];
  environment?: Record<string, string | undefined>;
  now?: Date;
}) {
  if (JSON.stringify(args.names) !== JSON.stringify(args.afterNames)) throw new Error("PRIVACY_RECEIPT_INVENTORY_CHANGED");
  const results = [];
  for (const item of args.receipts)
    results.push({ name: item.name, ...(await replayPrivacyReceipt({ db: args.db, receipt: item.receipt, receiptKey: item.key,
      environment: args.environment, now: args.now })) });
  return { results, unresolved: results.filter((result) => !result.ok) };
}

export async function assertRecoveryHoldPresent(db: Pick<PrismaClient, "$queryRawUnsafe">) {
  const shape = await recoveryHoldShape(db);
  if (shape === "missing") throw new Error("RECOVERY_HOLD_SCHEMA_REQUIRED");
  if (shape === "legacy") throw new Error("RECOVERY_HOLD_SCHEMA_UNSUPPORTED");
  if (shape === "malformed") throw new Error("RECOVERY_HOLD_SCHEMA_MALFORMED");
  const rows = await db.$queryRawUnsafe<Array<{ id: string; state: string }>>(
    "SELECT id, state FROM \"_PagneticRecoveryHold\" ORDER BY id",
  );
  if (rows.length !== 1 || rows[0].id !== "1" || !["HELD", "READY"].includes(rows[0].state))
    throw new Error("RECOVERY_HOLD_NOT_ACTIVE");
}

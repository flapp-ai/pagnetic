import { createHash, createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decryptField, encryptField } from "./field-encryption.server";
import {
  assertPrivacyLookupKeyCoverage,
  privacyLookupKeyId,
  privacyLookupKeys,
} from "./privacy-lookup-keys.server";
import {
  assertPrivacyStorageKeyCoverage,
  privacyRequestStorageSecret,
  privacyStorageKeyId,
  privacyStorageKeys,
} from "./privacy-storage-keys.server";
import { privacyInstallationGenerationHash } from "./privacy-installation-generation.server";

export function privacyOrderIds(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 10_000)
    throw new Error("PRIVACY_ORDER_SCOPE_INVALID");
  const ids = value.map((entry) => {
    if (
      typeof entry === "number" &&
      (!Number.isSafeInteger(entry) || entry < 1)
    )
      throw new Error("PRIVACY_ORDER_ID_INVALID");
    if (typeof entry !== "number" && typeof entry !== "string")
      throw new Error("PRIVACY_ORDER_ID_INVALID");
    const match = /^(?:gid:\/\/shopify\/Order\/)?([1-9]\d{0,24})$/.exec(
      String(entry),
    );
    if (!match) throw new Error("PRIVACY_ORDER_ID_INVALID");
    return `gid://shopify/Order/${match[1]}`;
  });
  return [...new Set(ids)].sort();
}

export async function receiveCustomerPrivacyRequest(args: {
  db: PrismaClient;
  shop: string;
  shopHash: string;
  subjectHash: string | null;
  type: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT";
  payload: Record<string, unknown>;
  secret: string;
  scopeSecret?: string;
  now?: Date;
  lookupSecrets?: string[];
  scopeSecrets?: string[];
}) {
  const now = args.now ?? new Date();
  const orderIds = privacyOrderIds(
    args.payload[
      args.type === "CUSTOMERS_REDACT" ? "orders_to_redact" : "orders_requested"
    ],
  );
  const request = args.payload.data_request;
  if (
    request &&
    typeof request === "object" &&
    "id" in request &&
    typeof request.id === "number" &&
    !Number.isSafeInteger(request.id)
  )
    throw new Error("PRIVACY_REQUEST_ID_INVALID");
  const requestId =
    request && typeof request === "object" && "id" in request
      ? String(request.id)
      : null;
  if (requestId && !/^[1-9]\d{0,24}$/.test(requestId))
    throw new Error("PRIVACY_REQUEST_ID_INVALID");
  const customer =
    args.payload.customer && typeof args.payload.customer === "object"
      ? (args.payload.customer as Record<string, unknown>)
      : null;
  const subject = customer?.id ?? args.payload.customer_id ?? null;
  const digest = (key: string, value: unknown) =>
    createHash("sha256")
      .update(`${key}:${String(value ?? "unknown")}`)
      .digest("hex");
  const secrets = [
    ...new Set([
      args.secret,
      ...(args.lookupSecrets ?? privacyLookupKeys().secrets),
    ]),
  ];
  const candidates = secrets.flatMap((key) => {
    const shopHash = digest(key, args.shop);
    const subjectHash = subject == null ? null : digest(key, subject);
    const hash = (body: unknown) =>
      createHmac("sha256", key)
        .update("pagnetic-customer-privacy-request-v1\0")
        .update(JSON.stringify(body))
        .digest("hex");
    return [
      {
        key,
        subjectHash,
        id: hash(
          requestId
            ? [shopHash, args.type, requestId]
            : [shopHash, args.type, subjectHash, requestId, orderIds],
        ),
      },
      {
        key,
        subjectHash,
        id: hash([shopHash, args.type, subjectHash, requestId, orderIds]),
      }, // Pre-rotation-contract receipt.
    ];
  });
  const idempotencyKey = candidates[0].id;
  const storageEnvironment = args.scopeSecret
    ? {
        FIELD_ENCRYPTION_KEY: args.scopeSecret,
        PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify(
          (args.scopeSecrets ?? []).filter(
            (secret) => secret !== args.scopeSecret,
          ),
        ),
      }
    : process.env;
  let storageKeys: ReturnType<typeof privacyStorageKeys> | null = null;
  if (orderIds.length) {
    if (
      !storageEnvironment.FIELD_ENCRYPTION_KEY ||
      storageEnvironment.FIELD_ENCRYPTION_KEY.length < 32
    )
      throw new Error("PRIVACY_SCOPE_ENCRYPTION_REQUIRED");
    storageKeys = privacyStorageKeys(storageEnvironment);
  }
  const scopeSecret = storageKeys?.active;
  const scopeKeyId = scopeSecret ? privacyStorageKeyId(scopeSecret) : null;
  return args.db.$transaction(async (tx) => {
    const lockId = createHash("sha256")
      .update("pagnetic-privacy-shop-lock-v1\0")
      .update(args.shop)
      .digest("hex");
    await tx.privacyIntakeLock.upsert({
      where: { id: lockId },
      create: { id: lockId },
      update: { id: lockId },
    });
    await assertPrivacyLookupKeyCoverage(tx, {
      active: args.secret,
      secrets,
      legacy: args.secret,
    });
    if (storageKeys)
      await assertPrivacyStorageKeyCoverage(tx, storageEnvironment);
    const existing = await tx.privacyRequest.findFirst({
      where: { idempotencyKey: { in: candidates.map((entry) => entry.id) } },
      orderBy: [{ requestedAt: "asc" }, { id: "asc" }],
    });
    if (existing) {
      const identity = candidates.find(
        (entry) => entry.id === existing.idempotencyKey,
      )!;
      const existingScopeSecret = existing.scopeCiphertext
        ? privacyRequestStorageSecret(existing, storageEnvironment)
        : null;
      const stored = existing.scopeCiphertext?.startsWith("enc:v1:")
        ? decryptField<{ version: number; shop: string; orderIds: string[] }>(
            existing.scopeCiphertext,
            existingScopeSecret ?? undefined,
          )
        : null;
      if (
        existing.subjectHash !== identity.subjectHash ||
        (orderIds.length
          ? !stored ||
            ![1, 2].includes(stored.version) ||
            stored.shop !== args.shop ||
            JSON.stringify(stored.orderIds) !== JSON.stringify(orderIds)
          : existing.scopeCiphertext !== null)
      )
        throw new Error("PRIVACY_REQUEST_IDEMPOTENCY_CONFLICT");
      return existing;
    }
    const merchant = await tx.merchant.findUnique({
      where: { shop: args.shop },
      select: { id: true, installedAt: true },
    });
    const installationGenerationHash = merchant
      ? privacyInstallationGenerationHash(args.secret, args.shop, merchant)
      : null;
    const scopeCiphertext = orderIds.length
      ? encryptField({ version: 2, shop: args.shop, orderIds, installationGenerationHash }, scopeSecret)
      : null;
    const received = await tx.privacyRequest.upsert({
      where: { idempotencyKey },
      create: {
        shopHash: args.shopHash,
        subjectHash: args.subjectHash,
        requestType: args.type,
        idempotencyKey,
        scopeCiphertext,
        scopeKeyId,
        requestedAt: now,
        nextRunAt: now,
        lookupKeyId: privacyLookupKeyId(args.secret),
        dueAt: new Date(now.getTime() + 30 * 86_400_000),
        status: orderIds.length
          ? "PENDING_ORDER_SCOPE"
          : "REVIEW_REQUIRED_NO_ORDER_SCOPE",
        detailsJson: JSON.stringify({
          scopeVersion: 2,
          directCustomerProfileDataStored: false,
          pseudonymousTelemetryStored: true,
          customerIdentityJoinAvailable: false,
          orderIdentifiersProvided: orderIds.length,
          orderLinkedRecordsMayExist: orderIds.length > 0,
          deliveryConfirmed: false,
          activeDataErasureVerified: false,
          backupErasureVerified: false,
        }),
      },
      update: { idempotencyKey }, // Replay cannot reset a completed/processing request.
    });
    if (merchant)
      await tx.merchantNotice.upsert({
        where: {
          merchantId_dedupeKey: {
            merchantId: merchant.id,
            dedupeKey: `privacy-request:${received.id}`,
          },
        },
        create: {
          merchantId: merchant.id,
          dedupeKey: `privacy-request:${received.id}`,
          kind: "PRIVACY_REQUEST_RECEIVED",
          title:
            args.type === "CUSTOMERS_REDACT"
              ? "Customer privacy deletion requested"
              : "Customer data copy requested",
          detail:
            "The request is recorded, not completed. Order-linked records and any retained backup copies require processing and verification within the recorded deadline.",
          actionLabel: "Contact privacy support",
          actionHref: "/app/settings",
          metadataJson: JSON.stringify({
            privacyRequestId: received.id,
            dueAt: received.dueAt?.toISOString(),
          }),
        },
        update: {},
      });
    return received;
  });
}

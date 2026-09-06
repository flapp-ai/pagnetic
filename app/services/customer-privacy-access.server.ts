import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { decryptField } from "./field-encryption.server";
import { privacyHash } from "./privacy.server";
import { privacyLookupKeys, privacyRequestLookupSecret } from "./privacy-lookup-keys.server";
import { readCustomerPrivacyScope } from "./customer-privacy-queue.server";
import type { ShopifyOwnerAuthority } from "./shopify-owner-authority.server";
import { privacyRequestStorageSecret } from "./privacy-storage-keys.server";
import { privacyInstallationGenerationHash } from "./privacy-installation-generation.server";

type Access = {
  db: PrismaClient; shop: string; actor: string; requestId: string;
  ownerAuthority: ShopifyOwnerAuthority;
  environment?: Record<string, string | undefined>; now?: Date;
};

async function authorize(tx: Prisma.TransactionClient, args: Access) {
  const owner = args.ownerAuthority;
  if (!owner || owner.shop !== args.shop || args.actor !== `${args.shop}:user:${owner.userId}` ||
    !(owner.expiresAt instanceof Date) || !Number.isFinite(owner.expiresAt.getTime()) ||
    owner.expiresAt <= (args.now ?? new Date()))
    throw new Error("PRIVACY_ACCESS_DENIED");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(args.shop) ||
    !args.actor.startsWith(`${args.shop}:user:`) ||
    !/^\d{1,30}$/.test(args.actor.slice(`${args.shop}:user:`.length)) ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(args.requestId)) throw new Error("PRIVACY_ACCESS_DENIED");
  const merchant = await tx.merchant.findUnique({ where: { shop: args.shop }, select: { id: true } });
  if (!merchant) throw new Error("PRIVACY_ACCESS_DENIED");
  const keys = privacyLookupKeys(args.environment);
  const request = await tx.privacyRequest.findFirst({ where: {
    id: args.requestId, requestType: "CUSTOMERS_DATA_REQUEST",
    shopHash: { in: keys.secrets.map((secret) => privacyHash(secret, args.shop)) },
  } });
  if (!request) throw new Error("PRIVACY_ACCESS_DENIED");
  // Normal access requires the app's explicit owner role. After Shopify has
  // removed and a verified account owner later reinstalls the app, that role
  // no longer exists. Permit only a request that predates this installation;
  // never create a role or widen access for staff/collaborators.
  const current = await tx.merchant.findUniqueOrThrow({ where: { id: merchant.id },
    select: { id: true, installedAt: true } });
  const role = await tx.pilotRole.findUnique({ where: { merchantId_actorKey: {
    merchantId: merchant.id, actorKey: args.actor,
  } } });
  const roleOwner = Boolean(role?.active && role.role === "OWNER");
  const lookup = privacyRequestLookupSecret(request, args.environment);
  const scope = readCustomerPrivacyScope({ request, privacySecret: lookup,
    scopeSecret: privacyRequestStorageSecret(request, args.environment) });
  const currentGeneration = privacyInstallationGenerationHash(lookup, args.shop, current);
  const reinstallRecovery = !role && scope.version === 2 && scope.installationGenerationHash !== currentGeneration;
  if (!roleOwner && !reinstallRecovery) throw new Error("PRIVACY_ACCESS_DENIED");
  return { merchant: current, request, accessMode: reinstallRecovery ? "VERIFIED_REINSTALL_RECOVERY" as const : "APP_OWNER" as const };
}

async function completeArtifactIndex(tx: Prisma.TransactionClient, requestId: string, total: number, now: Date) {
  const index = await tx.privacyArtifactChunk.aggregate({ where: { requestId, kind: "CUSTOMER_DATA_COPY" },
    _count: true, _min: { ordinal: true, expiresAt: true }, _max: { ordinal: true } });
  return index._count === total && index._min.ordinal === 0 && index._max.ordinal === total - 1 &&
    Boolean(index._min.expiresAt && index._min.expiresAt > now);
}

function exactDigest(value: string, expected: string) {
  return /^[a-f0-9]{64}$/.test(value) && /^[a-f0-9]{64}$/.test(expected) &&
    timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
}

// Recovery has no installed-merchant authority and must not recreate a copy
// that a verified owner already delivered. Authenticate the durable request,
// exact scope and actor-bound delivery evidence directly from retained keys.
export async function assertCustomerPrivacyDeliveryAudit(args: {
  db: PrismaClient | Prisma.TransactionClient; request: Prisma.PrivacyRequestGetPayload<Record<string, never>>;
  shop: string; environment?: Record<string, string | undefined>;
}) {
  const environment = args.environment ?? process.env;
  const lookup = privacyRequestLookupSecret(args.request, environment);
  const storage = privacyRequestStorageSecret(args.request, environment);
  const scope = readCustomerPrivacyScope({ request: args.request, privacySecret: lookup, scopeSecret: storage });
  const delivery = await args.db.privacyDeliveryAudit.findUnique({ where: { requestId: args.request.id },
    select: { requestId: true, shopHash: true, actorHash: true, evidenceReference: true,
      partCount: true, deliveredAt: true, integrityTag: true } });
  if (!delivery || args.request.requestType !== "CUSTOMERS_DATA_REQUEST" ||
    args.request.status !== "OWNER_CONFIRMED_SECURE_DELIVERY" || !args.request.completedAt ||
    scope.shop !== args.shop || delivery.requestId !== args.request.id ||
    !exactDigest(delivery.shopHash, privacyHash(lookup, args.shop)) ||
    !/^[a-f0-9]{64}$/.test(delivery.actorHash) || !/^[a-f0-9]{64}$/.test(delivery.evidenceReference) ||
    delivery.partCount !== scope.orderIds.length || args.request.completedAt.getTime() !== delivery.deliveredAt.getTime())
    throw new Error("PRIVACY_DELIVERY_AUDIT_INVALID");
  const canonical = { requestId: delivery.requestId, shopHash: delivery.shopHash, actorHash: delivery.actorHash,
    evidenceReference: delivery.evidenceReference, partCount: delivery.partCount,
    deliveredAt: delivery.deliveredAt.toISOString() };
  const expected = createHmac("sha256", storage).update("pagnetic-privacy-delivery-audit-v1\0")
    .update(JSON.stringify(canonical)).digest("hex");
  if (!exactDigest(delivery.integrityTag, expected)) throw new Error("PRIVACY_DELIVERY_AUDIT_INVALID");
  return { delivery, scope };
}

export async function customerPrivacyArtifactManifest(args: Access & { page?: number }) {
  const page = args.page ?? 0;
  if (!Number.isSafeInteger(page) || page < 0 || page > 99) throw new Error("PRIVACY_ACCESS_DENIED");
  return args.db.$transaction(async (tx) => {
    const { request, accessMode } = await authorize(tx, args);
    const now = args.now ?? new Date();
    const environment = args.environment ?? process.env;
    const scope = readCustomerPrivacyScope({ request, scopeSecret: privacyRequestStorageSecret(request, environment),
      privacySecret: privacyRequestLookupSecret(request, environment) });
    const available = request.status === "EXPORT_READY_OWNER_DELIVERY" && !request.completedAt &&
      Boolean(request.dueAt && request.dueAt > now) &&
      await completeArtifactIndex(tx, request.id, scope.orderIds.length, now);
    const parts = available ? await tx.privacyArtifactChunk.findMany({
      where: { requestId: request.id, kind: "CUSTOMER_DATA_COPY", expiresAt: { gt: now },
        ordinal: { gte: page * 100, lt: (page + 1) * 100 } },
      orderBy: { ordinal: "asc" }, take: 100, select: { ordinal: true, expiresAt: true },
    }) : [];
    const delivery = await tx.privacyDeliveryAudit.findUnique({ where: { requestId: request.id },
      select: { requestId: true, shopHash: true, actorHash: true, evidenceReference: true,
        partCount: true, deliveredAt: true, integrityTag: true } });
    if (delivery) {
      await assertCustomerPrivacyDeliveryAudit({ db: tx, request, shop: args.shop, environment });
      if (!exactDigest(delivery.actorHash, privacyHash(privacyRequestLookupSecret(request, environment), args.actor)))
        throw new Error("PRIVACY_DELIVERY_AUDIT_INVALID");
    } else if (request.status === "OWNER_CONFIRMED_SECURE_DELIVERY" || request.completedAt) {
      throw new Error("PRIVACY_DELIVERY_AUDIT_INVALID");
    }
    const count = scope.orderIds.length;
    return { requestId: request.id, status: request.status, dueAt: request.dueAt?.toISOString() ?? null,
      completedAt: request.completedAt?.toISOString() ?? null, page,
      parts: parts.map((part) => ({ ordinal: part.ordinal, expiresAt: part.expiresAt.toISOString() })),
      hasNextPage: available && count > (page + 1) * 100, partCount: count,
      available, deliveryConfirmed: Boolean(delivery), deliveredAt: delivery?.deliveredAt.toISOString() ?? null,
      legalReviewRequired: Boolean(delivery), accessMode };
  });
}

export async function accessCustomerPrivacyArtifact(args: Access & { ordinal: number }) {
  if (!Number.isSafeInteger(args.ordinal) || args.ordinal < 0 || args.ordinal >= 10_000)
    throw new Error("PRIVACY_ACCESS_DENIED");
  return args.db.$transaction(async (tx) => {
    const { merchant, request, accessMode } = await authorize(tx, args);
    if (accessMode === "APP_OWNER") {
      const ownerLocked = await tx.pilotRole.updateMany({ where: {
        merchantId: merchant.id, actorKey: args.actor, active: true, role: "OWNER",
      }, data: { role: "OWNER" } });
      if (ownerLocked.count !== 1) throw new Error("PRIVACY_ACCESS_DENIED");
    } else {
      const current = await tx.merchant.updateMany({ where: { id: merchant.id, shop: args.shop,
        installedAt: merchant.installedAt }, data: { installedAt: merchant.installedAt } });
      if (current.count !== 1) throw new Error("PRIVACY_ACCESS_DENIED");
    }
    if (request.status !== "EXPORT_READY_OWNER_DELIVERY" || request.completedAt)
      throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const now = args.now ?? new Date();
    const locked = await tx.privacyRequest.updateMany({ where: {
      id: request.id, status: request.status, completedAt: null,
      scopeCiphertext: request.scopeCiphertext, dueAt: { gt: now },
    }, data: { status: request.status } });
    if (locked.count !== 1) throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const environment = args.environment ?? process.env;
    const scopeSecret = privacyRequestStorageSecret(request, environment);
    const secret = privacyRequestLookupSecret(request, environment);
    const scope = readCustomerPrivacyScope({ request, privacySecret: secret, scopeSecret });
    if (scope.shop !== args.shop) throw new Error("PRIVACY_ACCESS_DENIED");
    if (!await completeArtifactIndex(tx, request.id, scope.orderIds.length, now))
      throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const chunk = await tx.privacyArtifactChunk.findUnique({ where: { requestId_kind_ordinal: {
      requestId: request.id, kind: "CUSTOMER_DATA_COPY", ordinal: args.ordinal,
    } } });
    if (!chunk || chunk.expiresAt <= now || !chunk.payloadCiphertext.startsWith("enc:v1:") ||
      createHash("sha256").update(chunk.payloadCiphertext).digest("hex") !== chunk.ciphertextHash)
      throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const payload = decryptField<Record<string, unknown>>(chunk.payloadCiphertext, scopeSecret);
    const scopeHash = createHmac("sha256", secret).update("pagnetic-privacy-export-scope-v1\0")
      .update(JSON.stringify([request.id, scope.shop, scope.orderIds])).digest("hex");
    if (!payload || payload.version !== 1 || payload.requestId !== request.id ||
      payload.orderOrdinal !== args.ordinal || payload.orderId !== scope.orderIds[args.ordinal] ||
      payload.scopeHash !== scopeHash) throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const finishedAt = args.now ?? new Date();
    if (chunk.expiresAt <= finishedAt || !request.dueAt || request.dueAt <= finishedAt ||
      args.ownerAuthority.expiresAt <= finishedAt)
      throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    await tx.auditLog.create({ data: {
      merchantId: merchant.id, actor: args.actor, action: "PRIVACY_EXPORT_ACCESSED",
      resourceType: "PrivacyRequest", resourceId: request.id,
      detailsJson: JSON.stringify({ ordinal: args.ordinal, accessedAt: finishedAt.toISOString(),
        deliveryConfirmed: false, accessMode }),
    } });
    // The scope HMAC is an internal integrity binding, not customer export data.
    const { scopeHash: omitted, ...copy } = payload;
    void omitted;
    return copy;
  });
}

export async function confirmCustomerPrivacyArtifactDelivery(args: Access & {
  attestation: string; evidenceReference: string;
}) {
  if (args.attestation !== "I_CONFIRMED_SECURE_DELIVERY_TO_REQUESTER" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/ -]{7,499}$/.test(args.evidenceReference) || args.evidenceReference.includes("\0"))
    throw new Error("PRIVACY_DELIVERY_CONFIRMATION_INVALID");
  return args.db.$transaction(async (tx) => {
    const { merchant, request, accessMode } = await authorize(tx, args);
    const now = args.now ?? new Date();
    const environment = args.environment ?? process.env;
    const scopeSecret = privacyRequestStorageSecret(request, environment);
    const secret = privacyRequestLookupSecret(request, environment);
    const scope = readCustomerPrivacyScope({ request, scopeSecret, privacySecret: secret });
    if (request.status !== "EXPORT_READY_OWNER_DELIVERY" || request.completedAt ||
      !request.dueAt || request.dueAt <= now || !await completeArtifactIndex(tx, request.id, scope.orderIds.length, now))
      throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const accessRows = await tx.auditLog.findMany({ where: {
      merchantId: merchant.id, actor: args.actor, action: "PRIVACY_EXPORT_ACCESSED",
      resourceType: "PrivacyRequest", resourceId: request.id,
    }, orderBy: { createdAt: "asc" }, take: 10_000, select: { detailsJson: true } });
    const accessed = new Set<number>();
    for (const row of accessRows) {
      try {
        const details = JSON.parse(row.detailsJson) as Record<string, unknown>;
        if (Number.isSafeInteger(details.ordinal)) accessed.add(Number(details.ordinal));
      } catch { /* malformed historical access logs do not authorize delivery */ }
    }
    if (scope.orderIds.some((_, ordinal) => !accessed.has(ordinal)))
      throw new Error("PRIVACY_DELIVERY_PARTS_NOT_ACCESSED");
    const locked = await tx.privacyRequest.updateMany({ where: {
      id: request.id, status: "EXPORT_READY_OWNER_DELIVERY", completedAt: null,
      dueAt: { gt: now }, scopeCiphertext: request.scopeCiphertext,
    }, data: { status: "EXPORT_READY_OWNER_DELIVERY" } });
    if (locked.count !== 1) throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    const evidenceReference = createHmac("sha256", scopeSecret).update("pagnetic-privacy-delivery-reference-v1\0")
      .update(args.evidenceReference).digest("hex");
    const delivery = {
      requestId: request.id, shopHash: privacyHash(secret, args.shop), actorHash: privacyHash(secret, args.actor),
      evidenceReference, partCount: scope.orderIds.length, deliveredAt: now.toISOString(),
    };
    const integrityTag = createHmac("sha256", scopeSecret).update("pagnetic-privacy-delivery-audit-v1\0")
      .update(JSON.stringify(delivery)).digest("hex");
    await tx.privacyDeliveryAudit.create({ data: { ...delivery, deliveredAt: now, integrityTag } });
    const details = JSON.parse(request.detailsJson) as Record<string, unknown>;
    const saved = await tx.privacyRequest.updateMany({ where: {
      id: request.id, status: "EXPORT_READY_OWNER_DELIVERY", completedAt: null,
    }, data: { status: "OWNER_CONFIRMED_SECURE_DELIVERY", completedAt: now, nextRunAt: null,
      leaseToken: null, leaseUntil: null, lastErrorCode: null,
      detailsJson: JSON.stringify({ ...details, deliveryConfirmed: true,
        delivery: { version: 1, ownerAttestedAt: now.toISOString(), accessMode,
          backupErasureVerified: false, legalReviewRequired: true } }) } });
    if (saved.count !== 1) throw new Error("PRIVACY_ARTIFACT_UNAVAILABLE");
    return { requestId: request.id, status: "OWNER_CONFIRMED_SECURE_DELIVERY" as const,
      completedAt: now.toISOString(), deliveryConfirmed: true, legalReviewRequired: true };
  });
}

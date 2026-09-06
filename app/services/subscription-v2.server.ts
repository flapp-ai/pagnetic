import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { canonicalQueuePayload } from "./job-outbox.server";

export type SubscriptionStatusV2 =
  | "FREE_EVALUATION"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "FROZEN"
  | "CANCEL_AT_PERIOD_END"
  | "EXPIRED"
  | "CANCELED";

export type OfferV2 = {
  version: string;
  name: string;
  priceUsdMonthly: number;
  evaluation: string;
  legacyExisting: boolean;
  publishable: boolean;
};

export function offerCatalogV2(
  environment: Record<string, string | undefined> = process.env,
): OfferV2[] {
  const publishNewOffer =
    environment.SHOPIFY_BILLING_ENABLED === "true" &&
    environment.PAGNETIC_V2_OFFER_PUBLISHABLE === "true";
  return [
    {
      version: "founding-beta-v1",
      name: "Founding beta",
      priceUsdMonthly: 49,
      evaluation: "Existing founding terms are preserved; no new enrollment is implied.",
      legacyExisting: true,
      publishable: false,
    },
    {
      version: "pagnetic-core-99-v1",
      name: "Pagnetic Core",
      priceUsdMonthly: 99,
      evaluation: "One bounded measurement check and one registered message test; timing follows the measured forecast, not a fixed 45-day promise.",
      legacyExisting: false,
      publishable: publishNewOffer,
    },
  ];
}

export type ProviderSubscriptionV2 = {
  shop: string;
  subscriptionId: string | null;
  offerVersion: string;
  state: string;
  sourceVersion: string;
  updatedAt: Date;
  periodEnd?: Date | null;
  cancellationAt?: Date | null;
};

export interface SubscriptionProviderV2 {
  verify(shop: string): Promise<ProviderSubscriptionV2>;
}

function bounded(value: string, maximum: number) {
  return value.trim().slice(0, maximum);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(canonicalQueuePayload(value)).digest("hex");
}

export function mapProviderSubscriptionStateV2(args: {
  state: string;
  periodEnd?: Date | null;
  now: Date;
}): SubscriptionStatusV2 {
  const state = args.state.trim().toUpperCase();
  if (state === "NO_ACTIVE_SUBSCRIPTION") return "FREE_EVALUATION";
  if (state === "ACTIVE") return "ACTIVE";
  if (["PENDING", "PENDING_APPROVAL"].includes(state)) return "PENDING_APPROVAL";
  if (state === "FROZEN") return "FROZEN";
  if (state === "EXPIRED") return "EXPIRED";
  if (["CANCELLED", "CANCELED", "DECLINED"].includes(state)) {
    return args.periodEnd && args.periodEnd > args.now
      ? "CANCEL_AT_PERIOD_END"
      : "CANCELED";
  }
  return "FROZEN";
}

export function subscriptionAllowsApprovedServingV2(args: {
  status: string;
  periodEnd: Date | null;
  now: Date;
}) {
  if (args.status === "ACTIVE") return true;
  if (args.status === "FREE_EVALUATION") {
    return args.periodEnd == null || args.periodEnd > args.now;
  }
  if (args.status === "CANCEL_AT_PERIOD_END") {
    return Boolean(args.periodEnd && args.periodEnd > args.now);
  }
  return false;
}

export async function verifySubscriptionV2(args: {
  db: PrismaClient;
  merchantId: string;
  provider: SubscriptionProviderV2;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const merchant = await args.db.merchant.findUnique({
    where: { id: args.merchantId },
    select: { id: true, shop: true },
  });
  if (!merchant) throw new Error("SUBSCRIPTION_MERCHANT_UNAVAILABLE");
  const source = await args.provider.verify(merchant.shop);
  if (source.shop !== merchant.shop) throw new Error("SUBSCRIPTION_TENANT_MISMATCH");
  if (!Number.isFinite(source.updatedAt.getTime()) || source.updatedAt > new Date(now.getTime() + 5 * 60_000))
    throw new Error("SUBSCRIPTION_SOURCE_TIME_INVALID");
  const offer = offerCatalogV2().find((item) => item.version === source.offerVersion);
  if (!offer) throw new Error("SUBSCRIPTION_OFFER_UNKNOWN");
  const providerState = bounded(source.state, 64).toUpperCase();
  const externalSubscriptionIdentity = source.subscriptionId
    ? bounded(source.subscriptionId, 200)
    : null;
  if (externalSubscriptionIdentity && !/^[A-Za-z0-9_:/.-]+$/.test(externalSubscriptionIdentity))
    throw new Error("SUBSCRIPTION_IDENTITY_INVALID");
  const material = {
    shop: source.shop,
    subscriptionId: externalSubscriptionIdentity,
    offerVersion: offer.version,
    state: providerState,
    sourceVersion: bounded(source.sourceVersion, 120),
    updatedAt: source.updatedAt.toISOString(),
    periodEnd: source.periodEnd?.toISOString() ?? null,
    cancellationAt: source.cancellationAt?.toISOString() ?? null,
  };
  if (!material.sourceVersion) throw new Error("SUBSCRIPTION_SOURCE_VERSION_INVALID");
  const providerPayloadHash = hashPayload(material);
  const authoritativeStatus = mapProviderSubscriptionStateV2({
    state: providerState,
    periodEnd: source.periodEnd,
    now,
  });
  return args.db.$transaction(async (tx) => {
    const existing = await tx.subscriptionState.findUnique({
      where: { merchantId: args.merchantId },
    });
    if (existing?.providerUpdatedAt && existing.providerUpdatedAt > source.updatedAt) {
      await tx.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: "SYSTEM",
          action: "SUBSCRIPTION_STALE_SOURCE_IGNORED",
          resourceType: "SUBSCRIPTION_STATE",
          resourceId: existing.id,
          detailsJson: canonicalQueuePayload({
            sourceVersion: material.sourceVersion,
            sourceUpdatedAt: material.updatedAt,
          }),
        },
      });
      return existing;
    }
    if (
      existing?.providerUpdatedAt?.getTime() === source.updatedAt.getTime() &&
      existing.providerPayloadHash &&
      existing.providerPayloadHash !== providerPayloadHash
    ) {
      const frozen = await tx.subscriptionState.update({
        where: { id: existing.id },
        data: { authoritativeStatus: "FROZEN", verifiedAt: now },
      });
      await tx.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: "SYSTEM",
          action: "SUBSCRIPTION_SOURCE_CONFLICT",
          resourceType: "SUBSCRIPTION_STATE",
          resourceId: existing.id,
          detailsJson: canonicalQueuePayload({
            sourceUpdatedAt: material.updatedAt,
            receivedHash: providerPayloadHash,
          }),
        },
      });
      return frozen;
    }
    const saved = await tx.subscriptionState.upsert({
      where: { merchantId: args.merchantId },
      create: {
        merchantId: args.merchantId,
        externalSubscriptionIdentity,
        offerVersion: offer.version,
        authoritativeStatus,
        rawSourceVersion: material.sourceVersion,
        providerShop: merchant.shop,
        providerState,
        providerUpdatedAt: source.updatedAt,
        providerPayloadHash,
        verifiedAt: now,
        periodEnd: source.periodEnd ?? null,
        cancellationAt: source.cancellationAt ?? null,
      },
      update: {
        externalSubscriptionIdentity,
        offerVersion: offer.version,
        authoritativeStatus,
        rawSourceVersion: material.sourceVersion,
        providerShop: merchant.shop,
        providerState,
        providerUpdatedAt: source.updatedAt,
        providerPayloadHash,
        verifiedAt: now,
        periodEnd: source.periodEnd ?? null,
        cancellationAt: source.cancellationAt ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: "SYSTEM",
        action: "SUBSCRIPTION_AUTHORITY_VERIFIED",
        resourceType: "SUBSCRIPTION_STATE",
        resourceId: saved.id,
        detailsJson: canonicalQueuePayload({
          offerVersion: offer.version,
          authoritativeStatus,
          sourceVersion: material.sourceVersion,
          sourceUpdatedAt: material.updatedAt,
          providerPayloadHash,
        }),
      },
    });
    return saved;
  });
}

import type { Prisma, PrismaClient } from "@prisma/client";

import { assertPrivacyAnalysisUsable } from "./privacy-analysis.server";

const VALID_FIRST_RESULT_STATES = new Set([
  "POSITIVE",
  "NEGATIVE",
  "INCONCLUSIVE",
]);
const MATURE_REAL_RESULT_STATES = new Set([
  ...VALID_FIRST_RESULT_STATES,
  "INVALID",
]);

export async function ensureBetaEntitlement(
  db: PrismaClient | Prisma.TransactionClient,
  merchantId: string,
) {
  return db.betaEntitlement.upsert({
    where: { merchantId },
    update: {},
    create: { merchantId },
  });
}

export async function reconcileBetaEntitlement(args: {
  db: PrismaClient;
  merchantId: string;
  snapshotId: string;
  actor?: string;
}) {
  return args.db.$transaction(async (tx) => {
    // Serialize result consumption with privacy invalidation. If privacy wins
    // this lock, no old positive result can recreate an offer afterward. If
    // reconciliation wins, invalidation follows and clears the references.
    await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const snapshot = await tx.experimentResultSnapshot.findFirst({
      where: {
        id: args.snapshotId,
        experiment: { merchantId: args.merchantId },
      },
      include: { experiment: true },
    });
    if (!snapshot)
      throw new Error(
        "Experiment result snapshot was not found for this store.",
      );
    assertPrivacyAnalysisUsable(snapshot.experiment);
    const isRealExperiment =
      snapshot.experiment.controlPolicy !== snapshot.experiment.treatmentPolicy;
    if (
      !isRealExperiment ||
      !MATURE_REAL_RESULT_STATES.has(snapshot.resultState)
    )
      return ensureBetaEntitlement(tx, args.merchantId);

    const entitlement = await ensureBetaEntitlement(tx, args.merchantId);
    if (entitlement.lastResultSnapshotId === snapshot.id) return entitlement;
    const valid = VALID_FIRST_RESULT_STATES.has(snapshot.resultState);
    const positive = snapshot.resultState === "POSITIVE";
    const freeExtension =
      snapshot.resultState === "NEGATIVE" ||
      snapshot.resultState === "INCONCLUSIVE";
    const freeExtensionUntil = freeExtension
      ? new Date(snapshot.createdAt.getTime() + 30 * 86_400_000)
      : null;
    await tx.betaEntitlement.update({
      where: { merchantId: args.merchantId },
      data: {
        status: positive
          ? "CONTINUATION_OFFER"
          : freeExtension
            ? "FREE_EXTENSION"
            : "FREE_UNTIL_VALID_RESULT",
        lastResultSnapshotId: snapshot.id,
        lastResultState: snapshot.resultState,
        freeExtensionUntil,
        revisedExperimentsRemaining: freeExtension ? 1 : 0,
        ...(valid && !entitlement.firstValidResultAt
          ? {
              firstValidResultAt: snapshot.createdAt,
              firstValidResultState: snapshot.resultState,
              firstValidResultSnapshotId: snapshot.id,
            }
          : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor ?? "system:experiment-analysis",
        action: "FOUNDING_BETA_RESULT_RECONCILED",
        resourceType: "BETA_ENTITLEMENT",
        resourceId: args.merchantId,
        detailsJson: JSON.stringify({
          snapshotId: snapshot.id,
          experimentId: snapshot.experimentId,
          resultState: snapshot.resultState,
          entitlementStatus: positive
            ? "CONTINUATION_OFFER"
            : freeExtension
              ? "FREE_EXTENSION"
              : "FREE_UNTIL_VALID_RESULT",
          billingEnabled: process.env.SHOPIFY_BILLING_ENABLED === "true",
          offerVersion: entitlement.offerVersion,
        }),
      },
    });
    return tx.betaEntitlement.findUniqueOrThrow({
      where: { merchantId: args.merchantId },
    });
  });
}

export function describeBetaEntitlement(entitlement: {
  status: string;
  firstValidResultAt: Date | null;
  firstValidResultState: string | null;
  lastResultState?: string | null;
  freeExtensionUntil?: Date | null;
  revisedExperimentsRemaining?: number;
  offerPriceUsd?: number;
}) {
  if (entitlement.lastResultState === "INVALID") {
    return {
      phase: "FREE_UNTIL_RESULT" as const,
      headline: "Free access continues while measurement is repaired",
      detail:
        "The invalid result cannot trigger billing and is not presented as a winner.",
      paymentRequired: false,
    };
  }
  if (
    entitlement.lastResultState === "NEGATIVE" ||
    entitlement.lastResultState === "INCONCLUSIVE"
  ) {
    return {
      phase: "FREE_EXTENSION" as const,
      headline: "One revised experiment remains free",
      detail: entitlement.freeExtensionUntil
        ? `Free access continues through ${entitlement.freeExtensionUntil.toISOString().slice(0, 10)} while Pagnetic prepares one revision.`
        : "Free access continues for 30 days while Pagnetic prepares one revision.",
      paymentRequired: false,
    };
  }
  if (!entitlement.firstValidResultAt) {
    return {
      phase: "FREE_UNTIL_RESULT" as const,
      headline: "Free until your first valid experiment result",
      detail:
        "A/A validation does not end the beta. No payment is requested while the first real comparison is collecting.",
      paymentRequired: false,
    };
  }
  return {
    phase: "RESULT_READY" as const,
    headline: `Continue for $${entitlement.offerPriceUsd ?? 49}/store/month`,
    detail:
      process.env.SHOPIFY_BILLING_ENABLED === "true"
        ? "Review the positive result and accept the locked 12-month founding price before any charge is created."
        : "Billing is disabled. Review the positive result; no charge can be created yet.",
    paymentRequired:
      process.env.SHOPIFY_BILLING_ENABLED === "true" &&
      entitlement.status !== "PAID",
  };
}

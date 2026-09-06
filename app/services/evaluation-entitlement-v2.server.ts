import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { canonicalQueuePayload } from "./job-outbox.server";
import { subscriptionAllowsApprovedServingV2 } from "./subscription-v2.server";

type FrozenExperiment = {
  id: string;
  controlPolicy: string;
  treatmentPolicy: string;
  registration: { registrationHash: string } | null;
};

function entitlementHash(value: unknown) {
  return createHash("sha256").update(canonicalQueuePayload(value)).digest("hex");
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Claims a free-evaluation slot in the same transaction that advances serving.
 * Paid authority bypasses the free ledger; denied/ambiguous authority fails closed.
 */
export async function authorizeV2ExperimentServing(args: {
  db: Prisma.TransactionClient;
  merchantId: string;
  experiment: FrozenExperiment;
  now: Date;
}) {
  if (!args.experiment.registration)
    throw new Error("EVALUATION_REGISTRATION_REQUIRED");
  const [subscription, existingConsumption] = await Promise.all([
    args.db.subscriptionState.findUnique({ where: { merchantId: args.merchantId } }),
    args.db.evaluationConsumption.findUnique({
      where: {
        merchantId_experimentId: {
          merchantId: args.merchantId,
          experimentId: args.experiment.id,
        },
      },
    }),
  ]);
  if (
    subscription &&
    subscriptionAllowsApprovedServingV2({
      status: subscription.authoritativeStatus,
      periodEnd: subscription.periodEnd,
      now: args.now,
    }) &&
    subscription.authoritativeStatus !== "FREE_EVALUATION"
  ) {
    return { mode: "PAID" as const, consumption: null };
  }
  if (subscription && subscription.authoritativeStatus !== "FREE_EVALUATION")
    throw new Error("SUBSCRIPTION_AUTHORITY_REQUIRED");
  if (
    subscription?.authoritativeStatus === "FREE_EVALUATION" &&
    subscription.periodEnd &&
    subscription.periodEnd <= args.now
  ) throw new Error("FREE_EVALUATION_EXPIRED");
  if (existingConsumption)
    return { mode: "FREE_EVALUATION" as const, consumption: existingConsumption };

  const measurementCheck =
    args.experiment.controlPolicy === args.experiment.treatmentPolicy;
  let allowanceKey = measurementCheck
    ? "MEASUREMENT_CHECK_V1"
    : "MESSAGE_TEST_V1";
  let sourceResultSnapshotId: string | null = null;
  let betaEntitlement: Awaited<ReturnType<typeof args.db.betaEntitlement.findUnique>> = null;
  const firstClaim = await args.db.evaluationConsumption.findUnique({
    where: {
      merchantId_allowanceKey: {
        merchantId: args.merchantId,
        allowanceKey,
      },
    },
  });
  if (firstClaim) {
    if (measurementCheck) throw new Error("MEASUREMENT_EVALUATION_ALREADY_CONSUMED");
    betaEntitlement = await args.db.betaEntitlement.findUnique({
      where: { merchantId: args.merchantId },
    });
    const revisionEligible =
      betaEntitlement &&
      ["NEGATIVE", "INCONCLUSIVE"].includes(betaEntitlement.lastResultState ?? "") &&
      betaEntitlement.revisedExperimentsRemaining > 0 &&
      betaEntitlement.freeExtensionUntil &&
      betaEntitlement.freeExtensionUntil > args.now &&
      betaEntitlement.lastResultSnapshotId;
    if (!revisionEligible) throw new Error("MESSAGE_EVALUATION_ALREADY_CONSUMED");
    allowanceKey = "MESSAGE_REVISION_V1";
    sourceResultSnapshotId = revisionEligible;
    const revisionClaim = await args.db.evaluationConsumption.findUnique({
      where: {
        merchantId_allowanceKey: {
          merchantId: args.merchantId,
          allowanceKey,
        },
      },
    });
    if (revisionClaim) throw new Error("MESSAGE_REVISION_ALREADY_CONSUMED");
  }

  const offerVersion =
    subscription?.offerVersion ?? betaEntitlement?.offerVersion ?? "founding-beta-v1";
  const inputHash = entitlementHash({
    merchantId: args.merchantId,
    experimentId: args.experiment.id,
    controlPolicy: args.experiment.controlPolicy,
    treatmentPolicy: args.experiment.treatmentPolicy,
    registrationHash: args.experiment.registration.registrationHash,
    allowanceKey,
    offerVersion,
    sourceResultSnapshotId,
  });
  if (allowanceKey === "MESSAGE_REVISION_V1") {
    const consumed = await args.db.betaEntitlement.updateMany({
      where: {
        merchantId: args.merchantId,
        revisedExperimentsRemaining: { gt: 0 },
        freeExtensionUntil: { gt: args.now },
        lastResultSnapshotId: sourceResultSnapshotId,
        lastResultState: { in: ["NEGATIVE", "INCONCLUSIVE"] },
      },
      data: { revisedExperimentsRemaining: { decrement: 1 } },
    });
    if (consumed.count !== 1) throw new Error("MESSAGE_REVISION_AUTHORITY_CHANGED");
  }
  try {
    const consumption = await args.db.evaluationConsumption.create({
      data: {
        merchantId: args.merchantId,
        allowanceKey,
        experimentId: args.experiment.id,
        offerVersion,
        sourceResultSnapshotId,
        inputHash,
      },
    });
    await args.db.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: "SYSTEM",
        action: "V2_EVALUATION_CONSUMED",
        resourceType: "EXPERIMENT",
        resourceId: args.experiment.id,
        detailsJson: canonicalQueuePayload({
          allowanceKey,
          offerVersion,
          sourceResultSnapshotId,
          inputHash,
        }),
      },
    });
    return { mode: "FREE_EVALUATION" as const, consumption };
  } catch (error) {
    if (isUniqueConflict(error)) throw new Error("EVALUATION_ALLOWANCE_ALREADY_CONSUMED");
    throw error;
  }
}

import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { canTransitionAutopilot, type AutopilotPlanState } from "./autopilot";
import { canonicalQueuePayload, enqueueOutboxEvent } from "./job-outbox.server";
import { MVP_V2_PROTOCOL_VERSION } from "./mvp-v2";

const MAX_EXPERIMENTS = 100;
const ORIGINAL_HASH = createHash("sha256").update("ORIGINAL").digest("hex");

export class PrivacyAnalysisRestrictedError extends Error {
  code = "PRIVACY_ANALYSIS_REVIEW_REQUIRED" as const;

  constructor() {
    super("PRIVACY_ANALYSIS_REVIEW_REQUIRED");
  }
}

export function assertPrivacyAnalysisUsable(experiment: {
  privacyAffectedAt: Date | null;
}) {
  if (experiment.privacyAffectedAt) throw new PrivacyAnalysisRestrictedError();
}

function exactIds(values: string[]) {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > MAX_EXPERIMENTS
  )
    throw new Error("PRIVACY_ANALYSIS_SCOPE_INVALID");
  const ids = [...new Set(values)].sort();
  if (
    ids.length !== values.length ||
    ids.some((id) => !/^[A-Za-z0-9_-]{1,200}$/.test(id))
  )
    throw new Error("PRIVACY_ANALYSIS_SCOPE_INVALID");
  return ids;
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(canonicalQueuePayload(value))
    .digest("hex");
}

export async function invalidateExperimentsForPrivacy(
  tx: Prisma.TransactionClient,
  args: { merchantId: string; experimentIds: string[]; now: Date },
) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(args.merchantId))
    throw new Error("PRIVACY_ANALYSIS_SCOPE_INVALID");
  if (!(args.now instanceof Date) || !Number.isFinite(args.now.getTime()))
    throw new Error("PRIVACY_ANALYSIS_TIME_INVALID");
  const experimentIds = exactIds(args.experimentIds);

  // Runtime is the first lock in decisions and deployment writes. Privacy
  // erasure already holds this row, so the self-update is both safe and
  // transaction-compatible when the helper is called from that worker.
  const control = await tx.runtimeControl.upsert({
    where: { merchantId: args.merchantId },
    create: {
      merchantId: args.merchantId,
      killSwitch: true,
      reason: "Privacy-linked experiment requires governed analysis review",
      activatedBy: "system:privacy",
      activatedAt: args.now,
    },
    update: { merchantId: args.merchantId },
  });
  const experiments = await tx.experiment.findMany({
    where: { id: { in: experimentIds }, merchantId: args.merchantId },
    orderBy: { id: "asc" },
  });
  if (experiments.length !== experimentIds.length)
    throw new Error("PRIVACY_ANALYSIS_EXPERIMENT_NOT_FOUND");

  if (!control.killSwitch)
    await tx.runtimeControl.update({
      where: { merchantId: args.merchantId },
      data: {
        killSwitch: true,
        reason: "Privacy-linked experiment requires governed analysis review",
        activatedBy: "system:privacy",
        activatedAt: args.now,
        clearedBy: null,
        clearedAt: null,
      },
    });

  // Match the serving path lock order: runtime -> product pointer ->
  // experiment. This avoids deadlocking a decision that already holds the
  // product pointer and is waiting to read its experiment authority.
  const productIds = [
    ...new Set(experiments.map((item) => item.productId)),
  ].sort();
  const stoppedDeploymentIds: string[] = [];
  for (const productId of productIds) {
    const pointer = await tx.activeDeployment.findUnique({
      where: { productId },
      include: { deploymentVersion: true },
    });
    if (!pointer) continue;
    if (
      pointer.merchantId !== args.merchantId ||
      pointer.deploymentVersion.merchantId !== args.merchantId ||
      pointer.deploymentVersion.productId !== productId
    )
      throw new Error("PRIVACY_ANALYSIS_DEPLOYMENT_TENANT_MISMATCH");
    if (
      pointer.deploymentVersion.policy === "ORIGINAL" &&
      pointer.deploymentVersion.state === "STOPPED"
    )
      continue;
    const revision = pointer.revision + 1;
    const material = {
      schemaVersion: 2,
      merchantId: args.merchantId,
      productId,
      planId: pointer.deploymentVersion.planId,
      experimentId: null,
      contentVersionId: null,
      policy: "ORIGINAL",
      state: "STOPPED",
      expectedRevision: pointer.revision,
      reason: "PRIVACY_ANALYSIS_REVIEW_REQUIRED",
    };
    const canonicalPayload = canonicalQueuePayload(material);
    const deployment = await tx.deploymentVersion.create({
      data: {
        merchantId: args.merchantId,
        productId,
        planId: pointer.deploymentVersion.planId,
        revision,
        protocolVersion: MVP_V2_PROTOCOL_VERSION,
        policy: "ORIGINAL",
        contentSetHash: ORIGINAL_HASH,
        experimentId: null,
        state: "STOPPED",
        approvedAuthorityHash: digest(material),
        canonicalPayload,
      },
    });
    const moved = await tx.activeDeployment.updateMany({
      where: {
        id: pointer.id,
        merchantId: args.merchantId,
        productId,
        deploymentVersionId: pointer.deploymentVersionId,
        revision: pointer.revision,
      },
      data: { deploymentVersionId: deployment.id, revision },
    });
    if (moved.count !== 1)
      throw new Error("PRIVACY_ANALYSIS_AUTHORITY_CHANGED");
    await enqueueOutboxEvent({
      db: tx,
      merchantId: args.merchantId,
      type: "DEPLOYMENT_ADVANCED",
      aggregateType: "DEPLOYMENT",
      aggregateId: deployment.id,
      idempotencyKey: `privacy-analysis:${deployment.id}:revision:${revision}`,
      payload: {
        deploymentId: deployment.id,
        productId,
        revision,
        policy: "ORIGINAL",
        state: "STOPPED",
      },
    });
    stoppedDeploymentIds.push(deployment.id);
  }

  // Runtime authority serializes serving changes above. Lock each affected
  // experiment before changing its analysis or lifecycle state.
  for (const experiment of experiments) {
    const locked = await tx.experiment.updateMany({
      where: {
        id: experiment.id,
        merchantId: args.merchantId,
        privacyAffectedAt: experiment.privacyAffectedAt,
        status: experiment.status,
        finalResultSnapshotId: experiment.finalResultSnapshotId,
      },
      data: { lifecycleVersion: experiment.lifecycleVersion },
    });
    if (locked.count !== 1)
      throw new Error("PRIVACY_ANALYSIS_AUTHORITY_CHANGED");
  }

  let newlyRestricted = 0;
  let pausedExperiments = 0;
  for (const experiment of experiments) {
    const unfinished = experiment.finalizedAt === null;
    const nextStatus = unfinished ? "PAUSED" : experiment.status;
    const updated = await tx.experiment.updateMany({
      where: {
        id: experiment.id,
        merchantId: args.merchantId,
        privacyAffectedAt: experiment.privacyAffectedAt,
        status: experiment.status,
      },
      data: {
        privacyAffectedAt: experiment.privacyAffectedAt ?? args.now,
        status: nextStatus,
        endedAt: unfinished
          ? (experiment.endedAt ?? args.now)
          : experiment.endedAt,
      },
    });
    if (updated.count !== 1)
      throw new Error("PRIVACY_ANALYSIS_AUTHORITY_CHANGED");
    if (!experiment.privacyAffectedAt) newlyRestricted += 1;
    if (unfinished && experiment.status !== "PAUSED") pausedExperiments += 1;
    if (!experiment.privacyAffectedAt)
      await tx.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: "system:privacy",
          action: "V2_EXPERIMENT_PRIVACY_ANALYSIS_RESTRICTED",
          resourceType: "Experiment",
          resourceId: experiment.id,
          detailsJson: canonicalQueuePayload({
            privacyAffectedAt: args.now.toISOString(),
            immutableResultPreserved: Boolean(experiment.finalResultSnapshotId),
            outwardEffectClaimsWithheld: true,
          }),
        },
      });
  }

  const plans = await tx.autopilotPlan.findMany({
    where: {
      merchantId: args.merchantId,
      OR: [
        { aaExperimentId: { in: experimentIds } },
        { realExperimentId: { in: experimentIds } },
      ],
    },
    orderBy: { id: "asc" },
  });
  const pausedPlanIds: string[] = [];
  for (const plan of plans) {
    const fromState = plan.state as AutopilotPlanState;
    if (fromState !== "PAUSED" && fromState !== "INVALIDATED") {
      const toState = canTransitionAutopilot(fromState, "PAUSED")
        ? "PAUSED"
        : "INVALIDATED";
      const changed = await tx.autopilotPlan.updateMany({
        where: {
          id: plan.id,
          merchantId: args.merchantId,
          state: fromState,
        },
        data: { state: toState, lockToken: null, lockExpiresAt: null },
      });
      if (changed.count !== 1)
        throw new Error("PRIVACY_ANALYSIS_AUTHORITY_CHANGED");
      const gateSnapshotHash = digest({
        experimentIds,
        privacyAffectedAt: args.now.toISOString(),
      });
      await tx.autopilotTransition.create({
        data: {
          merchantId: args.merchantId,
          planId: plan.id,
          fromState,
          toState,
          actorType: "SYSTEM",
          actorId: "system:privacy",
          reasonCode: "PRIVACY_ANALYSIS_REVIEW_REQUIRED",
          gateSnapshotHash,
          idempotencyKey: `privacy-analysis:${plan.id}`,
        },
      });
      pausedPlanIds.push(plan.id);
    }
    await tx.merchantNotice.upsert({
      where: {
        merchantId_dedupeKey: {
          merchantId: args.merchantId,
          dedupeKey: `privacy-analysis:${plan.id}`,
        },
      },
      create: {
        merchantId: args.merchantId,
        planId: plan.id,
        dedupeKey: `privacy-analysis:${plan.id}`,
        kind: "PRIVACY_ANALYSIS_REVIEW_REQUIRED",
        title: "Experiment result withheld for privacy review",
        detail:
          "Serving is stopped and the immutable report is withheld until governed privacy review is complete.",
        actionLabel: "Review results",
        actionHref: "/app/results",
      },
      update: {
        status: "OPEN",
        resolvedAt: null,
      },
    });
  }

  const entitlement = await tx.betaEntitlement.findUnique({
    where: { merchantId: args.merchantId },
  });
  if (entitlement) {
    const referencedSnapshotIds = [
      entitlement.firstValidResultSnapshotId,
      entitlement.lastResultSnapshotId,
    ].filter((id): id is string => Boolean(id));
    const affectedSnapshotIds = new Set(
      (
        await tx.experimentResultSnapshot.findMany({
          where: {
            id: { in: referencedSnapshotIds },
            experimentId: { in: experimentIds },
          },
          select: { id: true },
        })
      ).map((item) => item.id),
    );
    const invalidFirst = Boolean(
      entitlement.firstValidResultSnapshotId &&
      affectedSnapshotIds.has(entitlement.firstValidResultSnapshotId),
    );
    const invalidLast = Boolean(
      entitlement.lastResultSnapshotId &&
      affectedSnapshotIds.has(entitlement.lastResultSnapshotId),
    );
    if (invalidFirst || invalidLast)
      await tx.betaEntitlement.update({
        where: { merchantId: args.merchantId },
        data: {
          ...(invalidFirst
            ? {
                firstValidResultAt: null,
                firstValidResultState: null,
                firstValidResultSnapshotId: null,
              }
            : {}),
          ...(invalidLast
            ? {
                status: "FREE_UNTIL_VALID_RESULT",
                lastResultSnapshotId: null,
                lastResultState: "PRIVACY_REVIEW_REQUIRED",
                freeExtensionUntil: null,
                revisedExperimentsRemaining: 0,
              }
            : {}),
        },
      });
  }

  return {
    experimentIds,
    newlyRestricted,
    pausedExperiments,
    pausedPlanIds,
    stoppedDeploymentIds,
  };
}

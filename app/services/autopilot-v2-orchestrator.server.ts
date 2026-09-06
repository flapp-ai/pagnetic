import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import type { AutopilotPlanState } from "./autopilot";
import { registerAdaptiveExperiment } from "./adaptive-experiment.server";
import { requireCurrentApprovedAdaptivePackage } from "./adaptive-package.server";
import {
  classifyAutopilotPlanProtocol,
  frozenInputsCurrent,
  transitionAutopilotPlan,
} from "./autopilot-orchestrator.server";
import { reconcileBetaEntitlement } from "./beta-entitlement.server";
import { registerV2Experiment } from "./experiment-registration-v2.server";
import { snapshotOriginalBaselineV2 } from "./original-baseline-v2.server";
import { assertPrivacyAnalysisUsable } from "./privacy-analysis.server";
import { PILOT_QA_KEYS } from "./pilot-setup";
import { installV2Deployment } from "./v2-deployment.server";

const DAY_MS = 86_400_000;
const TERMINAL_V2_RESULTS = new Set([
  "MEASUREMENT_CHECKS_PASSED",
  "FAILED_VALIDATION",
  "POSITIVE",
  "NEGATIVE",
  "INCONCLUSIVE",
  "INVALID",
  "INSUFFICIENT_EVIDENCE",
  "INTERRUPTED",
]);

type BaselineSnapshotter = typeof snapshotOriginalBaselineV2;

function parseProtocol(value: string) {
  const protocol = JSON.parse(value) as Record<string, unknown>;
  const numeric = (key: string) => {
    const result = protocol[key];
    if (typeof result !== "number" || !Number.isFinite(result))
      throw new Error("V2_PLAN_PROTOCOL_INVALID");
    return result;
  };
  return {
    minimumMeaningfulLift: numeric("minimumMeaningfulLift"),
    alpha: numeric("alpha"),
    power: numeric("power"),
    minimumDurationDays: numeric("minimumDurationDays"),
    maximumDurationDays: numeric("maximumDurationDays"),
    dataMaturityLagDays: numeric("dataMaturityLagDays"),
  };
}

function planKey(prefix: string, planId: string) {
  const suffix = planId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(-24);
  return `${prefix}-${suffix}`.slice(0, 64);
}

async function notice(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  key: string;
  title: string;
  detail: string;
  href?: string;
}) {
  return args.db.merchantNotice.upsert({
    where: {
      merchantId_dedupeKey: {
        merchantId: args.merchantId,
        dedupeKey: args.key,
      },
    },
    create: {
      merchantId: args.merchantId,
      planId: args.planId,
      dedupeKey: args.key,
      kind: "V2_PLAN_STATUS",
      title: args.title,
      detail: args.detail,
      actionLabel: "Review status",
      actionHref: args.href ?? "/app",
    },
    update: {
      status: "OPEN",
      title: args.title,
      detail: args.detail,
      actionHref: args.href ?? "/app",
      resolvedAt: null,
    },
  });
}

async function activationGates(args: {
  db: PrismaClient;
  merchantId: string;
  plan: Awaited<ReturnType<typeof loadPlan>>;
  now: Date;
  requireDeploymentEvidence: boolean;
  deploymentEvidenceId?: string | null;
}) {
  const [qaEvidence, pointer] = await Promise.all([
    args.db.qaEvidence.findMany({
      where: { merchantId: args.merchantId, productId: args.plan.productId },
      orderBy: { capturedAt: "desc" },
    }),
    args.db.activeDeployment.findUnique({
      where: { productId: args.plan.productId },
    }),
  ]);
  const latest = new Map<string, (typeof qaEvidence)[number]>();
  for (const item of qaEvidence)
    if (!latest.has(item.checkKey)) latest.set(item.checkKey, item);
  let sourceTemplateSuffix: string | null = null;
  try {
    const source = JSON.parse(args.plan.product.sourceSnapshot) as {
      templateSuffix?: unknown;
    };
    sourceTemplateSuffix =
      typeof source.templateSuffix === "string" && source.templateSuffix.trim()
        ? source.templateSuffix.trim()
        : null;
  } catch {
    sourceTemplateSuffix = null;
  }
  const theme = args.plan.product.themeActivation;
  const validEvidence = (key: string) => {
    const evidence = latest.get(key);
    if (!evidence || !evidence.evidenceRef.trim()) return false;
    const statusAccepted =
      ["PASS", "PASSED"].includes(evidence.status) ||
      (evidence.status === "NOT_APPLICABLE" &&
        evidence.applicability === "NOT_APPLICABLE");
    const fresh = evidence.expiresAt
      ? evidence.expiresAt > args.now
      : args.now.getTime() - evidence.capturedAt.getTime() <= 14 * DAY_MS;
    return (
      statusAccepted &&
      fresh &&
      evidence.capturedAt <= args.now &&
      evidence.themeId === theme?.themeId &&
      (evidence.templateSuffix ?? null) === sourceTemplateSuffix &&
      (!args.requireDeploymentEvidence ||
        (Boolean(args.deploymentEvidenceId ?? pointer?.deploymentVersionId) &&
          evidence.deploymentVersionId ===
            (args.deploymentEvidenceId ?? pointer!.deploymentVersionId)))
    );
  };
  const missingQa = PILOT_QA_KEYS.filter((key) => !validEvidence(key));
  const gates = {
    planApproved: Boolean(args.plan.approvedAt && args.plan.approvalRecordJson),
    productActive: args.plan.product.status === "ACTIVE",
    themeActive:
      theme?.activeOnPublishedTheme === true &&
      theme.extensionStatus === "ACTIVE" &&
      theme.blockHandle === "adaptive-panel" &&
      Boolean(theme.themeId && theme.activationTarget && theme.verifiedAt) &&
      theme.verifiedAt! <= args.now &&
      args.now.getTime() - theme.verifiedAt!.getTime() <= 14 * DAY_MS,
    pixelActive: args.plan.merchant.pixelCredential?.status === "ACTIVE",
    servingEnabled: args.plan.merchant.runtimeControl?.killSwitch !== true,
    missingQa,
    frozenInputsCurrent: false,
  };
  try {
    gates.frozenInputsCurrent = await frozenInputsCurrent({
      db: args.db,
      merchantId: args.merchantId,
      plan: args.plan,
    });
  } catch {
    gates.frozenInputsCurrent = false;
  }
  return {
    ...gates,
    ready:
      gates.planApproved &&
      gates.productActive &&
      gates.themeActive &&
      gates.pixelActive &&
      gates.servingEnabled &&
      gates.frozenInputsCurrent &&
      missingQa.length === 0,
  };
}

async function loadPlan(db: PrismaClient, merchantId: string, planId: string) {
  return db.autopilotPlan.findFirstOrThrow({
    where: { id: planId, merchantId },
    include: {
      product: { include: { themeActivation: true, qaChecks: true } },
      merchant: { include: { pixelCredential: true, runtimeControl: true } },
    },
  });
}

async function currentRevision(db: PrismaClient, productId: string) {
  return (
    (
      await db.activeDeployment.findUnique({
        where: { productId },
        select: { revision: true },
      })
    )?.revision ?? 0
  );
}

async function startBaseline(args: {
  db: PrismaClient;
  merchantId: string;
  plan: Awaited<ReturnType<typeof loadPlan>>;
  now: Date;
  lockToken: string;
}) {
  const protocol = parseProtocol(args.plan.aaProtocolJson);
  const experiment = await registerV2Experiment({
    db: args.db,
    merchantId: args.merchantId,
    productId: args.plan.productId,
    key: planKey("v2-baseline", args.plan.id),
    controlPolicy: "ORIGINAL",
    treatmentPolicy: "ORIGINAL",
    hypothesis:
      "Original-versus-Original validates assignment, capture, checkout linkage and mature focal-product money before a message test.",
    minimumMeaningfulLift: protocol.minimumMeaningfulLift,
    alpha: protocol.alpha,
    power: protocol.power,
    targetSampleSize: 2_000,
    minimumDurationDays: protocol.minimumDurationDays,
    maximumDurationDays: protocol.maximumDurationDays,
    dataMaturityLagDays: protocol.dataMaturityLagDays,
    contentVersions: [],
    mappingVersions: [],
    guardrails: {
      planHash: args.plan.planHash,
      safetyPolicyVersion: args.plan.safetyPolicyVersion,
      checkoutOutcomesPerArm: 100,
      purpose: "ORIGINAL_BASELINE_AND_MEASUREMENT_VALIDATION",
      baselineFixedDeadline: true,
    },
    approvedAuthorityHash: args.plan.planHash,
    now: args.now,
  });
  const revision = await currentRevision(args.db, args.plan.productId);
  const deployment = await installV2Deployment({
    db: args.db,
    merchantId: args.merchantId,
    productId: args.plan.productId,
    planId: args.plan.id,
    experimentId: experiment.id,
    contentVersionId: null,
    policy: "ORIGINAL",
    approvedAuthorityHash: args.plan.planHash,
    expectedRevision: revision,
    idempotencyKey: `v2-plan:${args.plan.id}:baseline`,
    actor: "system:v2-plan",
    receiptAction: "START_V2_ORIGINAL_BASELINE",
    now: args.now,
    afterInstall: async ({ tx, deployment: installed }) => {
      const current = await loadPlan(
        tx as unknown as PrismaClient,
        args.merchantId,
        args.plan.id,
      );
      const gates = await activationGates({
        db: tx as unknown as PrismaClient,
        merchantId: args.merchantId,
        plan: current,
        now: args.now,
        requireDeploymentEvidence: false,
      });
      if (
        current.state !== "VERIFYING" ||
        current.lockToken !== args.lockToken ||
        current.planHash !== args.plan.planHash ||
        !gates.ready
      )
        throw new Error(
          `V2_PLAN_ACTIVATION_AUTHORITY_CHANGED:${JSON.stringify({
            state: current.state,
            lockMatches: current.lockToken === args.lockToken,
            planHashMatches: current.planHash === args.plan.planHash,
            gates,
          })}`,
        );
      const activated = await tx.experiment.updateMany({
        where: {
          id: experiment.id,
          merchantId: args.merchantId,
          status: "DRAFT",
          enrollmentClosedAt: null,
        },
        data: { status: "ACTIVE" },
      });
      if (activated.count !== 1)
        throw new Error("V2_PLAN_EXPERIMENT_ACTIVATION_CONFLICT");
      const advanced = await tx.autopilotPlan.updateMany({
        where: {
          id: args.plan.id,
          merchantId: args.merchantId,
          state: "VERIFYING",
          lockToken: args.lockToken,
          planHash: args.plan.planHash,
          approvedAt: { not: null },
        },
        data: { state: "AA_RUNNING", aaExperimentId: experiment.id },
      });
      if (advanced.count !== 1)
        throw new Error("V2_PLAN_ACTIVATION_AUTHORITY_CHANGED");
      await tx.autopilotTransition.create({
        data: {
          merchantId: args.merchantId,
          planId: args.plan.id,
          fromState: "VERIFYING",
          toState: "AA_RUNNING",
          actorType: "SYSTEM",
          actorId: "system:v2-plan",
          reasonCode: "V2_BASELINE_GATES_PASSED",
          gateSnapshotHash: args.plan.planHash,
          idempotencyKey: `${args.plan.id}:v2-baseline:${experiment.registration!.registrationHash}`,
        },
      });
      await tx.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: "system:v2-plan",
          action: "V2_BASELINE_STARTED",
          resourceType: "AUTOPILOT_PLAN",
          resourceId: args.plan.id,
          detailsJson: JSON.stringify({
            experimentId: experiment.id,
            deploymentId: installed.id,
          }),
        },
      });
    },
  });
  const advanced = await args.db.autopilotPlan.findFirstOrThrow({
    where: { id: args.plan.id, merchantId: args.merchantId },
  });
  return {
    outcome: "V2_BASELINE_STARTED" as const,
    plan: advanced,
    experiment,
    deployment,
  };
}

async function startMessageTest(args: {
  db: PrismaClient;
  merchantId: string;
  plan: Awaited<ReturnType<typeof loadPlan>>;
  qualification: {
    id: string;
    snapshotHash: string;
    targetVisitors: number | null;
    status: string;
  };
  baselineResultId: string;
  now: Date;
  lockToken: string;
}) {
  if (
    args.qualification.status !== "QUALIFIED" ||
    !args.qualification.targetVisitors
  )
    throw new Error("V2_PLAN_QUALIFICATION_REQUIRED");
  const protocol = parseProtocol(args.plan.realExperimentProtocolJson);
  const contentIds = JSON.parse(args.plan.contentVersionIdsJson) as string[];
  const contentHashes = JSON.parse(args.plan.contentHashesJson) as string[];
  const content = contentIds.map((id, index) => ({
    id,
    contentHash: contentHashes[index] ?? "",
  }));
  if (!content[0]?.id || !/^[a-f0-9]{32,128}$/i.test(content[0].contentHash))
    throw new Error("V2_PLAN_APPROVED_CONTENT_INVALID");
  const mappings = JSON.parse(args.plan.mappingVersionsJson) as unknown[];
  const adaptiveReview = await args.db.adaptivePackageReview.findFirst({
    where: { merchantId: args.merchantId, productId: args.plan.productId, status: "APPROVED" },
    orderBy: { approvedAt: "desc" },
  });
  let adaptiveBundleSet: Parameters<typeof installV2Deployment>[0]["adaptiveBundleSet"] = null;
  let adaptiveAuthorityHash = args.plan.planHash;
  let adaptiveContent: Array<{ id: string; contentHash: string }> = [];
  if (adaptiveReview) {
    const current = await requireCurrentApprovedAdaptivePackage({
      db: args.db,
      merchantId: args.merchantId,
      productId: args.plan.productId,
      reviewId: adaptiveReview.id,
    });
    adaptiveBundleSet = current.package.bundleSet;
    adaptiveAuthorityHash = current.package.packageHash;
    adaptiveContent = [...new Map(
      current.package.reviewPayload.mappings.map((item) => [
        item.bundleId,
        { id: item.bundleId, contentHash: item.contentHash },
      ]),
    ).values()];
  }
  if (adaptiveBundleSet && adaptiveContent.length === 0) throw new Error("ADAPTIVE_REVIEW_BUNDLE_EMPTY");
  const mappingVersions = adaptiveBundleSet
    ? adaptiveBundleSet.snapshot.mappings.map((item) => ({
        campaignRef: item.campaignRef,
        mappingVersion: item.mappingVersion,
        bundleId: item.bundleId,
      }))
    : mappings;
  const registrationCommon = {
    db: args.db,
    merchantId: args.merchantId,
    productId: args.plan.productId,
    key: planKey("v2-message", args.plan.id),
    minimumMeaningfulLift: protocol.minimumMeaningfulLift,
    alpha: protocol.alpha,
    power: protocol.power,
    targetSampleSize: args.qualification.targetVisitors,
    minimumDurationDays: protocol.minimumDurationDays,
    maximumDurationDays: protocol.maximumDurationDays,
    dataMaturityLagDays: protocol.dataMaturityLagDays,
    contentVersions: adaptiveBundleSet ? adaptiveContent : [content[0]],
    mappingVersions,
    guardrails: {
      planHash: args.plan.planHash,
      safetyPolicyVersion: args.plan.safetyPolicyVersion,
      qualificationSnapshotId: args.qualification.id,
      qualificationSnapshotHash: args.qualification.snapshotHash,
      baselineResultSnapshotId: args.baselineResultId,
      checkoutOutcomesPerArm: 100,
      ...(adaptiveBundleSet ? { adaptivePackageHash: adaptiveAuthorityHash } : {}),
    },
    approvedAuthorityHash: adaptiveAuthorityHash,
    now: args.now,
  };
  const experiment = adaptiveBundleSet
    ? await registerAdaptiveExperiment({
        ...registrationCommon,
        comparison: "ORIGINAL_MATCHED",
      })
    : await registerV2Experiment({
        ...registrationCommon,
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "UNIVERSAL",
        hypothesis:
          "The approved source-backed Universal panel changes net focal-product merchandise revenue per assigned visitor versus the Original PDP.",
      });
  const priorPointer = await args.db.activeDeployment.findUniqueOrThrow({
    where: { productId: args.plan.productId },
  });
  const revision = priorPointer.revision;
  const deployment = await installV2Deployment({
    db: args.db,
    merchantId: args.merchantId,
    productId: args.plan.productId,
    planId: args.plan.id,
    experimentId: experiment.id,
    contentVersionId: adaptiveBundleSet ? adaptiveContent[0].id : content[0].id,
    policy: adaptiveBundleSet ? "MATCHED" : "UNIVERSAL",
    adaptiveBundleSet,
    approvedAuthorityHash: adaptiveAuthorityHash,
    expectedRevision: revision,
    idempotencyKey: `v2-plan:${args.plan.id}:message`,
    actor: "system:v2-plan",
    receiptAction: "START_V2_MESSAGE_TEST",
    now: args.now,
    afterInstall: async ({ tx, deployment: installed }) => {
      if (adaptiveReview) {
        const authority = await tx.adaptivePackageReview.findFirst({
          where: {
            id: adaptiveReview.id,
            merchantId: args.merchantId,
            productId: args.plan.productId,
            packageHash: adaptiveAuthorityHash,
            status: "APPROVED",
          },
          select: { id: true },
        });
        if (!authority) throw new Error("ADAPTIVE_REVIEW_AUTHORITY_CHANGED");
      }
      const current = await loadPlan(
        tx as unknown as PrismaClient,
        args.merchantId,
        args.plan.id,
      );
      const gates = await activationGates({
        db: tx as unknown as PrismaClient,
        merchantId: args.merchantId,
        plan: current,
        now: args.now,
        requireDeploymentEvidence: true,
        deploymentEvidenceId: priorPointer.deploymentVersionId,
      });
      if (
        current.state !== "AA_RUNNING" ||
        current.lockToken !== args.lockToken ||
        current.planHash !== args.plan.planHash ||
        !gates.ready ||
        current.aaExperimentId == null
      )
        throw new Error(
          `V2_PLAN_ACTIVATION_AUTHORITY_CHANGED:${JSON.stringify({
            state: current.state,
            lockMatches: current.lockToken === args.lockToken,
            planHashMatches: current.planHash === args.plan.planHash,
            gates,
          })}`,
        );
      const activated = await tx.experiment.updateMany({
        where: {
          id: experiment.id,
          merchantId: args.merchantId,
          status: "DRAFT",
          enrollmentClosedAt: null,
        },
        data: { status: "ACTIVE" },
      });
      if (activated.count !== 1)
        throw new Error("V2_PLAN_EXPERIMENT_ACTIVATION_CONFLICT");
      const advanced = await tx.autopilotPlan.updateMany({
        where: {
          id: args.plan.id,
          merchantId: args.merchantId,
          state: "AA_RUNNING",
          lockToken: args.lockToken,
          planHash: args.plan.planHash,
          approvedAt: { not: null },
          aaExperimentId: current.aaExperimentId,
        },
        data: { state: "REAL_TEST_RUNNING", realExperimentId: experiment.id },
      });
      if (advanced.count !== 1)
        throw new Error("V2_PLAN_ACTIVATION_AUTHORITY_CHANGED");
      await tx.autopilotTransition.create({
        data: {
          merchantId: args.merchantId,
          planId: args.plan.id,
          fromState: "AA_RUNNING",
          toState: "REAL_TEST_RUNNING",
          actorType: "SYSTEM",
          actorId: "system:v2-plan",
          reasonCode: "V2_BASELINE_QUALIFIED",
          gateSnapshotHash: args.qualification.snapshotHash,
          idempotencyKey: `${args.plan.id}:v2-message:${experiment.registration!.registrationHash}`,
        },
      });
      await tx.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: "system:v2-plan",
          action: "V2_MESSAGE_TEST_STARTED",
          resourceType: "AUTOPILOT_PLAN",
          resourceId: args.plan.id,
          detailsJson: JSON.stringify({
            experimentId: experiment.id,
            deploymentId: installed.id,
            qualificationSnapshotId: args.qualification.id,
            baselineResultId: args.baselineResultId,
          }),
        },
      });
    },
  });
  const advanced = await args.db.autopilotPlan.findFirstOrThrow({
    where: { id: args.plan.id, merchantId: args.merchantId },
  });
  return {
    outcome: "V2_MESSAGE_TEST_STARTED" as const,
    plan: advanced,
    experiment,
    deployment,
  };
}

export async function advanceAutopilotPlanV2(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  now?: Date;
  snapshotBaseline?: BaselineSnapshotter;
}) {
  const now = args.now ?? new Date();
  const lockToken = randomUUID();
  const locked = await args.db.autopilotPlan.updateMany({
    where: {
      id: args.planId,
      merchantId: args.merchantId,
      OR: [{ lockToken: null }, { lockExpiresAt: { lt: now } }],
    },
    data: { lockToken, lockExpiresAt: new Date(now.getTime() + 2 * 60_000) },
  });
  if (locked.count !== 1) return { outcome: "LOCKED" as const };
  try {
    let plan = await loadPlan(args.db, args.merchantId, args.planId);
    if (classifyAutopilotPlanProtocol(plan) !== "MVP_V2")
      return { outcome: "PROTOCOL_MISMATCH" as const };
    const state = plan.state as AutopilotPlanState;
    const linkedExperimentIds = [
      plan.aaExperimentId,
      plan.realExperimentId,
    ].filter((id): id is string => Boolean(id));
    const privacyRestricted = linkedExperimentIds.length
      ? await args.db.experiment.findFirst({
          where: {
            id: { in: linkedExperimentIds },
            merchantId: args.merchantId,
            privacyAffectedAt: { not: null },
          },
          select: { id: true },
        })
      : null;
    if (privacyRestricted)
      return {
        outcome: "V2_PRIVACY_ANALYSIS_REVIEW_REQUIRED" as const,
        experimentId: privacyRestricted.id,
      };
    if (!["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING"].includes(state))
      return { outcome: "NO_ACTION" as const, state };
    if (state !== "REAL_TEST_RUNNING") {
      const gates = await activationGates({
        db: args.db,
        merchantId: args.merchantId,
        plan,
        now,
        requireDeploymentEvidence: state !== "VERIFYING",
      });
      if (!gates.ready) {
        await notice({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          key: `v2-gates:${plan.id}`,
          title: "Pagnetic kept the Original storefront active",
          detail: `Required reviewed evidence is incomplete: ${[
            !gates.planApproved && "approval",
            !gates.productActive && "active product",
            !gates.themeActive && "published theme",
            !gates.pixelActive && "Web Pixel",
            !gates.servingEnabled && "serving pause",
            !gates.frozenInputsCurrent && "unchanged approved inputs",
            ...gates.missingQa,
          ]
            .filter(Boolean)
            .join(", ")}.`,
        });
        return { outcome: "GATES_BLOCKED" as const, gates };
      }
    }
    if (state === "VERIFYING") {
      return await startBaseline({ ...args, plan, now, lockToken });
    }

    if (state === "AA_RUNNING") {
      if (!plan.aaExperimentId)
        throw new Error("V2_PLAN_BASELINE_EXPERIMENT_MISSING");
      const baselineExperiment = await args.db.experiment.findFirstOrThrow({
        where: {
          id: plan.aaExperimentId,
          merchantId: args.merchantId,
          productId: plan.productId,
          lifecycleVersion: 2,
        },
        include: { registration: true },
      });
      if (!baselineExperiment.finalResultSnapshotId)
        return { outcome: "V2_BASELINE_COLLECTING" as const };
      assertPrivacyAnalysisUsable(baselineExperiment);
      const result = await args.db.experimentResultSnapshot.findFirstOrThrow({
        where: {
          id: baselineExperiment.finalResultSnapshotId,
          experimentId: baselineExperiment.id,
        },
      });
      if (result.resultState !== "MEASUREMENT_CHECKS_PASSED") {
        const failed = await transitionAutopilotPlan({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          fromState: "AA_RUNNING",
          toState: "AA_FAILED",
          actorType: "SYSTEM",
          actorId: "system:v2-plan",
          reasonCode: `V2_BASELINE_${result.resultState}`,
          gateSnapshot: {
            resultId: result.id,
            resultState: result.resultState,
          },
        });
        return { outcome: "V2_BASELINE_FAILED" as const, plan: failed, result };
      }
      const enrollmentStart =
        baselineExperiment.enrollmentStartedAt ?? baselineExperiment.startedAt;
      const closedAt = baselineExperiment.enrollmentClosedAt;
      if (!closedAt) return { outcome: "V2_BASELINE_COLLECTING" as const };
      const fullDays = Math.floor(
        (closedAt.getTime() - enrollmentStart.getTime()) / DAY_MS,
      );
      if (fullDays < 7) throw new Error("V2_BASELINE_WINDOW_INVALID");
      const protocol = parseProtocol(plan.realExperimentProtocolJson);
      const baseline = await (
        args.snapshotBaseline ?? snapshotOriginalBaselineV2
      )({
        db: args.db,
        merchantId: args.merchantId,
        productId: plan.productId,
        experimentId: baselineExperiment.id,
        observationStart: enrollmentStart,
        observationEnd: new Date(enrollmentStart.getTime() + fullDays * DAY_MS),
        targetEffect: protocol.minimumMeaningfulLift,
        now,
      });
      if (!baseline.snapshot || baseline.snapshot.status !== "QUALIFIED") {
        const failed = await transitionAutopilotPlan({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          fromState: "AA_RUNNING",
          toState: "AA_FAILED",
          actorType: "SYSTEM",
          actorId: "system:v2-plan",
          reasonCode: "V2_BASELINE_NOT_QUALIFIED",
          gateSnapshot: {
            resultId: result.id,
            state: baseline.state,
            reasons: baseline.reasons,
          },
        });
        return {
          outcome: "V2_BASELINE_NOT_QUALIFIED" as const,
          plan: failed,
          baseline,
        };
      }
      plan = await loadPlan(args.db, args.merchantId, args.planId);
      const currentGates = await activationGates({
        db: args.db,
        merchantId: args.merchantId,
        plan,
        now,
        requireDeploymentEvidence: true,
      });
      if (!currentGates.ready)
        return { outcome: "GATES_BLOCKED" as const, gates: currentGates };
      return await startMessageTest({
        db: args.db,
        merchantId: args.merchantId,
        plan,
        qualification: baseline.snapshot,
        baselineResultId: result.id,
        now,
        lockToken,
      });
    }

    if (!plan.realExperimentId)
      throw new Error("V2_PLAN_MESSAGE_EXPERIMENT_MISSING");
    const experiment = await args.db.experiment.findFirstOrThrow({
      where: {
        id: plan.realExperimentId,
        merchantId: args.merchantId,
        productId: plan.productId,
        lifecycleVersion: 2,
      },
    });
    assertPrivacyAnalysisUsable(experiment);
    if (!experiment.finalResultSnapshotId)
      return { outcome: "V2_MESSAGE_TEST_COLLECTING" as const };
    const result = await args.db.experimentResultSnapshot.findFirstOrThrow({
      where: {
        id: experiment.finalResultSnapshotId,
        experimentId: experiment.id,
      },
    });
    if (
      !TERMINAL_V2_RESULTS.has(result.resultState) ||
      result.resultState === "MEASUREMENT_CHECKS_PASSED"
    )
      return { outcome: "V2_MESSAGE_TEST_COLLECTING" as const };
    const completed = await transitionAutopilotPlan({
      db: args.db,
      merchantId: args.merchantId,
      planId: plan.id,
      fromState: "REAL_TEST_RUNNING",
      toState: "RESULT_READY",
      actorType: "SYSTEM",
      actorId: "system:v2-plan",
      reasonCode: "V2_FINAL_RESULT_PINNED",
      gateSnapshot: {
        resultId: result.id,
        dataHash: result.dataHash,
        resultState: result.resultState,
      },
      update: { resultSnapshotId: result.id },
    });
    await reconcileBetaEntitlement({
      db: args.db,
      merchantId: args.merchantId,
      snapshotId: result.id,
      actor: "system:v2-plan",
    });
    await notice({
      db: args.db,
      merchantId: args.merchantId,
      planId: plan.id,
      key: `v2-result:${plan.id}`,
      title: "Your frozen Pagnetic result is ready",
      detail:
        "Review the exact registered comparison before choosing keep, revise or stop.",
      href: "/app/results",
    });
    return { outcome: "V2_RESULT_READY" as const, plan: completed, result };
  } finally {
    await args.db.autopilotPlan.updateMany({
      where: { id: args.planId, lockToken },
      data: { lockToken: null, lockExpiresAt: null },
    });
  }
}

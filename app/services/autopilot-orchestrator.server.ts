import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  autopilotHash,
  autopilotPlanMaterial,
  canTransitionAutopilot,
  type AutopilotPlanState,
} from "./autopilot";
import { reconcileBetaEntitlement } from "./beta-entitlement.server";
import {
  LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_PROTOCOL_VERSION,
} from "./mvp-v2";
import { hashValue } from "./governance.server";
import { registerExperiment } from "./measurement.server";
import { PILOT_QA_KEYS } from "./pilot-setup";
import { refreshAutopilotBaseline } from "./autopilot-preparation.server";

async function setPlanNotice(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  dedupeKey: string;
  kind: string;
  title: string;
  detail: string;
  actionLabel?: string;
}) {
  return args.db.merchantNotice.upsert({
    where: {
      merchantId_dedupeKey: {
        merchantId: args.merchantId,
        dedupeKey: args.dedupeKey,
      },
    },
    create: {
      merchantId: args.merchantId,
      planId: args.planId,
      dedupeKey: args.dedupeKey,
      kind: args.kind,
      title: args.title,
      detail: args.detail,
      actionLabel: args.actionLabel,
      actionHref: "/app",
    },
    update: {
      status: "OPEN",
      title: args.title,
      detail: args.detail,
      actionLabel: args.actionLabel,
      resolvedAt: null,
    },
  });
}

function eventForTransition(
  state: AutopilotPlanState,
  actorType: "MERCHANT" | "SYSTEM" | "OPERATOR",
) {
  const events: Partial<Record<AutopilotPlanState, string>> = {
    VERIFYING: "theme_verified",
    AA_RUNNING: "aa_started",
    AA_FAILED: "aa_failed",
    REAL_TEST_RUNNING: "real_experiment_started",
    PAUSED: actorType === "SYSTEM" ? "experiment_auto_paused" : "plan_paused",
    RESULT_READY: "result_ready",
    INVALIDATED: "activation_blocked",
  };
  return events[state] ?? "autopilot_transition";
}

export async function transitionAutopilotPlan(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  fromState: AutopilotPlanState;
  toState: AutopilotPlanState;
  actorType: "MERCHANT" | "SYSTEM" | "OPERATOR";
  actorId: string;
  reasonCode: string;
  gateSnapshot: unknown;
  update?: Record<string, unknown>;
}) {
  if (!canTransitionAutopilot(args.fromState, args.toState))
    throw new Error(
      `Autopilot cannot transition from ${args.fromState} to ${args.toState}.`,
    );
  const gateSnapshotHash = autopilotHash(args.gateSnapshot);
  const idempotencyKey = `${args.planId}:${args.fromState}:${args.toState}:${args.reasonCode}:${gateSnapshotHash}`;
  const existing = await args.db.autopilotTransition.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return args.db.autopilotPlan.findFirstOrThrow({
      where: { id: args.planId, merchantId: args.merchantId },
    });
  }
  return args.db.$transaction(async (tx) => {
    const changed = await tx.autopilotPlan.updateMany({
      where: {
        id: args.planId,
        merchantId: args.merchantId,
        state: args.fromState,
      },
      data: { state: args.toState, ...(args.update ?? {}) },
    });
    if (!changed.count) {
      const current = await tx.autopilotPlan.findFirstOrThrow({
        where: { id: args.planId, merchantId: args.merchantId },
      });
      if (current.state === args.toState) return current;
      throw new Error("Autopilot state changed before this gate completed.");
    }
    await tx.autopilotTransition.create({
      data: {
        merchantId: args.merchantId,
        planId: args.planId,
        fromState: args.fromState,
        toState: args.toState,
        actorType: args.actorType,
        actorId: args.actorId,
        reasonCode: args.reasonCode,
        gateSnapshotHash,
        idempotencyKey,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actorId,
        action: eventForTransition(args.toState, args.actorType),
        resourceType: "AUTOPILOT_PLAN",
        resourceId: args.planId,
        detailsJson: JSON.stringify({
          fromState: args.fromState,
          toState: args.toState,
          reasonCode: args.reasonCode,
          gateSnapshotHash,
        }),
      },
    });
    return tx.autopilotPlan.findUniqueOrThrow({ where: { id: args.planId } });
  });
}

export async function markAutopilotVerifying(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  actor: string;
  themeActive: boolean;
}) {
  const plan = await args.db.autopilotPlan.findFirst({
    where: { id: args.planId, merchantId: args.merchantId },
  });
  if (!plan) throw new Error("Autopilot plan was not found for this store.");
  if (!args.themeActive) {
    await setPlanNotice({
      db: args.db,
      merchantId: args.merchantId,
      planId: plan.id,
      dedupeKey: `theme-save:${plan.id}`,
      kind: "THEME_SAVE_REQUIRED",
      title: "The panel is not saved on the published theme yet",
      detail: "Open Shopify, preview the panel, click Save, then check again.",
      actionLabel: "Open theme editor",
    });
    return plan;
  }
  if (plan.state === "VERIFYING") return plan;
  if (plan.state !== "WAITING_FOR_THEME")
    throw new Error("This plan is not waiting for theme enablement.");
  await args.db.merchantNotice.updateMany({
    where: {
      merchantId: args.merchantId,
      planId: plan.id,
      kind: "THEME_SAVE_REQUIRED",
      status: "OPEN",
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
  return transitionAutopilotPlan({
    db: args.db,
    merchantId: args.merchantId,
    planId: plan.id,
    fromState: "WAITING_FOR_THEME",
    toState: "VERIFYING",
    actorType: "MERCHANT",
    actorId: args.actor,
    reasonCode: "PUBLISHED_THEME_VERIFIED",
    gateSnapshot: { themeActive: true, productId: plan.productId },
  });
}

function registrationFromJson(value: string) {
  const protocol = JSON.parse(value) as {
    protocolVersion: string;
    revenueDefinition: "GROSS" | "NET";
    minimumMeaningfulLift: number;
    alpha: number;
    power: number;
    targetSampleSize: number;
    minimumDurationDays: number;
    maximumDurationDays: number;
    dataMaturityLagDays: number;
  };
  return {
    protocolVersion: protocol.protocolVersion,
    revenueDefinition: protocol.revenueDefinition,
    minimumMeaningfulLift: protocol.minimumMeaningfulLift,
    alpha: protocol.alpha,
    power: protocol.power,
    targetSampleSize: protocol.targetSampleSize,
    minimumDurationDays: protocol.minimumDurationDays,
    maximumDurationDays: protocol.maximumDurationDays,
    dataMaturityLagDays: protocol.dataMaturityLagDays,
  };
}

export async function frozenInputsCurrent(args: {
  db: PrismaClient;
  merchantId: string;
  plan: {
    planHash: string;
    productId: string;
    candidateScoreSnapshotJson: string;
    contentVersionIdsJson: string;
    contentHashesJson: string;
    evidenceSnapshotHash: string;
    mappingVersionsJson: string;
    unknownTrafficPolicy: string;
    aaProtocolJson: string;
    realExperimentProtocolJson: string;
    safetyPolicyVersion: string;
    orchestrationProtocolVersion: string;
    cutoverReceiptId: string | null;
    authorizedTransitionsJson: string;
    approvalRecordJson: string | null;
  };
}) {
  const contentIds = JSON.parse(args.plan.contentVersionIdsJson) as string[];
  const expectedHashes = JSON.parse(args.plan.contentHashesJson) as string[];
  const content = await args.db.experienceVersion.findMany({
    where: { id: { in: contentIds }, merchantId: args.merchantId },
    include: {
      claims: { include: { evidenceLinks: { include: { evidence: true } } } },
    },
  });
  if (
    content.length !== contentIds.length ||
    content.some(
      (item) => item.status !== "APPROVED_ACTIVE" || item.staleAt != null,
    ) ||
    autopilotHash(content.map((item) => item.contentHash).sort()) !==
      autopilotHash(expectedHashes.sort())
  )
    return false;
  const evidenceSnapshot = content
    .flatMap((experience) =>
      experience.claims.flatMap((claim) =>
        claim.evidenceLinks.map(({ evidence }) => ({
          id: evidence.id,
          sourceHash: evidence.sourceHash,
          sourceVersion: evidence.sourceVersion,
        })),
      ),
    )
    .filter(
      (item, index, all) =>
        all.findIndex((other) => other.id === item.id) === index,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (autopilotHash(evidenceSnapshot) !== args.plan.evidenceSnapshotHash)
    return false;
  const mappings = JSON.parse(args.plan.mappingVersionsJson) as Array<{
    id: string;
    version: number;
    signature: string;
  }>;
  if (
    !Array.isArray(mappings) ||
    mappings.some(
      (mapping) =>
        typeof mapping?.id !== "string" ||
        typeof mapping?.version !== "number" ||
        typeof mapping?.signature !== "string",
    )
  )
    return false;
  if (mappings.length) {
    const currentMappings = await args.db.campaignMapping.findMany({
      where: { id: { in: mappings.map((item) => item.id) }, status: "ACTIVE" },
    });
    if (
      currentMappings.length !== mappings.length ||
      !currentMappings.every((item) =>
        mappings.some(
          (expected) =>
            expected.id === item.id &&
            expected.version === item.version &&
            expected.signature === item.signature,
        ),
      )
    )
      return false;
  }
  const candidateScoreSnapshot = JSON.parse(
    args.plan.candidateScoreSnapshotJson,
  ) as unknown;
  const aaProtocol = JSON.parse(args.plan.aaProtocolJson) as unknown;
  const realExperimentProtocol = JSON.parse(
    args.plan.realExperimentProtocolJson,
  ) as unknown;
  const authorizedTransitions = JSON.parse(
    args.plan.authorizedTransitionsJson,
  ) as unknown;
  const currentPlanHash = autopilotHash(
    autopilotPlanMaterial({
      productId: args.plan.productId,
      candidateScoreSnapshot,
      contentVersionIds: contentIds,
      contentHashes: expectedHashes,
      evidenceSnapshotHash: args.plan.evidenceSnapshotHash,
      mappingVersions: mappings,
      unknownTrafficPolicy: args.plan.unknownTrafficPolicy,
      aaProtocol,
      realExperimentProtocol,
      safetyPolicyVersion: args.plan.safetyPolicyVersion,
      authorizedTransitions,
      cutoverReceiptId: args.plan.cutoverReceiptId ?? undefined,
    }),
  );
  if (currentPlanHash !== args.plan.planHash || !args.plan.approvalRecordJson)
    return false;
  const approval = JSON.parse(args.plan.approvalRecordJson) as {
    planHash?: string;
    contentVersionIds?: string[];
    contentHashes?: string[];
    evidenceSnapshotHash?: string;
    mappingVersions?: unknown[];
    aaProtocolHash?: string;
    realProtocolHash?: string;
    safetyPolicyVersion?: string;
    orchestrationProtocolVersion?: string;
    cutoverReceiptId?: string | null;
    grantedActions?: unknown;
  };
  const approvalProtocolMatches =
    approval.orchestrationProtocolVersion ===
      args.plan.orchestrationProtocolVersion ||
    (args.plan.orchestrationProtocolVersion ===
      LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION &&
      approval.orchestrationProtocolVersion == null);
  const approvalCutoverMatches =
    args.plan.orchestrationProtocolVersion ===
    LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION
      ? args.plan.cutoverReceiptId == null && approval.cutoverReceiptId == null
      : Boolean(args.plan.cutoverReceiptId) &&
        approval.cutoverReceiptId === args.plan.cutoverReceiptId;
  return (
    approval.planHash === args.plan.planHash &&
    autopilotHash(approval.contentVersionIds ?? []) ===
      autopilotHash([...contentIds].sort()) &&
    autopilotHash(approval.contentHashes ?? []) ===
      autopilotHash([...expectedHashes].sort()) &&
    approval.evidenceSnapshotHash === args.plan.evidenceSnapshotHash &&
    autopilotHash(approval.mappingVersions ?? []) === autopilotHash(mappings) &&
    approval.aaProtocolHash === hashValue(aaProtocol) &&
    approval.realProtocolHash === hashValue(realExperimentProtocol) &&
    approval.safetyPolicyVersion === args.plan.safetyPolicyVersion &&
    approvalProtocolMatches &&
    approvalCutoverMatches &&
    autopilotHash(approval.grantedActions) ===
      autopilotHash(authorizedTransitions)
  );
}

type PersistedPlanProtocol = {
  orchestrationProtocolVersion: string;
  aaProtocolJson: string;
  realExperimentProtocolJson: string;
  approvedAt: Date | null;
  approvalRecordJson: string | null;
  cutoverReceiptId: string | null;
};

function storedProtocolVersion(value: string) {
  try {
    const parsed = JSON.parse(value) as { protocolVersion?: unknown };
    return typeof parsed.protocolVersion === "string"
      ? parsed.protocolVersion
      : null;
  } catch {
    return null;
  }
}

export function classifyAutopilotPlanProtocol(
  plan: PersistedPlanProtocol,
): "LEGACY_V1" | "MVP_V2" | "INVALID" {
  if (
    plan.orchestrationProtocolVersion ===
    LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION
  ) {
    if (plan.cutoverReceiptId) return "INVALID";
    if (
      storedProtocolVersion(plan.aaProtocolJson) === MVP_V2_PROTOCOL_VERSION ||
      storedProtocolVersion(plan.realExperimentProtocolJson) ===
        MVP_V2_PROTOCOL_VERSION
    )
      return "INVALID";
    if (!plan.approvalRecordJson) return "LEGACY_V1";
    try {
      const approval = JSON.parse(plan.approvalRecordJson) as {
        orchestrationProtocolVersion?: unknown;
      };
      const approvedProtocol = approval.orchestrationProtocolVersion;
      return approvedProtocol == null ||
        approvedProtocol === LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION
        ? "LEGACY_V1"
        : "INVALID";
    } catch {
      // Legacy activation still owns malformed historical approvals so its
      // existing frozen-input path can invalidate them with the normal audit.
      return "LEGACY_V1";
    }
  }
  let approvedProtocol: string | null | undefined;
  let approvedCutoverReceiptId: string | null | undefined;
  if (plan.approvalRecordJson) {
    try {
      const approval = JSON.parse(plan.approvalRecordJson) as {
        orchestrationProtocolVersion?: unknown;
        cutoverReceiptId?: unknown;
      };
      approvedProtocol =
        typeof approval.orchestrationProtocolVersion === "string"
          ? approval.orchestrationProtocolVersion
          : null;
      approvedCutoverReceiptId =
        typeof approval.cutoverReceiptId === "string"
          ? approval.cutoverReceiptId
          : null;
    } catch {
      return "INVALID";
    }
  }
  if (
    plan.orchestrationProtocolVersion !==
    MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION
  )
    return "INVALID";
  if (!plan.cutoverReceiptId) return "INVALID";
  if (
    storedProtocolVersion(plan.aaProtocolJson) !== MVP_V2_PROTOCOL_VERSION ||
    storedProtocolVersion(plan.realExperimentProtocolJson) !==
      MVP_V2_PROTOCOL_VERSION
  )
    return "INVALID";
  if (
    plan.approvedAt &&
    (approvedProtocol !== MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION ||
      approvedCutoverReceiptId !== plan.cutoverReceiptId)
  )
    return "INVALID";
  return "MVP_V2";
}

export async function advanceAutopilotPlanLegacy(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const lockToken = randomUUID();
  const locked = await args.db.autopilotPlan.updateMany({
    where: {
      id: args.planId,
      merchantId: args.merchantId,
      OR: [{ lockToken: null }, { lockExpiresAt: { lt: now } }],
    },
    data: {
      lockToken,
      lockExpiresAt: new Date(now.getTime() + 2 * 60 * 1000),
    },
  });
  if (!locked.count) return { outcome: "LOCKED" as const };
  try {
    const plan = await args.db.autopilotPlan.findFirstOrThrow({
      where: { id: args.planId, merchantId: args.merchantId },
      include: {
        product: {
          include: {
            qualification: true,
            themeActivation: true,
            qaChecks: true,
          },
        },
        merchant: { include: { pixelCredential: true, runtimeControl: true } },
      },
    });
    if (classifyAutopilotPlanProtocol(plan) !== "LEGACY_V1")
      return { outcome: "PROTOCOL_MISMATCH" as const };
    const state = plan.state as AutopilotPlanState;
    if (
      [
        "PREPARING",
        "READY_FOR_APPROVAL",
        "WAITING_FOR_THEME",
        "RESULT_READY",
        "INVALIDATED",
        "PAUSED",
        "AA_FAILED",
      ].includes(state)
    )
      return { outcome: "NO_ACTION" as const, state };

    if (plan.merchant.runtimeControl?.killSwitch) {
      const paused = await transitionAutopilotPlan({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        fromState: state,
        toState: "PAUSED",
        actorType: "SYSTEM",
        actorId: "system:safety",
        reasonCode: "RUNTIME_KILL_SWITCH",
        gateSnapshot: { killSwitch: true },
      });
      return { outcome: "PAUSED" as const, plan: paused };
    }
    let inputsCurrent = false;
    try {
      inputsCurrent = await frozenInputsCurrent({
        db: args.db,
        merchantId: args.merchantId,
        plan,
      });
    } catch {
      inputsCurrent = false;
    }
    if (!inputsCurrent) {
      const invalidated = await transitionAutopilotPlan({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        fromState: state,
        toState: "INVALIDATED",
        actorType: "SYSTEM",
        actorId: "system:autopilot",
        reasonCode: "FROZEN_INPUT_DRIFT",
        gateSnapshot: {
          content: plan.contentHashesJson,
          mappings: plan.mappingVersionsJson,
        },
      });
      await setPlanNotice({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        dedupeKey: `source-changed:${plan.id}`,
        kind: "SOURCE_CHANGED",
        title: "The approved source changed",
        detail:
          "Pagnetic invalidated the old authority and kept Original active.",
        actionLabel: "Review refreshed plan",
      });
      return { outcome: "INVALIDATED" as const, plan: invalidated };
    }

    if (state === "VERIFYING") {
      const refreshedQualification = await refreshAutopilotBaseline({
        db: args.db,
        merchantId: args.merchantId,
        productId: plan.productId,
        now,
      });
      const qualificationReady =
        ["READY", "LIMITED"].includes(
          refreshedQualification?.status ??
            plan.product.qualification?.status ??
            "",
        ) || Boolean(plan.product.qualification?.overriddenAt);
      const qaPassed = new Set(
        plan.product.qaChecks
          .filter((check) => check.status === "PASSED")
          .map((check) => check.key),
      );
      const missingQa = PILOT_QA_KEYS.filter((key) => !qaPassed.has(key));
      const gates = {
        productActive: plan.product.status === "ACTIVE",
        themeActive:
          plan.product.themeActivation?.activeOnPublishedTheme === true,
        qualificationReady,
        pixelActive: plan.merchant.pixelCredential?.status === "ACTIVE",
        missingQa,
      };
      if (
        !gates.productActive ||
        !gates.themeActive ||
        !gates.qualificationReady ||
        !gates.pixelActive ||
        missingQa.length
      ) {
        await setPlanNotice({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          dedupeKey: `activation-blocked:${plan.id}`,
          kind: qualificationReady
            ? "ACTIVATION_BLOCKED"
            : "INSUFFICIENT_TRAFFIC",
          title: qualificationReady
            ? "Storefront verification is not complete"
            : "More baseline traffic evidence is needed",
          detail: `Original remains active. Missing: ${[
            !gates.productActive && "active product",
            !gates.themeActive && "published theme block",
            !gates.qualificationReady && "traffic qualification",
            !gates.pixelActive && "Web Pixel",
            ...missingQa,
          ]
            .filter(Boolean)
            .join(", ")}.`,
          actionLabel: "Review one blocker",
        });
        return { outcome: "GATES_BLOCKED" as const, gates };
      }
      const experiment = await registerExperiment({
        db: args.db,
        merchantId: args.merchantId,
        productId: plan.productId,
        key: `autopilot-aa-${plan.id.slice(-12).toLowerCase()}`,
        controlPercentage: 50,
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "ORIGINAL",
        initialStatus: "ACTIVE",
        registration: registrationFromJson(plan.aaProtocolJson),
      });
      const advanced = await transitionAutopilotPlan({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        fromState: "VERIFYING",
        toState: "AA_RUNNING",
        actorType: "SYSTEM",
        actorId: "system:autopilot",
        reasonCode: "ALL_ACTIVATION_GATES_PASSED",
        gateSnapshot: gates,
        update: { aaExperimentId: experiment.id },
      });
      return { outcome: "AA_STARTED" as const, plan: advanced, experiment };
    }

    if (state === "AA_RUNNING") {
      const snapshot = plan.aaExperimentId
        ? await args.db.experimentResultSnapshot.findFirst({
            where: { experimentId: plan.aaExperimentId },
            orderBy: { createdAt: "desc" },
          })
        : null;
      if (!snapshot) return { outcome: "AA_COLLECTING" as const };
      if (["FAILED_VALIDATION", "INVALID"].includes(snapshot.resultState)) {
        await args.db.experiment.updateMany({
          where: { id: plan.aaExperimentId ?? "", merchantId: args.merchantId },
          data: { status: "PAUSED", endedAt: snapshot.createdAt },
        });
        const failed = await transitionAutopilotPlan({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          fromState: "AA_RUNNING",
          toState: "AA_FAILED",
          actorType: "SYSTEM",
          actorId: "system:autopilot",
          reasonCode: "AA_VALIDATION_FAILED",
          gateSnapshot: {
            snapshotId: snapshot.id,
            resultState: snapshot.resultState,
          },
        });
        await setPlanNotice({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          dedupeKey: `aa-failed:${plan.id}`,
          kind: "ACTIVATION_BLOCKED",
          title: "Measurement validation did not pass",
          detail: "The real experiment did not start. Original remains active.",
          actionLabel: "Review measurement",
        });
        return { outcome: "AA_FAILED" as const, plan: failed };
      }
      if (snapshot.resultState !== "VALIDATED")
        return { outcome: "AA_COLLECTING" as const };
      await args.db.experiment.updateMany({
        where: { id: plan.aaExperimentId ?? "", merchantId: args.merchantId },
        data: { status: "COMPLETED", endedAt: snapshot.createdAt },
      });
      const experiment = await registerExperiment({
        db: args.db,
        merchantId: args.merchantId,
        productId: plan.productId,
        key: `autopilot-stage1-${plan.id.slice(-12).toLowerCase()}`,
        controlPercentage: 50,
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "UNIVERSAL",
        initialStatus: "ACTIVE",
        registration: registrationFromJson(plan.realExperimentProtocolJson),
      });
      const advanced = await transitionAutopilotPlan({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        fromState: "AA_RUNNING",
        toState: "REAL_TEST_RUNNING",
        actorType: "SYSTEM",
        actorId: "system:autopilot",
        reasonCode: "AA_VALIDATED",
        gateSnapshot: { snapshotId: snapshot.id, dataHash: snapshot.dataHash },
        update: { realExperimentId: experiment.id },
      });
      return {
        outcome: "REAL_TEST_STARTED" as const,
        plan: advanced,
        experiment,
      };
    }

    if (state === "REAL_TEST_RUNNING") {
      const snapshot = plan.realExperimentId
        ? await args.db.experimentResultSnapshot.findFirst({
            where: {
              experimentId: plan.realExperimentId,
              resultState: {
                in: ["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "INVALID"],
              },
            },
            orderBy: { createdAt: "desc" },
          })
        : null;
      if (!snapshot) return { outcome: "REAL_TEST_COLLECTING" as const };
      await args.db.experiment.updateMany({
        where: {
          id: plan.realExperimentId ?? "",
          merchantId: args.merchantId,
          status: "ACTIVE",
        },
        data: { status: "COMPLETED", endedAt: snapshot.createdAt },
      });
      const completed = await transitionAutopilotPlan({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        fromState: "REAL_TEST_RUNNING",
        toState: "RESULT_READY",
        actorType: "SYSTEM",
        actorId: "system:autopilot",
        reasonCode: "MATURE_RESULT_SNAPSHOTTED",
        gateSnapshot: { snapshotId: snapshot.id, dataHash: snapshot.dataHash },
        update: { resultSnapshotId: snapshot.id },
      });
      await reconcileBetaEntitlement({
        db: args.db,
        merchantId: args.merchantId,
        snapshotId: snapshot.id,
        actor: "system:autopilot",
      });
      await setPlanNotice({
        db: args.db,
        merchantId: args.merchantId,
        planId: plan.id,
        dedupeKey: `result-ready:${plan.id}`,
        kind: "RESULT_READY",
        title: "Your measured result is ready",
        detail:
          "Review the verified in-test estimate and recommended next action.",
        actionLabel: "Review result",
      });
      return { outcome: "RESULT_READY" as const, plan: completed, snapshot };
    }
    return { outcome: "NO_ACTION" as const, state };
  } finally {
    await args.db.autopilotPlan.updateMany({
      where: { id: args.planId, lockToken },
      data: { lockToken: null, lockExpiresAt: null },
    });
  }
}

export async function advanceAutopilotPlan(
  args: Parameters<typeof advanceAutopilotPlanLegacy>[0],
) {
  const plan = await args.db.autopilotPlan.findFirst({
    where: { id: args.planId, merchantId: args.merchantId },
    select: {
      orchestrationProtocolVersion: true,
      aaProtocolJson: true,
      realExperimentProtocolJson: true,
      approvedAt: true,
      approvalRecordJson: true,
      cutoverReceiptId: true,
    },
  });
  if (!plan) return advanceAutopilotPlanLegacy(args);
  const protocol = classifyAutopilotPlanProtocol(plan);
  if (protocol === "INVALID")
    return { outcome: "PROTOCOL_MISMATCH" as const };
  if (protocol === "MVP_V2" && process.env.PAGNETIC_V2_ENABLED === "true") {
    const { advanceAutopilotPlanV2 } =
      await import("./autopilot-v2-orchestrator.server");
    return advanceAutopilotPlanV2(args);
  }
  if (protocol === "LEGACY_V1") return advanceAutopilotPlanLegacy(args);
  return { outcome: "V2_DISABLED" as const };
}

export async function pauseAutopilotPlan(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  actor: string;
  reason?: string;
}) {
  const plan = await args.db.autopilotPlan.findFirst({
    where: { id: args.planId, merchantId: args.merchantId },
  });
  if (!plan) throw new Error("Autopilot plan was not found for this store.");
  const state = plan.state as AutopilotPlanState;
  if (state === "PAUSED") return plan;
  if (!canTransitionAutopilot(state, "PAUSED"))
    throw new Error("This plan is not currently running and cannot be paused.");
  await args.db.$transaction([
    args.db.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: {
        merchantId: args.merchantId,
        killSwitch: true,
        reason: args.reason ?? "Merchant paused Autopilot",
        activatedBy: args.actor,
        activatedAt: new Date(),
      },
      update: {
        killSwitch: true,
        reason: args.reason ?? "Merchant paused Autopilot",
        activatedBy: args.actor,
        activatedAt: new Date(),
      },
    }),
    args.db.experiment.updateMany({
      where: {
        merchantId: args.merchantId,
        id: {
          in: [plan.aaExperimentId, plan.realExperimentId].filter(
            (id): id is string => Boolean(id),
          ),
        },
        status: "ACTIVE",
      },
      data: { status: "PAUSED", endedAt: new Date() },
    }),
  ]);
  return transitionAutopilotPlan({
    db: args.db,
    merchantId: args.merchantId,
    planId: plan.id,
    fromState: state,
    toState: "PAUSED",
    actorType: "MERCHANT",
    actorId: args.actor,
    reasonCode: "MERCHANT_PAUSE",
    gateSnapshot: { reason: args.reason ?? "Merchant paused Autopilot" },
  });
}

export async function resumeAutopilotPlan(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  actor: string;
}) {
  const plan = await args.db.autopilotPlan.findFirst({
    where: { id: args.planId, merchantId: args.merchantId, state: "PAUSED" },
  });
  if (!plan) throw new Error("Only a paused plan can be resumed.");
  const pauseTransition = await args.db.autopilotTransition.findFirst({
    where: { planId: plan.id, toState: "PAUSED" },
    orderBy: { occurredAt: "desc" },
  });
  const resumeState = ["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING"].includes(
    pauseTransition?.fromState ?? "",
  )
    ? (pauseTransition!.fromState as
        "VERIFYING" | "AA_RUNNING" | "REAL_TEST_RUNNING")
    : "VERIFYING";
  const experimentIds = [plan.aaExperimentId, plan.realExperimentId].filter(
    (id): id is string => Boolean(id),
  );
  const now = new Date();
  const gateSnapshot = {
    resumeState,
    experimentIds,
    pauseTransitionId: pauseTransition?.id ?? null,
  };
  const gateSnapshotHash = autopilotHash(gateSnapshot);
  const idempotencyKey = `${plan.id}:PAUSED:${resumeState}:MERCHANT_RESUME:${gateSnapshotHash}`;
  return args.db.$transaction(async (tx) => {
    await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const privacyRestricted = experimentIds.length
      ? await tx.experiment.count({
          where: {
            id: { in: experimentIds },
            merchantId: args.merchantId,
            privacyAffectedAt: { not: null },
          },
        })
      : 0;
    if (privacyRestricted) throw new Error("PRIVACY_ANALYSIS_REVIEW_REQUIRED");
    await tx.runtimeControl.update({
      where: { merchantId: args.merchantId },
      data: {
        killSwitch: false,
        reason: null,
        clearedBy: args.actor,
        clearedAt: now,
      },
    });
    await tx.experiment.updateMany({
      where: {
        merchantId: args.merchantId,
        id: { in: experimentIds },
        status: "PAUSED",
        privacyAffectedAt: null,
      },
      data: { status: "ACTIVE", endedAt: null },
    });
    for (const experimentId of experimentIds) {
      await tx.confounder.create({
        data: {
          merchantId: args.merchantId,
          experimentId,
          eventType: "AUTOPILOT_PAUSE_WINDOW",
          materiality: "MATERIAL",
          summary: "Merchant pause and resume window recorded for analysis.",
          occurredAt: now,
          recordedBy: args.actor,
        },
      });
    }
    const changed = await tx.autopilotPlan.updateMany({
      where: {
        id: plan.id,
        merchantId: args.merchantId,
        state: "PAUSED",
      },
      data: { state: resumeState },
    });
    if (changed.count !== 1)
      throw new Error("Autopilot state changed before this gate completed.");
    await tx.autopilotTransition.create({
      data: {
        merchantId: args.merchantId,
        planId: plan.id,
        fromState: "PAUSED",
        toState: resumeState,
        actorType: "MERCHANT",
        actorId: args.actor,
        reasonCode: "MERCHANT_RESUME",
        gateSnapshotHash,
        idempotencyKey,
        occurredAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: eventForTransition(resumeState, "MERCHANT"),
        resourceType: "AUTOPILOT_PLAN",
        resourceId: plan.id,
        detailsJson: JSON.stringify({
          fromState: "PAUSED",
          toState: resumeState,
          reasonCode: "MERCHANT_RESUME",
          gateSnapshotHash,
        }),
      },
    });
    return tx.autopilotPlan.findUniqueOrThrow({ where: { id: plan.id } });
  });
}

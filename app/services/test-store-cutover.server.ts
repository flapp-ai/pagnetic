import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  autopilotHash,
  canTransitionAutopilot,
  type AutopilotPlanState,
} from "./autopilot";
import {
  canonicalQueuePayload,
  QueueIdempotencyConflictError,
} from "./job-outbox.server";
import {
  LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
} from "./mvp-v2";
import { adaptivePanelActivation, PILOT_QA_KEYS } from "./pilot-setup";

export const V2_TEST_STORE_CUTOVER_ACTION = "SELECT_TEST_STORE_V2_CUTOVER";
export const V2_QA_EVIDENCE_ACTION = "RECORD_V2_QA_EVIDENCE";
const CUTOVER_HOLD_PREFIX = "V2_TEST_STORE_CUTOVER:";
const MAX_RUNTIME_EVIDENCE_AGE_MS = 15 * 60_000;
const MAX_CATALOG_EVIDENCE_AGE_MS = 15 * 60_000;
const QA_EVIDENCE_DAYS = 30;
const MAX_QA_ARTIFACT_BYTES = 5 * 1024 * 1024;
const QA_RECEIPT_PREFIX = "v2-qa-receipt:";

type QaCheckKey = (typeof PILOT_QA_KEYS)[number];
type QaApplicability = "APPLICABLE" | "NOT_APPLICABLE";

type V2QaEvidenceReceipt = {
  schemaVersion: 1;
  merchantId: string;
  productId: string;
  cutoverReceiptId: string;
  themeId: string;
  templateSuffix: string | null;
  deploymentVersionId: null;
  checkKey: QaCheckKey;
  status: "PASS" | "NOT_APPLICABLE";
  applicability: QaApplicability;
  capturedAt: string;
  verifiedBy: string;
  authority: "OPERATOR_ARTIFACT" | "STOREFRONT_RUNTIME";
  artifactRef: string;
  artifactSha256: string;
  appRelease: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

export type V2TestStoreCutoverReceipt = {
  schemaVersion: 1 | 2;
  merchantId: string;
  productId: string;
  legacyPlanId: string;
  legacyPlanHash: string;
  sourceVersion: string;
  sourceHash: string;
  targetOrchestrationProtocolVersion: string;
  holdReason: string;
  priorReceiptId?: string;
  sourceInvalidationTransitionId?: string;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function appRelease(environment: Record<string, string | undefined>) {
  const value = String(environment.APP_RELEASE ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(value))
    throw new Error("V2_QA_APP_RELEASE_REQUIRED");
  return value;
}

function evidenceReference(receiptId: string) {
  return `${QA_RECEIPT_PREFIX}${receiptId}`;
}

function privateArtifactReference(value: string) {
  const reference = value.trim();
  // The private object itself uses a non-semantic SHA-256 key. Persisting only
  // this opaque locator prevents URLs, credentials, filenames and shopper IDs
  // from leaking into receipts or audit rows.
  if (!/^qa-artifact:v1:[a-f0-9]{64}$/.test(reference))
    throw new Error("V2_QA_ARTIFACT_REFERENCE_INVALID");
  return reference;
}

function qaCheck(value: string): QaCheckKey {
  if (!(PILOT_QA_KEYS as readonly string[]).includes(value))
    throw new Error("V2_QA_CHECK_INVALID");
  return value as QaCheckKey;
}

function qaApplicability(checkKey: QaCheckKey, value: string) {
  if (value === "APPLICABLE") return value;
  if (
    value === "NOT_APPLICABLE" &&
    ["accelerated_checkout", "shop_pay"].includes(checkKey)
  )
    return value;
  throw new Error("V2_QA_APPLICABILITY_INVALID");
}

function parseQaReceipt(value: string): V2QaEvidenceReceipt {
  let parsed: Partial<V2QaEvidenceReceipt>;
  try {
    parsed = JSON.parse(value) as Partial<V2QaEvidenceReceipt>;
  } catch {
    throw new Error("V2_QA_RECEIPT_INVALID");
  }
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.merchantId !== "string" ||
    typeof parsed.productId !== "string" ||
    typeof parsed.cutoverReceiptId !== "string" ||
    typeof parsed.themeId !== "string" ||
    !Object.hasOwn(parsed, "templateSuffix") ||
    parsed.deploymentVersionId !== null ||
    typeof parsed.checkKey !== "string" ||
    !(PILOT_QA_KEYS as readonly string[]).includes(parsed.checkKey) ||
    !["PASS", "NOT_APPLICABLE"].includes(String(parsed.status)) ||
    !["APPLICABLE", "NOT_APPLICABLE"].includes(
      String(parsed.applicability),
    ) ||
    typeof parsed.capturedAt !== "string" ||
    typeof parsed.verifiedBy !== "string" ||
    !["OPERATOR_ARTIFACT", "STOREFRONT_RUNTIME"].includes(
      String(parsed.authority),
    ) ||
    typeof parsed.artifactRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(String(parsed.artifactSha256)) ||
    typeof parsed.appRelease !== "string"
  )
    throw new Error("V2_QA_RECEIPT_INVALID");
  return parsed as V2QaEvidenceReceipt;
}

async function createQaEvidenceReceipt(args: {
  tx: Prisma.TransactionClient;
  receipt: V2QaEvidenceReceipt;
  idempotencyKey: string;
}) {
  const inputHash = digest(canonicalQueuePayload(args.receipt));
  const prior = await args.tx.actionReceipt.findUnique({
    where: {
      merchantId_idempotencyKey: {
        merchantId: args.receipt.merchantId,
        idempotencyKey: args.idempotencyKey,
      },
    },
  });
  if (prior) {
    if (prior.action !== V2_QA_EVIDENCE_ACTION || prior.inputHash !== inputHash)
      throw new QueueIdempotencyConflictError();
    const evidence = await args.tx.qaEvidence.findFirst({
      where: {
        merchantId: args.receipt.merchantId,
        evidenceRef: evidenceReference(prior.id),
      },
    });
    if (!evidence) throw new Error("V2_QA_RECEIPT_EVIDENCE_MISSING");
    return { receipt: prior, evidence, replayed: true };
  }
  const receipt = await args.tx.actionReceipt.create({
    data: {
      merchantId: args.receipt.merchantId,
      actor: args.receipt.verifiedBy,
      action: V2_QA_EVIDENCE_ACTION,
      idempotencyKey: args.idempotencyKey,
      inputHash,
      responseRef: canonicalQueuePayload(args.receipt),
      createdAt: new Date(args.receipt.capturedAt),
    },
  });
  const evidence = await args.tx.qaEvidence.create({
    data: {
      merchantId: args.receipt.merchantId,
      productId: args.receipt.productId,
      themeId: args.receipt.themeId,
      templateSuffix: args.receipt.templateSuffix,
      deploymentVersionId: null,
      checkKey: args.receipt.checkKey,
      status: args.receipt.status,
      applicability: args.receipt.applicability,
      capturedAt: new Date(args.receipt.capturedAt),
      verifiedBy: args.receipt.verifiedBy,
      evidenceRef: evidenceReference(receipt.id),
      expiresAt: new Date(
        new Date(args.receipt.capturedAt).getTime() +
          QA_EVIDENCE_DAYS * 86_400_000,
      ),
    },
  });
  return { receipt, evidence, replayed: false };
}

function validKey(value: string) {
  const key = value.trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key))
    throw new Error("V2_CUTOVER_IDEMPOTENCY_KEY_INVALID");
  return key;
}

function allowedCutoverShops(environment: Record<string, string | undefined>) {
  return new Set(
    String(environment.PAGNETIC_V2_CUTOVER_SHOPS ?? "")
      .split(",")
      .map((shop) => shop.trim().toLowerCase())
      .filter((shop) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
      .slice(0, 20),
  );
}

export function assertSelectedV2CutoverShop(args: {
  shop: string;
  environment?: Record<string, string | undefined>;
}) {
  const shop = args.shop.trim().toLowerCase();
  if (!allowedCutoverShops(args.environment ?? process.env).has(shop))
    throw new Error("V2_CUTOVER_STORE_NOT_SELECTED");
  return shop;
}

function receiptMaterial(receipt: V2TestStoreCutoverReceipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    merchantId: receipt.merchantId,
    productId: receipt.productId,
    legacyPlanId: receipt.legacyPlanId,
    legacyPlanHash: receipt.legacyPlanHash,
    sourceVersion: receipt.sourceVersion,
    sourceHash: receipt.sourceHash,
    targetOrchestrationProtocolVersion:
      receipt.targetOrchestrationProtocolVersion,
    holdReason: receipt.holdReason,
    ...(receipt.priorReceiptId
      ? { priorReceiptId: receipt.priorReceiptId }
      : {}),
    ...(receipt.sourceInvalidationTransitionId
      ? {
          sourceInvalidationTransitionId:
            receipt.sourceInvalidationTransitionId,
        }
      : {}),
  };
}

function parseReceipt(value: string): V2TestStoreCutoverReceipt {
  let parsed: Partial<V2TestStoreCutoverReceipt>;
  try {
    parsed = JSON.parse(value) as Partial<V2TestStoreCutoverReceipt>;
  } catch {
    throw new Error("V2_CUTOVER_RECEIPT_INVALID");
  }
  if (
    ![1, 2].includes(Number(parsed.schemaVersion)) ||
    typeof parsed.merchantId !== "string" ||
    typeof parsed.productId !== "string" ||
    typeof parsed.legacyPlanId !== "string" ||
    typeof parsed.legacyPlanHash !== "string" ||
    typeof parsed.sourceVersion !== "string" ||
    typeof parsed.sourceHash !== "string" ||
    parsed.targetOrchestrationProtocolVersion !==
      MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION ||
    typeof parsed.holdReason !== "string" ||
    (parsed.schemaVersion === 2 && typeof parsed.priorReceiptId !== "string") ||
    (parsed.schemaVersion === 1 && parsed.priorReceiptId != null) ||
    (parsed.sourceInvalidationTransitionId != null &&
      typeof parsed.sourceInvalidationTransitionId !== "string")
  )
    throw new Error("V2_CUTOVER_RECEIPT_INVALID");
  return parsed as V2TestStoreCutoverReceipt;
}

export async function loadV2TestStoreCutoverReceipt(args: {
  db: Db;
  merchantId: string;
  receiptId: string;
  productId?: string;
  requireCurrentSource?: boolean;
}) {
  const receipt = await args.db.actionReceipt.findFirst({
    where: {
      id: args.receiptId,
      merchantId: args.merchantId,
      action: V2_TEST_STORE_CUTOVER_ACTION,
    },
  });
  if (!receipt) throw new Error("V2_CUTOVER_RECEIPT_REQUIRED");
  const scope = parseReceipt(receipt.responseRef);
  if (
    receipt.inputHash !==
      digest(canonicalQueuePayload(receiptMaterial(scope))) ||
    scope.merchantId !== args.merchantId ||
    (args.productId && scope.productId !== args.productId)
  )
    throw new Error("V2_CUTOVER_RECEIPT_SCOPE_MISMATCH");
  let root = scope;
  const visited = new Set([receipt.id]);
  for (let depth = 0; root.schemaVersion === 2 && depth < 10; depth += 1) {
    if (!root.priorReceiptId || visited.has(root.priorReceiptId))
      throw new Error("V2_CUTOVER_RECEIPT_LINEAGE_INVALID");
    visited.add(root.priorReceiptId);
    const prior = await args.db.actionReceipt.findFirst({
      where: {
        id: root.priorReceiptId,
        merchantId: args.merchantId,
        action: V2_TEST_STORE_CUTOVER_ACTION,
      },
    });
    if (!prior) throw new Error("V2_CUTOVER_RECEIPT_LINEAGE_INVALID");
    const priorScope = parseReceipt(prior.responseRef);
    if (
      prior.inputHash !==
        digest(canonicalQueuePayload(receiptMaterial(priorScope))) ||
      priorScope.merchantId !== scope.merchantId ||
      priorScope.legacyPlanId !== scope.legacyPlanId ||
      priorScope.legacyPlanHash !== scope.legacyPlanHash
    )
      throw new Error("V2_CUTOVER_RECEIPT_LINEAGE_INVALID");
    root = priorScope;
  }
  if (root.schemaVersion !== 1)
    throw new Error("V2_CUTOVER_RECEIPT_LINEAGE_INVALID");
  const legacy = await args.db.autopilotPlan.findFirst({
    where: {
      id: scope.legacyPlanId,
      merchantId: args.merchantId,
      productId: root.productId,
      planHash: scope.legacyPlanHash,
      orchestrationProtocolVersion: LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      state: "INVALIDATED",
    },
    select: { id: true },
  });
  if (!legacy) throw new Error("V2_CUTOVER_LEGACY_HISTORY_MISMATCH");
  if (scope.sourceInvalidationTransitionId) {
    const invalidation = await args.db.autopilotTransition.findFirst({
      where: {
        id: scope.sourceInvalidationTransitionId,
        merchantId: args.merchantId,
        planId: scope.legacyPlanId,
        toState: "INVALIDATED",
        actorType: "SYSTEM",
        actorId: "system:autopilot",
        reasonCode: "FROZEN_INPUT_DRIFT",
      },
      select: { id: true },
    });
    if (!invalidation)
      throw new Error("V2_CUTOVER_SOURCE_INVALIDATION_HISTORY_MISMATCH");
  }
  if (args.requireCurrentSource) {
    const product = await args.db.product.findFirst({
      where: { id: scope.productId, merchantId: args.merchantId },
      select: { sourceVersion: true, sourceHash: true },
    });
    if (
      !product ||
      product.sourceVersion !== scope.sourceVersion ||
      product.sourceHash !== scope.sourceHash
    )
      throw new Error("V2_CUTOVER_SOURCE_CHANGED");
  }
  return { receipt, scope };
}

async function sourceInvalidationAuthority(args: {
  db: Db;
  merchantId: string;
  plan: {
    id: string;
    state: string;
    approvedAt: Date | null;
    approvalRecordJson: string | null;
  };
}) {
  if (
    args.plan.state !== "INVALIDATED" ||
    !args.plan.approvedAt ||
    !args.plan.approvalRecordJson
  )
    return null;
  const [transition, notice] = await Promise.all([
    args.db.autopilotTransition.findFirst({
      where: { merchantId: args.merchantId, planId: args.plan.id },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    }),
    args.db.merchantNotice.findUnique({
      where: {
        merchantId_dedupeKey: {
          merchantId: args.merchantId,
          dedupeKey: `source-changed:${args.plan.id}`,
        },
      },
    }),
  ]);
  if (
    !transition ||
    transition.toState !== "INVALIDATED" ||
    transition.actorType !== "SYSTEM" ||
    transition.actorId !== "system:autopilot" ||
    transition.reasonCode !== "FROZEN_INPUT_DRIFT" ||
    ![
      "APPROVED",
      "WAITING_FOR_THEME",
      "VERIFYING",
      "AA_RUNNING",
      "REAL_TEST_RUNNING",
    ].includes(transition.fromState) ||
    !notice ||
    notice.planId !== args.plan.id ||
    notice.kind !== "SOURCE_CHANGED" ||
    notice.status !== "OPEN"
  )
    return null;
  return transition;
}

export async function loadSourceInvalidatedLegacyCutoverCandidate(args: {
  db: Db;
  merchantId: string;
  planId: string;
}) {
  const plan = await args.db.autopilotPlan.findFirst({
    where: {
      id: args.planId,
      merchantId: args.merchantId,
      orchestrationProtocolVersion: LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      state: "INVALIDATED",
    },
    select: {
      id: true,
      state: true,
      approvedAt: true,
      approvalRecordJson: true,
    },
  });
  if (!plan) return null;
  const [invalidation, existingCutover] = await Promise.all([
    sourceInvalidationAuthority({
      db: args.db,
      merchantId: args.merchantId,
      plan,
    }),
    args.db.actionReceipt.findFirst({
      where: {
        merchantId: args.merchantId,
        action: V2_TEST_STORE_CUTOVER_ACTION,
      },
      select: { id: true },
    }),
  ]);
  return invalidation && !existingCutover
    ? { transitionId: invalidation.id }
    : null;
}

export async function assertCurrentV2TestStoreCutoverReceipt(args: {
  db: Db;
  merchantId: string;
  receiptId: string;
  productId?: string;
  requireCurrentSource?: boolean;
}) {
  const runtime = await args.db.runtimeControl.upsert({
    where: { merchantId: args.merchantId },
    create: { merchantId: args.merchantId },
    update: { merchantId: args.merchantId },
  });
  const cutover = await loadV2TestStoreCutoverReceipt(args);
  const latest = await args.db.actionReceipt.findFirst({
    where: {
      merchantId: args.merchantId,
      action: V2_TEST_STORE_CUTOVER_ACTION,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (latest?.id !== cutover.receipt.id)
    throw new Error("V2_CUTOVER_RECEIPT_SUPERSEDED");
  if (
    !runtime.killSwitch ||
    runtime.reason !== cutover.scope.holdReason
  )
    throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
  return cutover;
}

export async function beginSelectedTestStoreV2Cutover(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  legacyPlanId: string;
  expectedSourceVersion: string;
  expectedSourceHash: string;
  actor: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const key = validKey(args.idempotencyKey);
  const now = args.now ?? new Date();
  return args.db.$transaction(async (tx) => {
    const runtime = await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const product = await tx.product.findFirst({
      where: { id: args.productId, merchantId: args.merchantId },
      select: {
        id: true,
        sourceVersion: true,
        sourceHash: true,
        syncedAt: true,
      },
    });
    const plan = await tx.autopilotPlan.findFirst({
      where: {
        id: args.legacyPlanId,
        merchantId: args.merchantId,
        productId: args.productId,
      },
    });
    if (!product || !plan) throw new Error("V2_CUTOVER_SCOPE_MISMATCH");
    if (
      product.sourceVersion !== args.expectedSourceVersion ||
      product.sourceHash !== args.expectedSourceHash
    )
      throw new Error("V2_CUTOVER_SOURCE_CHANGED");
    if (
      product.syncedAt > now ||
      now.getTime() - product.syncedAt.getTime() > MAX_CATALOG_EVIDENCE_AGE_MS
    )
      throw new Error("V2_CUTOVER_CATALOG_SYNC_STALE");
    const keyReceipt = await tx.actionReceipt.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId: args.merchantId,
          idempotencyKey: key,
        },
      },
    });
    if (keyReceipt) {
      if (keyReceipt.action !== V2_TEST_STORE_CUTOVER_ACTION)
        throw new QueueIdempotencyConflictError();
      const replay = await loadV2TestStoreCutoverReceipt({
        db: tx,
        merchantId: args.merchantId,
        receiptId: keyReceipt.id,
        productId: args.productId,
        requireCurrentSource: true,
      });
      if (
        replay.scope.legacyPlanId !== plan.id ||
        replay.scope.legacyPlanHash !== plan.planHash ||
        replay.scope.sourceVersion !== args.expectedSourceVersion ||
        replay.scope.sourceHash !== args.expectedSourceHash ||
        replay.scope.holdReason !== `${CUTOVER_HOLD_PREFIX}${key}`
      )
        throw new QueueIdempotencyConflictError();
      return { ...replay, replayed: true };
    }
    const existingCutover = await tx.actionReceipt.findFirst({
      where: {
        merchantId: args.merchantId,
        action: V2_TEST_STORE_CUTOVER_ACTION,
      },
      select: { id: true },
    });
    if (existingCutover) throw new Error("V2_CUTOVER_ALREADY_RECORDED");
    const sourceInvalidation =
      plan.state === "INVALIDATED"
        ? await sourceInvalidationAuthority({
            db: tx,
            merchantId: args.merchantId,
            plan,
          })
        : null;
    if (plan.state === "INVALIDATED" && !sourceInvalidation)
      throw new Error("V2_CUTOVER_LEGACY_PLAN_ALREADY_RETIRED");
    const holdReason = `${CUTOVER_HOLD_PREFIX}${key}`;
    const scope: V2TestStoreCutoverReceipt = {
      schemaVersion: 1,
      merchantId: args.merchantId,
      productId: args.productId,
      legacyPlanId: plan.id,
      legacyPlanHash: plan.planHash,
      sourceVersion: product.sourceVersion,
      sourceHash: product.sourceHash,
      targetOrchestrationProtocolVersion:
        MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      holdReason,
      ...(sourceInvalidation
        ? { sourceInvalidationTransitionId: sourceInvalidation.id }
        : {}),
    };
    const inputHash = digest(canonicalQueuePayload(receiptMaterial(scope)));
    if (
      plan.orchestrationProtocolVersion !==
      LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION
    )
      throw new Error("V2_CUTOVER_LEGACY_PLAN_REQUIRED");
    if (runtime.killSwitch)
      throw new Error("V2_CUTOVER_SAFETY_HOLD_ACTIVE");

    const linkedIds = [plan.aaExperimentId, plan.realExperimentId].filter(
      (id): id is string => Boolean(id),
    );
    const linked = linkedIds.length
      ? await tx.experiment.findMany({
          where: { id: { in: linkedIds }, merchantId: args.merchantId },
          include: { registration: true },
        })
      : [];
    if (new Set(linkedIds).size !== linked.length)
      throw new Error("V2_CUTOVER_EXPERIMENT_HISTORY_MISMATCH");
    if (
      linked.some(
        (experiment) =>
          experiment.id === plan.realExperimentId &&
          experiment.status === "ACTIVE",
      )
    )
      throw new Error("V2_CUTOVER_ACTIVE_REAL_EXPERIMENT");
    const openQa = linked.find(
      (experiment) =>
        experiment.id === plan.aaExperimentId &&
        ["DRAFT", "ACTIVE", "PAUSED"].includes(experiment.status),
    );
    if (
      openQa &&
      (openQa.controlPolicy !== "ORIGINAL" ||
        openQa.treatmentPolicy !== "ORIGINAL")
    )
      throw new Error("V2_CUTOVER_QA_EXPERIMENT_INVALID");
    if (openQa && openQa.status !== "PAUSED") {
      await tx.experiment.update({
        where: { id: openQa.id },
        data: {
          status: "PAUSED",
          endedAt: now,
          stopReason: "V2_TEST_STORE_CUTOVER",
        },
      });
    }
    const gateHash = autopilotHash(receiptMaterial(scope));
    if (!sourceInvalidation) {
      const state = plan.state as AutopilotPlanState;
      if (!canTransitionAutopilot(state, "INVALIDATED"))
        throw new Error("V2_CUTOVER_PLAN_STATE_UNSUPPORTED");
      const changed = await tx.autopilotPlan.updateMany({
        where: {
          id: plan.id,
          merchantId: args.merchantId,
          state: plan.state,
          planHash: plan.planHash,
          orchestrationProtocolVersion: LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        },
        data: { state: "INVALIDATED" },
      });
      if (changed.count !== 1) throw new Error("V2_CUTOVER_AUTHORITY_CHANGED");
      await tx.autopilotTransition.create({
        data: {
          merchantId: args.merchantId,
          planId: plan.id,
          fromState: plan.state,
          toState: "INVALIDATED",
          actorType: "OPERATOR",
          actorId: args.actor,
          reasonCode: "V2_TEST_STORE_CUTOVER",
          gateSnapshotHash: gateHash,
          idempotencyKey: `${plan.id}:${plan.state}:INVALIDATED:V2_TEST_STORE_CUTOVER:${gateHash}`,
          occurredAt: now,
        },
      });
    } else {
      const resolvedNotice = await tx.merchantNotice.updateMany({
        where: {
          merchantId: args.merchantId,
          planId: plan.id,
          dedupeKey: `source-changed:${plan.id}`,
          kind: "SOURCE_CHANGED",
          status: "OPEN",
        },
        data: { status: "RESOLVED", resolvedAt: now },
      });
      if (resolvedNotice.count !== 1)
        throw new Error("V2_CUTOVER_SOURCE_INVALIDATION_AUTHORITY_CHANGED");
    }
    await tx.runtimeControl.update({
      where: { merchantId: args.merchantId },
      data: {
        killSwitch: true,
        reason: holdReason,
        activatedBy: args.actor,
        activatedAt: now,
        clearedBy: null,
        clearedAt: null,
      },
    });
    const receipt = await tx.actionReceipt.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: V2_TEST_STORE_CUTOVER_ACTION,
        idempotencyKey: key,
        inputHash,
        responseRef: canonicalQueuePayload(scope),
        createdAt: now,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "V2_TEST_STORE_CUTOVER_RECORDED",
        resourceType: "ACTION_RECEIPT",
        resourceId: receipt.id,
        detailsJson: canonicalQueuePayload({
          productId: args.productId,
          legacyPlanId: plan.id,
          legacyPlanHash: plan.planHash,
          sourceVersion: product.sourceVersion,
          sourceHash: product.sourceHash,
          sourceInvalidationTransitionId: sourceInvalidation?.id ?? null,
          qaExperimentIds: linked
            .filter((experiment) => experiment.id === plan.aaExperimentId)
            .map((experiment) => experiment.id),
        }),
        createdAt: now,
      },
    });
    return { receipt, scope, replayed: false };
  });
}

export async function reviseSelectedTestStoreV2CutoverProduct(args: {
  db: PrismaClient;
  merchantId: string;
  priorReceiptId: string;
  productId: string;
  expectedSourceVersion: string;
  expectedSourceHash: string;
  actor: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const key = validKey(args.idempotencyKey);
  const now = args.now ?? new Date();
  return args.db.$transaction(async (tx) => {
    const runtime = await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const prior = await loadV2TestStoreCutoverReceipt({
      db: tx,
      merchantId: args.merchantId,
      receiptId: args.priorReceiptId,
    });
    if (prior.scope.productId === args.productId)
      throw new Error("V2_CUTOVER_NEW_PRODUCT_REQUIRED");
    const product = await tx.product.findFirst({
      where: { id: args.productId, merchantId: args.merchantId },
      select: {
        id: true,
        sourceVersion: true,
        sourceHash: true,
        syncedAt: true,
      },
    });
    if (!product) throw new Error("V2_CUTOVER_SCOPE_MISMATCH");
    if (
      product.sourceVersion !== args.expectedSourceVersion ||
      product.sourceHash !== args.expectedSourceHash
    )
      throw new Error("V2_CUTOVER_SOURCE_CHANGED");
    if (
      product.syncedAt > now ||
      now.getTime() - product.syncedAt.getTime() > MAX_CATALOG_EVIDENCE_AGE_MS
    )
      throw new Error("V2_CUTOVER_CATALOG_SYNC_STALE");
    const holdReason = `${CUTOVER_HOLD_PREFIX}${key}`;
    const scope: V2TestStoreCutoverReceipt = {
      schemaVersion: 2,
      merchantId: args.merchantId,
      productId: product.id,
      legacyPlanId: prior.scope.legacyPlanId,
      legacyPlanHash: prior.scope.legacyPlanHash,
      sourceVersion: product.sourceVersion,
      sourceHash: product.sourceHash,
      targetOrchestrationProtocolVersion:
        MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      holdReason,
      priorReceiptId: prior.receipt.id,
    };
    const inputHash = digest(canonicalQueuePayload(receiptMaterial(scope)));
    const replay = await tx.actionReceipt.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId: args.merchantId,
          idempotencyKey: key,
        },
      },
    });
    if (replay) {
      if (
        replay.action !== V2_TEST_STORE_CUTOVER_ACTION ||
        replay.inputHash !== inputHash
      )
        throw new QueueIdempotencyConflictError();
      return {
        receipt: replay,
        scope: parseReceipt(replay.responseRef),
        replayed: true,
      };
    }
    const latest = await tx.actionReceipt.findFirst({
      where: {
        merchantId: args.merchantId,
        action: V2_TEST_STORE_CUTOVER_ACTION,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latest?.id !== prior.receipt.id)
      throw new Error("V2_CUTOVER_RECEIPT_SUPERSEDED");
    if (
      !runtime.killSwitch ||
      runtime.reason !== prior.scope.holdReason
    )
      throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
    const [plans, deployments, experiments] = await Promise.all([
      tx.autopilotPlan.count({
        where: {
          merchantId: args.merchantId,
          orchestrationProtocolVersion:
            MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        },
      }),
      tx.deploymentVersion.count({ where: { merchantId: args.merchantId } }),
      tx.experiment.count({
        where: { merchantId: args.merchantId, lifecycleVersion: 2 },
      }),
    ]);
    if (plans || deployments || experiments)
      throw new Error("V2_CUTOVER_PRODUCT_RESELECTION_UNSAFE");
    const receipt = await tx.actionReceipt.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: V2_TEST_STORE_CUTOVER_ACTION,
        idempotencyKey: key,
        inputHash,
        responseRef: canonicalQueuePayload(scope),
        createdAt: now,
      },
    });
    const changed = await tx.runtimeControl.updateMany({
      where: {
        merchantId: args.merchantId,
        killSwitch: true,
        reason: prior.scope.holdReason,
      },
      data: {
        reason: holdReason,
        activatedBy: args.actor,
        activatedAt: now,
        clearedBy: null,
        clearedAt: null,
      },
    });
    if (changed.count !== 1)
      throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "V2_TEST_STORE_CUTOVER_PRODUCT_RESELECTED",
        resourceType: "ACTION_RECEIPT",
        resourceId: receipt.id,
        detailsJson: canonicalQueuePayload({
          priorReceiptId: prior.receipt.id,
          previousProductId: prior.scope.productId,
          productId: product.id,
          sourceVersion: product.sourceVersion,
          sourceHash: product.sourceHash,
        }),
        createdAt: now,
      },
    });
    return { receipt, scope, replayed: false };
  });
}

export async function recoverSelectedTestStoreV2AfterReinstall(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  planId: string;
  priorReceiptId: string;
  actor: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const key = validKey(args.idempotencyKey);
  const now = args.now ?? new Date();
  return args.db.$transaction(async (tx) => {
    const merchant = await tx.merchant.findFirst({
      where: { id: args.merchantId, shop: args.shop },
      select: { id: true },
    });
    if (!merchant) throw new Error("V2_REINSTALL_TENANT_MISMATCH");
    const session = await tx.session.findFirst({ where: { shop: args.shop } });
    const pixel = await tx.pixelCredential.findUnique({
      where: { merchantId: args.merchantId },
    });
    if (!session || pixel?.status !== "ACTIVE")
      throw new Error("V2_REINSTALL_NOT_VERIFIED");
    const plan = await tx.autopilotPlan.findFirst({
      where: {
        id: args.planId,
        merchantId: args.merchantId,
        state: "INVALIDATED",
        orchestrationProtocolVersion: MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        cutoverReceiptId: args.priorReceiptId,
      },
      include: { product: true },
    });
    if (!plan) throw new Error("V2_REINSTALL_INVALIDATED_PLAN_REQUIRED");
    const prior = await loadV2TestStoreCutoverReceipt({
      db: tx,
      merchantId: args.merchantId,
      receiptId: args.priorReceiptId,
      productId: plan.productId,
      requireCurrentSource: true,
    });
    const holdReason = `${CUTOVER_HOLD_PREFIX}${key}`;
    const scope: V2TestStoreCutoverReceipt = {
      schemaVersion: 2,
      merchantId: args.merchantId,
      productId: plan.productId,
      legacyPlanId: prior.scope.legacyPlanId,
      legacyPlanHash: prior.scope.legacyPlanHash,
      sourceVersion: plan.product.sourceVersion,
      sourceHash: plan.product.sourceHash,
      targetOrchestrationProtocolVersion: MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      holdReason,
      priorReceiptId: prior.receipt.id,
    };
    const inputHash = digest(canonicalQueuePayload(receiptMaterial(scope)));
    const replay = await tx.actionReceipt.findUnique({
      where: { merchantId_idempotencyKey: { merchantId: args.merchantId, idempotencyKey: key } },
    });
    if (replay) {
      if (replay.action !== V2_TEST_STORE_CUTOVER_ACTION || replay.inputHash !== inputHash)
        throw new QueueIdempotencyConflictError();
      return { receipt: replay, scope: parseReceipt(replay.responseRef), replayed: true };
    }
    const latest = await tx.actionReceipt.findFirst({
      where: { merchantId: args.merchantId, action: V2_TEST_STORE_CUTOVER_ACTION },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latest?.id !== prior.receipt.id)
      throw new Error("V2_CUTOVER_RECEIPT_SUPERSEDED");
    const runtime = await tx.runtimeControl.findUnique({
      where: { merchantId: args.merchantId },
    });
    if (!runtime || runtime.killSwitch || runtime.reason !== null)
      throw new Error("V2_REINSTALL_OTHER_HOLD_ACTIVE");
    const [activeExperiments, activeDeployments] = await Promise.all([
      tx.experiment.count({ where: { merchantId: args.merchantId, status: "ACTIVE" } }),
      tx.activeDeployment.count({ where: { merchantId: args.merchantId } }),
    ]);
    if (activeExperiments || activeDeployments)
      throw new Error("V2_REINSTALL_ACTIVE_AUTHORITY_PRESENT");
    const receipt = await tx.actionReceipt.create({ data: {
      merchantId: args.merchantId, actor: args.actor,
      action: V2_TEST_STORE_CUTOVER_ACTION, idempotencyKey: key,
      inputHash, responseRef: canonicalQueuePayload(scope), createdAt: now,
    } });
    await tx.runtimeControl.update({
      where: { merchantId: args.merchantId },
      data: { killSwitch: true, reason: holdReason, activatedBy: args.actor, activatedAt: now, clearedBy: null, clearedAt: null },
    });
    await tx.auditLog.create({ data: {
      merchantId: args.merchantId, actor: args.actor,
      action: "V2_POST_UNINSTALL_RECOVERY_RECORDED", resourceType: "ACTION_RECEIPT",
      resourceId: receipt.id,
      detailsJson: canonicalQueuePayload({ priorReceiptId: prior.receipt.id, invalidatedPlanId: plan.id, productId: plan.productId }),
      createdAt: now,
    } });
    return { receipt, scope, replayed: false };
  });
}

function templateSuffix(sourceSnapshot: string) {
  try {
    const source = JSON.parse(sourceSnapshot) as { templateSuffix?: unknown };
    return typeof source.templateSuffix === "string" &&
      source.templateSuffix.trim()
      ? source.templateSuffix.trim()
      : null;
  } catch {
    return null;
  }
}

export async function recordOperatorV2QaEvidence(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  checkKey: string;
  applicability: string;
  artifactRef: string;
  artifactBytes: Uint8Array;
  actor: string;
  idempotencyKey: string;
  capturedAt: Date;
  now?: Date;
  environment?: Record<string, string | undefined>;
}) {
  const now = args.now ?? new Date();
  const checkKey = qaCheck(args.checkKey);
  const applicability = qaApplicability(checkKey, args.applicability);
  const artifactRef = privateArtifactReference(args.artifactRef);
  if (
    args.artifactBytes.byteLength === 0 ||
    args.artifactBytes.byteLength > MAX_QA_ARTIFACT_BYTES
  )
    throw new Error("V2_QA_ARTIFACT_SIZE_INVALID");
  if (
    !Number.isFinite(args.capturedAt.getTime()) ||
    args.capturedAt > now ||
    now.getTime() - args.capturedAt.getTime() > 14 * 86_400_000
  )
    throw new Error("V2_QA_CAPTURE_TIME_INVALID");
  const release = appRelease(args.environment ?? process.env);
  const artifactSha256 = createHash("sha256")
    .update(args.artifactBytes)
    .digest("hex");
  const idempotencyKey = validKey(args.idempotencyKey);
  return args.db.$transaction(async (tx) => {
    const runtime = await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const role = await tx.pilotRole.findFirst({
      where: {
        merchantId: args.merchantId,
        actorKey: args.actor,
        role: { in: ["OWNER", "OPERATOR"] },
        active: true,
      },
      select: { id: true },
    });
    if (!role) throw new Error("V2_QA_OWNER_OR_OPERATOR_ROLE_REQUIRED");
    const plan = await tx.autopilotPlan.findFirst({
      where: {
        merchantId: args.merchantId,
        productId: args.productId,
        orchestrationProtocolVersion:
          MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        cutoverReceiptId: { not: null },
        approvedAt: { not: null },
        state: { in: ["WAITING_FOR_THEME", "VERIFYING"] },
      },
      include: { product: { include: { themeActivation: true } } },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });
    if (!plan?.cutoverReceiptId)
      throw new Error("V2_CUTOVER_FRESH_APPROVAL_REQUIRED");
    const cutover = await loadV2TestStoreCutoverReceipt({
      db: tx,
      merchantId: args.merchantId,
      receiptId: plan.cutoverReceiptId,
      productId: args.productId,
      requireCurrentSource: true,
    });
    if (
      !runtime.killSwitch ||
      runtime.reason !== cutover.scope.holdReason
    )
      throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
    const theme = plan.product.themeActivation;
    if (
      !theme?.activeOnPublishedTheme ||
      theme.extensionStatus !== "ACTIVE" ||
      theme.blockHandle !== "adaptive-panel" ||
      !theme.themeId ||
      !theme.verifiedAt ||
      !theme.verifiedBy ||
      theme.verifiedAt > now ||
      now.getTime() - theme.verifiedAt.getTime() > 14 * 86_400_000
    )
      throw new Error("V2_CUTOVER_THEME_EVIDENCE_REQUIRED");
    const receipt: V2QaEvidenceReceipt = {
      schemaVersion: 1,
      merchantId: args.merchantId,
      productId: args.productId,
      cutoverReceiptId: plan.cutoverReceiptId,
      themeId: theme.themeId,
      templateSuffix: templateSuffix(plan.product.sourceSnapshot),
      deploymentVersionId: null,
      checkKey,
      status: applicability === "APPLICABLE" ? "PASS" : "NOT_APPLICABLE",
      applicability,
      capturedAt: args.capturedAt.toISOString(),
      verifiedBy: args.actor,
      authority: "OPERATOR_ARTIFACT",
      artifactRef,
      artifactSha256,
      appRelease: release,
    };
    const saved = await createQaEvidenceReceipt({
      tx,
      receipt,
      idempotencyKey,
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "V2_QA_EVIDENCE_RECORDED",
        resourceType: "ACTION_RECEIPT",
        resourceId: saved.receipt.id,
        detailsJson: canonicalQueuePayload({
          productId: args.productId,
          checkKey,
          applicability,
          artifactRef,
          artifactSha256,
          appRelease: release,
          replayed: saved.replayed,
        }),
        createdAt: now,
      },
    });
    return saved;
  });
}

export async function recordAuthenticatedV2ThemeEvidence(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  actor: string;
  extensions: unknown;
  now?: Date;
  environment?: Record<string, string | undefined>;
}) {
  const now = args.now ?? new Date();
  const release = appRelease(args.environment ?? process.env);
  const activation = adaptivePanelActivation(args.extensions);
  if (!activation.active || !activation.themeId || !activation.target)
    throw new Error("V2_THEME_ACTIVATION_NOT_VERIFIED");
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
    select: { id: true, shopifyProductId: true, sourceSnapshot: true },
  });
  if (!product) throw new Error("V2_THEME_PRODUCT_SCOPE_MISMATCH");
  const plan = await args.db.autopilotPlan.findFirst({
    where: {
      merchantId: args.merchantId,
      productId: args.productId,
      orchestrationProtocolVersion: MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      cutoverReceiptId: { not: null },
      state: { in: ["WAITING_FOR_THEME", "VERIFYING"] },
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: { cutoverReceiptId: true, approvedAt: true },
  });
  if (!plan?.cutoverReceiptId || !plan.approvedAt)
    throw new Error("V2_CUTOVER_FRESH_APPROVAL_REQUIRED");
  const cutover = await loadV2TestStoreCutoverReceipt({
    db: args.db,
    merchantId: args.merchantId,
    receiptId: plan.cutoverReceiptId,
    productId: args.productId,
    requireCurrentSource: true,
  });
  const observedAfter = new Date(
    Math.max(
      now.getTime() - MAX_RUNTIME_EVIDENCE_AGE_MS,
      cutover.receipt.createdAt.getTime(),
      plan.approvedAt.getTime(),
    ),
  );
  const event = await args.db.commerceEvent.findFirst({
    where: {
      merchantId: args.merchantId,
      productId: product.shopifyProductId,
      source: "STOREFRONT_BRIDGE",
      eventType: {
        in: ["adaptive_storefront_decision", "adaptive_storefront:decision"],
      },
      consentState: "analytics_and_preferences_allowed",
      receivedAt: { gte: observedAfter, lte: now },
      occurredAt: { lte: now },
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
  });
  if (!event) throw new Error("V2_PRODUCT_RUNTIME_ACK_REQUIRED");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(event.payloadJson) as Record<string, unknown>;
  } catch {
    throw new Error("V2_PRODUCT_RUNTIME_ACK_INVALID");
  }
  if (data.arm !== "ORIGINAL" || data.reason !== "KILL_SWITCH_ACTIVE")
    throw new Error("V2_ORIGINAL_FALLBACK_NOT_OBSERVED");
  const suffix = templateSuffix(product.sourceSnapshot);
  return args.db.$transaction(async (tx) => {
    const theme = await tx.themeActivation.upsert({
      where: { productId: product.id },
      create: {
        merchantId: args.merchantId,
        productId: product.id,
        themeId: activation.themeId,
        extensionStatus: activation.status,
        activationTarget: activation.target,
        activeOnPublishedTheme: true,
        detectedAt: now,
        verifiedAt: now,
        verifiedBy: args.actor,
      },
      update: {
        themeId: activation.themeId,
        extensionStatus: activation.status,
        activationTarget: activation.target,
        activeOnPublishedTheme: true,
        detectedAt: now,
        verifiedAt: now,
        verifiedBy: args.actor,
      },
    });
    const artifactRef = `commerce-event:${event.id}`;
    const artifactSha256 = digest(
      canonicalQueuePayload({
        id: event.id,
        eventId: event.eventId,
        eventType: event.eventType,
        productId: event.productId,
        occurredAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
        payloadJson: event.payloadJson,
      }),
    );
    const evidenceResults = await Promise.all(
      (["placement", "original_fallback"] as const).map((checkKey) =>
        createQaEvidenceReceipt({
          tx,
          idempotencyKey: `v2-qa-runtime:${cutover.receipt.id}:${event.id}:${checkKey}`,
          receipt: {
            schemaVersion: 1,
            merchantId: args.merchantId,
            productId: product.id,
            cutoverReceiptId: cutover.receipt.id,
            themeId: activation.themeId!,
            templateSuffix: suffix,
            deploymentVersionId: null,
            checkKey,
            status: "PASS",
            applicability: "APPLICABLE",
            capturedAt: now.toISOString(),
            verifiedBy: args.actor,
            authority: "STOREFRONT_RUNTIME",
            artifactRef,
            artifactSha256,
            appRelease: release,
          },
        }),
      ),
    );
    const evidence = evidenceResults.map((result) => result.evidence);
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "V2_THEME_RUNTIME_EVIDENCE_VERIFIED",
        resourceType: "THEME_ACTIVATION",
        resourceId: theme.id,
        detailsJson: canonicalQueuePayload({
          productId: product.id,
          themeId: activation.themeId,
          templateSuffix: suffix,
          runtimeEventId: event.id,
          verifiedChecks: evidence.map((item) => item.checkKey),
          pendingChecks: PILOT_QA_KEYS.filter(
            (key) => !evidence.some((item) => item.checkKey === key),
          ),
        }),
        createdAt: now,
      },
    });
    return { theme, evidence, runtimeEventId: event.id };
  });
}

export function isCutoverHold(reason: string | null | undefined) {
  return Boolean(reason?.startsWith(CUTOVER_HOLD_PREFIX));
}

function acceptedQaEvidence(
  evidence: {
    status: string;
    applicability: string;
    capturedAt: Date;
    expiresAt: Date | null;
    evidenceRef: string;
    themeId: string | null;
    templateSuffix: string | null;
    deploymentVersionId: string | null;
  } | undefined,
  expected: {
    now: Date;
    themeId: string;
    templateSuffix: string | null;
  },
) {
  if (!evidence || !evidence.evidenceRef.trim()) return false;
  const statusAccepted =
    ["PASS", "PASSED"].includes(evidence.status) ||
    (evidence.status === "NOT_APPLICABLE" &&
      evidence.applicability === "NOT_APPLICABLE");
  const fresh = evidence.expiresAt
    ? evidence.expiresAt > expected.now
    : expected.now.getTime() - evidence.capturedAt.getTime() <= 14 * 86_400_000;
  return (
    statusAccepted &&
    fresh &&
    evidence.capturedAt <= expected.now &&
    evidence.themeId === expected.themeId &&
    evidence.templateSuffix === expected.templateSuffix &&
    evidence.deploymentVersionId == null
  );
}

async function authenticatedQaEvidence(args: {
  tx: Prisma.TransactionClient;
  evidence: {
    id: string;
    merchantId: string;
    productId: string;
    themeId: string | null;
    templateSuffix: string | null;
    deploymentVersionId: string | null;
    checkKey: string;
    status: string;
    applicability: string;
    capturedAt: Date;
    verifiedBy: string;
    evidenceRef: string;
    expiresAt: Date | null;
  };
  cutoverReceiptId: string;
  appRelease: string;
}) {
  if (!args.evidence.evidenceRef.startsWith(QA_RECEIPT_PREFIX)) return false;
  const receiptId = args.evidence.evidenceRef.slice(QA_RECEIPT_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(receiptId)) return false;
  const stored = await args.tx.actionReceipt.findFirst({
    where: {
      id: receiptId,
      merchantId: args.evidence.merchantId,
      action: V2_QA_EVIDENCE_ACTION,
    },
  });
  if (!stored) return false;
  let receipt: V2QaEvidenceReceipt;
  try {
    receipt = parseQaReceipt(stored.responseRef);
  } catch {
    return false;
  }
  if (stored.inputHash !== digest(canonicalQueuePayload(receipt))) return false;
  return (
    receipt.merchantId === args.evidence.merchantId &&
    receipt.productId === args.evidence.productId &&
    receipt.cutoverReceiptId === args.cutoverReceiptId &&
    receipt.themeId === args.evidence.themeId &&
    receipt.templateSuffix === args.evidence.templateSuffix &&
    receipt.deploymentVersionId === args.evidence.deploymentVersionId &&
    receipt.checkKey === args.evidence.checkKey &&
    receipt.status === args.evidence.status &&
    receipt.applicability === args.evidence.applicability &&
    receipt.capturedAt === args.evidence.capturedAt.toISOString() &&
    receipt.verifiedBy === args.evidence.verifiedBy &&
    receipt.appRelease === args.appRelease &&
    (receipt.authority === "OPERATOR_ARTIFACT" ||
      (["placement", "original_fallback"].includes(receipt.checkKey) &&
        receipt.authority === "STOREFRONT_RUNTIME"))
  );
}

async function authenticatedQaEvidenceProgress(args: {
  tx: Prisma.TransactionClient;
  merchantId: string;
  productId: string;
  cutoverReceiptId: string;
  themeId: string;
  templateSuffix: string | null;
  appRelease: string;
  now: Date;
}) {
  const evidenceRows = await args.tx.qaEvidence.findMany({
    where: { merchantId: args.merchantId, productId: args.productId },
    orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  const latest = new Map<string, (typeof evidenceRows)[number]>();
  for (const evidence of evidenceRows)
    if (!latest.has(evidence.checkKey)) latest.set(evidence.checkKey, evidence);
  const accepted = new Set<QaCheckKey>();
  for (const key of PILOT_QA_KEYS) {
    const evidence = latest.get(key);
    if (
      evidence &&
      acceptedQaEvidence(evidence, {
        now: args.now,
        themeId: args.themeId,
        templateSuffix: args.templateSuffix,
      }) &&
      (await authenticatedQaEvidence({
        tx: args.tx,
        evidence,
        cutoverReceiptId: args.cutoverReceiptId,
        appRelease: args.appRelease,
      }))
    )
      accepted.add(key);
  }
  return {
    acceptedChecks: PILOT_QA_KEYS.filter((key) => accepted.has(key)),
    pendingChecks: PILOT_QA_KEYS.filter((key) => !accepted.has(key)),
    latest,
  };
}

/**
 * Returns the same authenticated, release-bound QA status used by hold release.
 * This is presentation-only: an unauthenticated/stale row remains pending.
 */
export async function loadAuthenticatedV2QaEvidenceProgress(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  now?: Date;
  environment?: Record<string, string | undefined>;
}) {
  const now = args.now ?? new Date();
  const release = appRelease(args.environment ?? process.env);
  return args.db.$transaction(async (tx) => {
    const plan = await tx.autopilotPlan.findFirst({
      where: {
        id: args.planId,
        merchantId: args.merchantId,
        orchestrationProtocolVersion:
          MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        cutoverReceiptId: { not: null },
      },
      include: { product: { include: { themeActivation: true } } },
    });
    if (!plan?.cutoverReceiptId)
      throw new Error("V2_CUTOVER_PLAN_REQUIRED");
    const theme = plan.product.themeActivation;
    if (!theme?.themeId) {
      return {
        acceptedChecks: [] as QaCheckKey[],
        pendingChecks: [...PILOT_QA_KEYS],
      };
    }
    const progress = await authenticatedQaEvidenceProgress({
      tx,
      merchantId: args.merchantId,
      productId: plan.productId,
      cutoverReceiptId: plan.cutoverReceiptId,
      themeId: theme.themeId,
      templateSuffix: templateSuffix(plan.product.sourceSnapshot),
      appRelease: release,
      now,
    });
    return {
      acceptedChecks: progress.acceptedChecks,
      pendingChecks: progress.pendingChecks,
    };
  });
}

/**
 * Clears only the exact migration hold created by beginSelectedTestStoreV2Cutover.
 * This is intentionally separate from preparation and theme verification: no
 * partial evidence, client-provided PASS flag, or unrelated safety incident can
 * turn serving back on.
 */
export async function releaseSelectedTestStoreV2CutoverHold(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  actor: string;
  now?: Date;
  environment?: Record<string, string | undefined>;
}) {
  const now = args.now ?? new Date();
  const release = appRelease(args.environment ?? process.env);
  return args.db.$transaction(async (tx) => {
    const runtime = await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const plan = await tx.autopilotPlan.findFirst({
      where: { id: args.planId, merchantId: args.merchantId },
      include: { product: { include: { themeActivation: true } } },
    });
    if (
      !plan ||
      plan.orchestrationProtocolVersion !==
        MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION ||
      !plan.cutoverReceiptId
    )
      throw new Error("V2_CUTOVER_PLAN_REQUIRED");
    if (plan.state !== "VERIFYING")
      throw new Error("V2_CUTOVER_PLAN_NOT_VERIFYING");
    if (!plan.approvedAt || !plan.approvalRecordJson)
      throw new Error("V2_CUTOVER_FRESH_APPROVAL_REQUIRED");
    let approval: { cutoverReceiptId?: unknown; planHash?: unknown };
    try {
      approval = JSON.parse(plan.approvalRecordJson) as {
        cutoverReceiptId?: unknown;
        planHash?: unknown;
      };
    } catch {
      throw new Error("V2_CUTOVER_FRESH_APPROVAL_REQUIRED");
    }
    if (
      approval.cutoverReceiptId !== plan.cutoverReceiptId ||
      approval.planHash !== plan.planHash
    )
      throw new Error("V2_CUTOVER_FRESH_APPROVAL_REQUIRED");
    const { scope } = await loadV2TestStoreCutoverReceipt({
      db: tx,
      merchantId: args.merchantId,
      receiptId: plan.cutoverReceiptId,
      productId: plan.productId,
      requireCurrentSource: true,
    });
    const theme = plan.product.themeActivation;
    if (
      !theme?.activeOnPublishedTheme ||
      theme.extensionStatus !== "ACTIVE" ||
      theme.blockHandle !== "adaptive-panel" ||
      !theme.themeId ||
      !theme.activationTarget ||
      !theme.verifiedAt ||
      !theme.verifiedBy ||
      theme.verifiedAt > now ||
      now.getTime() - theme.verifiedAt.getTime() > 14 * 86_400_000
    )
      throw new Error("V2_CUTOVER_THEME_EVIDENCE_REQUIRED");
    const suffix = templateSuffix(plan.product.sourceSnapshot);
    const evidenceProgress = await authenticatedQaEvidenceProgress({
      tx,
      merchantId: args.merchantId,
      productId: plan.productId,
      cutoverReceiptId: plan.cutoverReceiptId,
      themeId: theme.themeId!,
      templateSuffix: suffix,
      appRelease: release,
      now,
    });
    if (evidenceProgress.pendingChecks.length)
      throw new Error(
        `V2_CUTOVER_EVIDENCE_INCOMPLETE:${evidenceProgress.pendingChecks.join(",")}`,
      );
    if (!runtime.killSwitch && runtime.reason == null) {
      const prior = await tx.auditLog.findFirst({
        where: {
          merchantId: args.merchantId,
          action: "V2_TEST_STORE_CUTOVER_HOLD_RELEASED",
          resourceType: "AUTOPILOT_PLAN",
          resourceId: plan.id,
        },
        orderBy: { createdAt: "desc" },
      });
      if (prior) {
        try {
          const details = JSON.parse(prior.detailsJson) as {
            cutoverReceiptId?: unknown;
            planHash?: unknown;
          };
          if (
            details.cutoverReceiptId === plan.cutoverReceiptId &&
            details.planHash === plan.planHash
          )
            return {
              planId: plan.id,
              cutoverReceiptId: plan.cutoverReceiptId,
              replayed: true,
            };
        } catch {
          // The durable release audit is part of authority, not decoration.
        }
      }
      throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
    }
    if (!runtime.killSwitch || runtime.reason !== scope.holdReason)
      throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
    const cleared = await tx.runtimeControl.updateMany({
      where: {
        merchantId: args.merchantId,
        killSwitch: true,
        reason: scope.holdReason,
      },
      data: {
        killSwitch: false,
        reason: null,
        clearedBy: args.actor,
        clearedAt: now,
      },
    });
    if (cleared.count !== 1)
      throw new Error("V2_CUTOVER_SAFETY_HOLD_CHANGED");
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "V2_TEST_STORE_CUTOVER_HOLD_RELEASED",
        resourceType: "AUTOPILOT_PLAN",
        resourceId: plan.id,
        detailsJson: canonicalQueuePayload({
          cutoverReceiptId: plan.cutoverReceiptId,
          productId: plan.productId,
          planHash: plan.planHash,
          themeId: theme.themeId,
          evidenceIds: PILOT_QA_KEYS.map(
            (key) => evidenceProgress.latest.get(key)!.id,
          ),
        }),
        createdAt: now,
      },
    });
    return {
      planId: plan.id,
      cutoverReceiptId: plan.cutoverReceiptId,
      replayed: false,
    };
  });
}

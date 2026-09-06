import type { Prisma, PrismaClient } from "@prisma/client";

import {
  approveBrandProfile,
  approveExperience,
  buildDraftLibrary,
  hashValue,
} from "./governance.server";
import {
  AUTHORIZED_AUTOPILOT_TRANSITIONS,
  AUTOPILOT_SAFETY_POLICY_VERSION,
  autopilotHash,
  autopilotPlanMaterial,
  rankProductCandidates,
  type CandidateInput,
} from "./autopilot";
import { ensureBetaEntitlement } from "./beta-entitlement.server";
import {
  LEGACY_AUTOPILOT_AA_PROTOCOL_VERSION,
  LEGACY_AUTOPILOT_EFFECT_PROTOCOL_VERSION,
  LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_PRIMARY_METRIC,
  MVP_V2_PROTOCOL_VERSION,
} from "./mvp-v2";
import { assertCurrentV2TestStoreCutoverReceipt } from "./test-store-cutover.server";

const PLAN_EXPIRY_DAYS = 30;
const PREPARATION_JOB_TYPE = "AUTOPILOT_PREPARATION";
const PREPARED_PLAN_STATES = new Set([
  "READY_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_THEME",
  "VERIFYING",
  "AA_RUNNING",
  "AA_FAILED",
  "REAL_TEST_RUNNING",
  "PAUSED",
  "RESULT_READY",
]);

type PreparationNoticeDb = PrismaClient | Prisma.TransactionClient;

function preparationNoticeJobId(value: string) {
  try {
    const parsed = JSON.parse(value) as { jobId?: unknown };
    return typeof parsed.jobId === "string" && parsed.jobId.length <= 160
      ? parsed.jobId
      : null;
  } catch {
    return null;
  }
}

function preparationJobMatchesPlan(
  value: string,
  plan: { productId: string; cutoverReceiptId: string | null },
) {
  try {
    const parsed = JSON.parse(value) as {
      preferredProductId?: unknown;
      cutoverReceiptId?: unknown;
    };
    const preferredProductId = parsed.preferredProductId ?? null;
    const cutoverReceiptId = parsed.cutoverReceiptId ?? null;
    return (
      (preferredProductId === plan.productId ||
        (preferredProductId === null && plan.cutoverReceiptId === null)) &&
      cutoverReceiptId === plan.cutoverReceiptId
    );
  } catch {
    return false;
  }
}

async function reconcileSuccessfulPreparationNoticesInDb(args: {
  db: PreparationNoticeDb;
  merchantId: string;
  planId: string;
  now: Date;
}) {
  const plan = await args.db.autopilotPlan.findFirst({
    where: { id: args.planId, merchantId: args.merchantId },
    select: {
      id: true,
      productId: true,
      cutoverReceiptId: true,
      contentVersionIdsJson: true,
      state: true,
    },
  });
  if (!plan || !PREPARED_PLAN_STATES.has(plan.state)) return [];
  let contentIds: string[] = [];
  try {
    const parsed = JSON.parse(plan.contentVersionIdsJson) as unknown;
    if (Array.isArray(parsed))
      contentIds = parsed.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0 && value.length <= 160,
      );
  } catch {
    return [];
  }
  if (!contentIds.length || new Set(contentIds).size !== contentIds.length)
    return [];
  const contentCount = await args.db.experienceVersion.count({
    where: {
      id: { in: contentIds },
      merchantId: args.merchantId,
      productId: plan.productId,
      staleAt: null,
    },
  });
  if (contentCount !== contentIds.length) return [];

  const notices = await args.db.merchantNotice.findMany({
    where: {
      merchantId: args.merchantId,
      status: "OPEN",
      kind: "PREPARATION_FAILED",
    },
    select: { id: true, dedupeKey: true, metadataJson: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  const exactIds = new Set(
    notices
      .filter(
        (notice) => notice.dedupeKey === `unsupported-content:${plan.productId}`,
      )
      .map((notice) => notice.id),
  );
  const noticeJobs = notices.flatMap((notice) => {
    const jobId = preparationNoticeJobId(notice.metadataJson);
    return jobId ? [{ noticeId: notice.id, jobId }] : [];
  });
  if (noticeJobs.length) {
    const jobs = await args.db.job.findMany({
      where: {
        id: { in: [...new Set(noticeJobs.map((item) => item.jobId))] },
        merchantId: args.merchantId,
        type: PREPARATION_JOB_TYPE,
      },
      select: { id: true, payloadJson: true, resultRef: true, status: true },
      take: 100,
    });
    const exactJobIds = new Set(
      jobs
        .filter(
          (job) =>
            job.status === "COMPLETED" &&
            job.resultRef === plan.id &&
            preparationJobMatchesPlan(job.payloadJson, plan),
        )
        .map((job) => job.id),
    );
    for (const item of noticeJobs)
      if (exactJobIds.has(item.jobId)) exactIds.add(item.noticeId);
  }
  const resolvedIds = [...exactIds].sort();
  if (!resolvedIds.length) return [];
  await args.db.merchantNotice.updateMany({
    where: {
      id: { in: resolvedIds },
      merchantId: args.merchantId,
      status: "OPEN",
    },
    data: { status: "RESOLVED", resolvedAt: args.now },
  });
  await args.db.auditLog.create({
    data: {
      merchantId: args.merchantId,
      actor: "system:autopilot-preparation",
      action: "autopilot_preparation_notices_reconciled",
      resourceType: "AUTOPILOT_PLAN",
      resourceId: plan.id,
      detailsJson: JSON.stringify({ noticeIds: resolvedIds }),
      createdAt: args.now,
    },
  });
  return resolvedIds;
}

export async function reconcileSuccessfulAutopilotPreparationNotices(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  return args.db.$transaction((tx) =>
    reconcileSuccessfulPreparationNoticesInDb({ ...args, db: tx, now }),
  );
}

function sourceSignals(sourceSnapshot: string) {
  let snapshot: {
    title?: string;
    description?: string;
    productType?: string;
    variants?: Array<{ availableForSale?: boolean }>;
  } = {};
  try {
    snapshot = JSON.parse(sourceSnapshot) as typeof snapshot;
  } catch {
    snapshot = {};
  }
  const sourceTextLength = [
    snapshot.title,
    snapshot.description,
    snapshot.productType,
  ].join(" ").trim().length;
  const readiness = Math.min(
    100,
    (snapshot.title ? 20 : 0) +
      Math.min(60, String(snapshot.description ?? "").length / 5) +
      (snapshot.productType ? 10 : 0) +
      ((snapshot.variants?.length ?? 0) ? 10 : 0),
  );
  return {
    sourceTextLength,
    sourceReadinessScore: Math.round(readiness),
    availableVariants:
      snapshot.variants?.filter((variant) => variant.availableForSale).length ??
      0,
    totalVariants: snapshot.variants?.length ?? 0,
  };
}

function protocolSnapshots(v2: boolean) {
  if (v2) {
    return {
      orchestrationProtocolVersion: MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      aa: {
        keyPrefix: "pagnetic-v2-original-baseline",
        protocolVersion: MVP_V2_PROTOCOL_VERSION,
        primaryMetric: MVP_V2_PRIMARY_METRIC,
        controlPercentage: 50,
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "ORIGINAL",
        revenueDefinition: "NET_FOCAL_MERCHANDISE",
        minimumMeaningfulLift: 0.05,
        alpha: 0.05,
        power: 0.8,
        targetSampleSize: 2_000,
        minimumDurationDays: 14,
        maximumDurationDays: 14,
        dataMaturityLagDays: 7,
        randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
        stoppingRule: "FIXED_COHORT_V2",
        analysisVersion: "assigned-visitor-welch-v2.3",
      },
      real: {
        keyPrefix: "pagnetic-v2-message-test",
        protocolVersion: MVP_V2_PROTOCOL_VERSION,
        primaryMetric: MVP_V2_PRIMARY_METRIC,
        controlPercentage: 50,
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "UNIVERSAL",
        revenueDefinition: "NET_FOCAL_MERCHANDISE",
        minimumMeaningfulLift: 0.05,
        alpha: 0.05,
        power: 0.8,
        targetSampleSize: "QUALIFICATION_DERIVED",
        minimumDurationDays: 14,
        maximumDurationDays: 42,
        dataMaturityLagDays: 7,
        randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
        stoppingRule: "FIXED_COHORT_V2",
        analysisVersion: "assigned-visitor-welch-v2.3",
      },
    };
  }
  return {
    orchestrationProtocolVersion: LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
    aa: {
      keyPrefix: "autopilot-aa",
      protocolVersion: LEGACY_AUTOPILOT_AA_PROTOCOL_VERSION,
      controlPercentage: 50,
      controlPolicy: "ORIGINAL",
      treatmentPolicy: "ORIGINAL",
      revenueDefinition: "NET",
      minimumMeaningfulLift: 0.05,
      alpha: 0.05,
      power: 0.8,
      targetSampleSize: 1000,
      minimumDurationDays: 7,
      maximumDurationDays: 30,
      dataMaturityLagDays: 7,
    },
    real: {
      keyPrefix: "autopilot-stage-1",
      protocolVersion: LEGACY_AUTOPILOT_EFFECT_PROTOCOL_VERSION,
      controlPercentage: 50,
      controlPolicy: "ORIGINAL",
      treatmentPolicy: "UNIVERSAL",
      revenueDefinition: "NET",
      minimumMeaningfulLift: 0.05,
      alpha: 0.05,
      power: 0.8,
      targetSampleSize: 1000,
      minimumDurationDays: 14,
      maximumDurationDays: 42,
      dataMaturityLagDays: 7,
    },
  };
}

async function upsertNotice(args: {
  db: PrismaClient | Prisma.TransactionClient;
  merchantId: string;
  planId?: string;
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
      planId: args.planId,
      kind: args.kind,
      status: "OPEN",
      title: args.title,
      detail: args.detail,
      actionLabel: args.actionLabel,
      actionHref: "/app",
      resolvedAt: null,
    },
  });
}

export async function prepareAutopilotOpportunity(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  preferredProductId?: string;
  cutoverReceiptId?: string;
  now?: Date;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  const now = args.now ?? new Date();
  const cutover = args.cutoverReceiptId
    ? await assertCurrentV2TestStoreCutoverReceipt({
        db: args.db,
        merchantId: args.merchantId,
        receiptId: args.cutoverReceiptId,
        productId: args.preferredProductId,
        requireCurrentSource: true,
      })
    : null;
  if (cutover && args.preferredProductId !== cutover.scope.productId)
    throw new Error("V2_CUTOVER_PRODUCT_REQUIRED");
  const assertAuthority = async (
    db: PrismaClient | Prisma.TransactionClient,
  ) => {
    await args.assertActive?.(db);
    if (cutover)
      await assertCurrentV2TestStoreCutoverReceipt({
        db,
        merchantId: args.merchantId,
        receiptId: cutover.receipt.id,
        productId: cutover.scope.productId,
        requireCurrentSource: true,
      });
  };
  const withAuthority = async <T>(
    work: (db: PrismaClient | Prisma.TransactionClient) => Promise<T>,
  ) => {
    if (!args.assertActive && !cutover) return work(args.db);
    return args.db.$transaction(async (tx) => {
      await assertAuthority(tx);
      return work(tx);
    });
  };
  const [products, activeMappings, entitlement] = await withAuthority(
    async (db) => {
      await db.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: args.actor,
          action: "autopilot_preparation_started",
          resourceType: "MERCHANT",
          resourceId: args.merchantId,
          detailsJson: JSON.stringify({
            preferredProductId: args.preferredProductId ?? null,
            cutoverReceiptId: cutover?.receipt.id ?? null,
          }),
        },
      });
      return Promise.all([
    db.product.findMany({
      where: { merchantId: args.merchantId },
      orderBy: { id: "asc" },
      include: {
        qualification: true,
        experiments: { where: { status: "ACTIVE" }, select: { id: true } },
      },
    }),
    db.campaignMapping.findMany({
      where: { merchantId: args.merchantId, status: "ACTIVE" },
      orderBy: [{ signature: "asc" }, { version: "asc" }],
    }),
    ensureBetaEntitlement(db, args.merchantId),
      ]);
    },
  );
  if (!products.length) return { status: "NEEDS_CATALOG" as const };

  const candidateInputs: CandidateInput[] = products.map((product) => {
    const source = sourceSignals(product.sourceSnapshot);
    return {
      productId: product.id,
      title: product.title,
      status: product.status,
      ...source,
      recentEligibleSessions: product.qualification?.eligibleSessions ?? null,
      recentNetRevenueMinor: product.qualification
        ? Math.round(Number(product.qualification.revenueAmount) * 100)
        : null,
      recentOrders: product.qualification?.orders ?? null,
      acquisitionCoverage: activeMappings.length ? 0.5 : null,
      conflictingExperiment: product.experiments.length > 0,
      targetSampleSize: product.qualification?.targetSampleSize ?? 1000,
    };
  });
  const ranked = rankProductCandidates(candidateInputs);
  const persisted = new Map<string, string>();
  for (const score of ranked.scores) {
    const record = await withAuthority((db) => db.productCandidateScore.create({
      data: {
        merchantId: args.merchantId,
        productId: score.productId,
        scoringVersion: score.scoringVersion,
        lookbackStart:
          products.find((item) => item.id === score.productId)?.qualification
            ?.windowStart ?? null,
        lookbackEnd:
          products.find((item) => item.id === score.productId)?.qualification
            ?.windowEnd ?? null,
        inputAvailabilityJson: JSON.stringify(score.inputAvailability),
        componentScoresJson: JSON.stringify(score.componentScores),
        exclusionsJson: JSON.stringify(score.exclusions),
        explanationJson: JSON.stringify(score.explanations),
        totalScore: score.totalScore,
        qualificationBand: score.qualificationBand,
        durationBand: score.durationBand,
      },
    }));
    persisted.set(score.productId, record.id);
  }

  let selected = ranked.selected;
  if (args.preferredProductId) {
    selected =
      ranked.scores.find(
        (score) =>
          score.productId === args.preferredProductId && score.eligible,
      ) ?? null;
  }
  if (!selected && ranked.tied.length > 1 && !args.preferredProductId) {
    await withAuthority((db) => upsertNotice({
      db,
      merchantId: args.merchantId,
      dedupeKey: "candidate-tie",
      kind: "CANDIDATE_TIE",
      title: "Choose between equally strong products",
      detail: "Two or more products have materially similar opportunity scores.",
      actionLabel: "Choose product",
    }));
    return { status: "CANDIDATE_TIE" as const, ranked };
  }
  if (!selected || !selected.eligible) {
    await withAuthority((db) => upsertNotice({
      db,
      merchantId: args.merchantId,
      dedupeKey: "no-eligible-product",
      kind: "INSUFFICIENT_TRAFFIC",
      title: "No responsible test path yet",
      detail:
        "Pagnetic will keep the storefront original while catalog or baseline evidence improves.",
    }));
    return { status: "NO_ELIGIBLE_PRODUCT" as const, ranked };
  }

  const selectedProduct = products.find(
    (product) => product.id === selected?.productId,
  )!;
  await withAuthority((db) => db.betaEntitlement.update({
    where: { id: entitlement.id },
    data: { heroProductId: selectedProduct.id, activationStage: "AUTOPILOT_PREPARING" },
  }));
  const existingContent = await args.db.experienceVersion.count({
    where: {
      merchantId: args.merchantId,
      productId: selectedProduct.id,
      status: { in: ["DRAFT", "APPROVED_ACTIVE"] },
      staleAt: null,
    },
  });
  if (!existingContent) {
    await assertAuthority(args.db);
    await buildDraftLibrary({
      db: args.db,
      merchantId: args.merchantId,
      productId: selectedProduct.id,
      actor: "system:autopilot-preparation",
      assertActive: assertAuthority,
    });
    await assertAuthority(args.db);
  }
  const experiences = await args.db.experienceVersion.findMany({
    where: {
      merchantId: args.merchantId,
      productId: selectedProduct.id,
      status: { in: ["DRAFT", "APPROVED_ACTIVE"] },
      staleAt: null,
    },
    include: {
      angle: { select: { key: true } },
      claims: { include: { evidenceLinks: { include: { evidence: true } } } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const valid = experiences.filter(
    (experience) =>
      experience.riskClass !== "HIGH" &&
      experience.riskClass !== "PROHIBITED" &&
      JSON.parse(experience.validationFindingsJson).length === 0 &&
      experience.claims.length > 0 &&
      experience.claims.every(
        (claim) =>
          claim.evidenceLinks.length > 0 &&
          claim.evidenceLinks.every(
            ({ evidence }) =>
              evidence.merchantStatus === "APPROVED" &&
              evidence.sourceVersion === selectedProduct.sourceVersion &&
              evidence.riskClass !== "HIGH" &&
              evidence.riskClass !== "PROHIBITED",
          ),
      ),
  );
  const universal = valid.find(
    (experience) => experience.angle?.key === "universal",
  );
  if (!universal) {
    await withAuthority((db) => upsertNotice({
      db,
      merchantId: args.merchantId,
      dedupeKey: `unsupported-content:${selectedProduct.id}`,
      kind: "PREPARATION_FAILED",
      title: "Source-grounded content could not be prepared",
      detail: "No valid Universal panel can be built from the current product source.",
    }));
    return { status: "CONTENT_BLOCKED" as const, ranked };
  }
  const distinct = [universal];
  const hashes = new Set([universal.contentHash]);
  for (const experience of valid) {
    if (distinct.length >= 4) break;
    if (experience.id === universal.id || hashes.has(experience.contentHash))
      continue;
    distinct.push(experience);
    hashes.add(experience.contentHash);
  }
  const evidenceSnapshot = distinct
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
      (item, index, all) => all.findIndex((other) => other.id === item.id) === index,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const settings = await args.db.pilotSettings.findUnique({
    where: { merchantId: args.merchantId },
  });
  const protocols = protocolSnapshots(Boolean(cutover));
  const scoreSnapshot = {
    scoringVersion: selected.scoringVersion,
    productId: selected.productId,
    inputAvailability: selected.inputAvailability,
    componentScores: selected.componentScores,
    exclusions: selected.exclusions,
    totalScore: selected.totalScore,
    qualificationBand: selected.qualificationBand,
    durationBand: selected.durationBand,
  };
  const mappingVersions = activeMappings.map((mapping) => ({
    id: mapping.id,
    version: mapping.version,
    signature: mapping.signature,
  }));
  const material = autopilotPlanMaterial({
    productId: selectedProduct.id,
    candidateScoreSnapshot: scoreSnapshot,
    contentVersionIds: distinct.map((item) => item.id),
    contentHashes: distinct.map((item) => item.contentHash),
    evidenceSnapshotHash: autopilotHash(evidenceSnapshot),
    mappingVersions,
    unknownTrafficPolicy: settings?.unknownTrafficPolicy ?? "ORIGINAL",
    aaProtocol: protocols.aa,
    realExperimentProtocol: protocols.real,
    safetyPolicyVersion: AUTOPILOT_SAFETY_POLICY_VERSION,
    authorizedTransitions: AUTHORIZED_AUTOPILOT_TRANSITIONS,
    cutoverReceiptId: cutover?.receipt.id,
  });
  const planHash = autopilotHash(material);
  const existingPlan = await args.db.autopilotPlan.findUnique({
    where: { planHash },
  });
  if (existingPlan) return { status: "READY" as const, plan: existingPlan, ranked };

  const latest = await args.db.autopilotPlan.aggregate({
    where: { merchantId: args.merchantId, productId: selectedProduct.id },
    _max: { version: true },
  });
  const expiresAt = new Date(now.getTime() + PLAN_EXPIRY_DAYS * 86_400_000);
  const plan = await args.db.$transaction(async (tx) => {
    await assertAuthority(tx);
    await tx.autopilotPlan.updateMany({
      where: {
        merchantId: args.merchantId,
        state: { in: ["PREPARING", "READY_FOR_APPROVAL"] },
      },
      data: { state: "INVALIDATED" },
    });
    const created = await tx.autopilotPlan.create({
      data: {
        merchantId: args.merchantId,
        productId: selectedProduct.id,
        candidateScoreId: persisted.get(selectedProduct.id)!,
        version: (latest._max.version ?? 0) + 1,
        state: "READY_FOR_APPROVAL",
        planHash,
        candidateScoreSnapshotJson: JSON.stringify(scoreSnapshot),
        contentVersionIdsJson: JSON.stringify(material.contentVersionIds),
        contentHashesJson: JSON.stringify(material.contentHashes),
        evidenceSnapshotHash: material.evidenceSnapshotHash,
        mappingVersionsJson: JSON.stringify(mappingVersions),
        unknownTrafficPolicy: material.unknownTrafficPolicy,
        aaProtocolJson: JSON.stringify(protocols.aa),
        realExperimentProtocolJson: JSON.stringify(protocols.real),
        safetyPolicyVersion: AUTOPILOT_SAFETY_POLICY_VERSION,
        orchestrationProtocolVersion: protocols.orchestrationProtocolVersion,
        cutoverReceiptId: cutover?.receipt.id ?? null,
        authorizedTransitionsJson: JSON.stringify(AUTHORIZED_AUTOPILOT_TRANSITIONS),
        expiresAt,
      },
    });
    await tx.autopilotTransition.create({
      data: {
        merchantId: args.merchantId,
        planId: created.id,
        fromState: "PREPARING",
        toState: "READY_FOR_APPROVAL",
        actorType: "SYSTEM",
        actorId: "system:autopilot-preparation",
        reasonCode: "OPPORTUNITY_PREPARED",
        gateSnapshotHash: planHash,
        idempotencyKey: `${created.id}:ready:${planHash}`,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "autopilot_preparation_completed",
        resourceType: "AUTOPILOT_PLAN",
        resourceId: created.id,
        detailsJson: JSON.stringify({ planHash, productId: selectedProduct.id }),
      },
    });
    return created;
  });
  await withAuthority((db) => upsertNotice({
    db,
    merchantId: args.merchantId,
    planId: plan.id,
    dedupeKey: `opportunity-ready:${plan.id}`,
    kind: "OPPORTUNITY_READY",
    title: "Your first opportunity is ready",
    detail: `Review the sourced plan for ${selectedProduct.title}.`,
    actionLabel: "Review opportunity",
  }));
  await withAuthority((db) =>
    reconcileSuccessfulPreparationNoticesInDb({
      db,
      merchantId: args.merchantId,
      planId: plan.id,
      now,
    }),
  );
  return { status: "READY" as const, plan, ranked };
}

export async function approveAutopilotPlan(args: {
  db: PrismaClient;
  merchantId: string;
  planId: string;
  planHash: string;
  actor: string;
  mediumRiskAcknowledged: boolean;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const plan = await args.db.autopilotPlan.findFirst({
    where: { id: args.planId, merchantId: args.merchantId },
  });
  if (!plan) throw new Error("Autopilot plan was not found for this store.");
  if (plan.state !== "READY_FOR_APPROVAL") {
    if (plan.approvedAt && plan.planHash === args.planHash) return plan;
    throw new Error("Only a current opportunity can be approved.");
  }
  if (plan.planHash !== args.planHash || plan.expiresAt <= now)
    throw new Error("This opportunity changed or expired. Review the refreshed plan.");
  const contentIds = JSON.parse(plan.contentVersionIdsJson) as string[];
  const expectedHashes = JSON.parse(plan.contentHashesJson) as string[];
  const experiences = await args.db.experienceVersion.findMany({
    where: { id: { in: contentIds }, merchantId: args.merchantId },
    include: {
      claims: { include: { evidenceLinks: { include: { evidence: true } } } },
    },
  });
  if (
    experiences.length !== contentIds.length ||
    experiences.some((experience) => experience.staleAt) ||
    autopilotHash(experiences.map((item) => item.contentHash).sort()) !==
      autopilotHash(expectedHashes.sort())
  ) {
    throw new Error("Approved source or content changed. A new plan is required.");
  }
  const evidenceSnapshot = experiences
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
      (item, index, all) => all.findIndex((other) => other.id === item.id) === index,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (autopilotHash(evidenceSnapshot) !== plan.evidenceSnapshotHash)
    throw new Error("Evidence changed after preparation. A new plan is required.");
  const hasMediumRisk = experiences.some(
    (experience) =>
      experience.riskClass === "MEDIUM" ||
      experience.claims.some((claim) => claim.riskClass === "MEDIUM"),
  );
  if (hasMediumRisk && !args.mediumRiskAcknowledged)
    throw new Error("Acknowledge the highlighted medium-risk source text.");

  const brand = await args.db.brandProfile.findUnique({
    where: { merchantId: args.merchantId },
  });
  if (brand && brand.status !== "APPROVED")
    await approveBrandProfile({ db: args.db, merchantId: args.merchantId, actor: args.actor });
  for (const experience of experiences) {
    if (experience.status === "DRAFT") {
      await approveExperience({
        db: args.db,
        merchantId: args.merchantId,
        experienceId: experience.id,
        actor: args.actor,
      });
    }
  }
  const approvalRecord = {
    approver: args.actor,
    approvedAt: now.toISOString(),
    planHash: plan.planHash,
    contentVersionIds: contentIds,
    contentHashes: expectedHashes,
    evidenceSnapshotHash: plan.evidenceSnapshotHash,
    mappingVersions: JSON.parse(plan.mappingVersionsJson),
    aaProtocolHash: hashValue(JSON.parse(plan.aaProtocolJson)),
    realProtocolHash: hashValue(JSON.parse(plan.realExperimentProtocolJson)),
    safetyPolicyVersion: plan.safetyPolicyVersion,
    orchestrationProtocolVersion: plan.orchestrationProtocolVersion,
    cutoverReceiptId: plan.cutoverReceiptId,
    grantedActions: JSON.parse(plan.authorizedTransitionsJson),
  };
  const updated = await args.db.$transaction(async (tx) => {
    const saved = await tx.autopilotPlan.update({
      where: { id: plan.id },
      data: {
        state: "WAITING_FOR_THEME",
        approvedBy: args.actor,
        approvedAt: now,
        mediumRiskAcknowledgedAt: hasMediumRisk ? now : null,
        approvalRecordJson: JSON.stringify(approvalRecord),
      },
    });
    await tx.autopilotTransition.createMany({
      data: [
        {
          merchantId: args.merchantId,
          planId: plan.id,
          fromState: "READY_FOR_APPROVAL",
          toState: "APPROVED",
          actorType: "MERCHANT",
          actorId: args.actor,
          reasonCode: "BOUNDED_PLAN_APPROVED",
          gateSnapshotHash: plan.planHash,
          idempotencyKey: `${plan.id}:approved:${plan.planHash}`,
        },
        {
          merchantId: args.merchantId,
          planId: plan.id,
          fromState: "APPROVED",
          toState: "WAITING_FOR_THEME",
          actorType: "SYSTEM",
          actorId: "system:autopilot",
          reasonCode: "THEME_SAVE_REQUIRED",
          gateSnapshotHash: plan.planHash,
          idempotencyKey: `${plan.id}:waiting-theme:${plan.planHash}`,
        },
      ],
    });
    await tx.merchantNotice.updateMany({
      where: { merchantId: args.merchantId, planId: plan.id, status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: now },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "plan_approved",
        resourceType: "AUTOPILOT_PLAN",
        resourceId: plan.id,
        detailsJson: JSON.stringify(approvalRecord),
      },
    });
    return saved;
  });
  await upsertNotice({
    db: args.db,
    merchantId: args.merchantId,
    planId: plan.id,
    dedupeKey: `theme-save:${plan.id}`,
    kind: "THEME_SAVE_REQUIRED",
    title: "Save the panel in Shopify",
    detail: "Preview the panel, then click Save in the published theme editor.",
    actionLabel: "Open theme editor",
  });
  return updated;
}

export async function refreshAutopilotBaseline(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
  });
  if (!product) throw new Error("Autopilot product was not found.");
  const windowStart = new Date(now.getTime() - 28 * 86_400_000);
  const events = await args.db.commerceEvent.findMany({
    where: {
      merchantId: args.merchantId,
      occurredAt: { gte: windowStart, lte: now },
      eventType: { in: ["product_viewed", "checkout_completed"] },
      consentState: { notIn: ["denied", "DENIED"] },
      OR: [
        { productId: product.shopifyProductId },
        { decision: { productId: product.id } },
      ],
    },
  });
  const productViews = events.filter(
    (event) => event.eventType === "product_viewed",
  );
  const sessions = new Set(
    productViews
      .map((event) => event.sessionId)
      .filter((value): value is string => Boolean(value)),
  );
  if (!productViews.length || !sessions.size) return null;
  const checkoutEvents = events.filter(
    (event) =>
      event.eventType === "checkout_completed" &&
      Boolean(event.sessionId && sessions.has(event.sessionId)),
  );
  let revenueAmount = 0;
  let currencyCode = "USD";
  for (const event of checkoutEvents) {
    const payload = JSON.parse(event.payloadJson) as {
      amount?: number;
      currencyCode?: string;
    };
    if (Number.isFinite(payload.amount)) revenueAmount += payload.amount ?? 0;
    if (/^[A-Z]{3}$/.test(payload.currencyCode ?? ""))
      currencyCode = payload.currencyCode!;
  }
  const eventCoverage = sessions.size / productViews.length;
  const weeklyEligibleSessions = sessions.size / 4;
  const expectedDurationDays =
    weeklyEligibleSessions > 0
      ? Math.ceil((1000 / weeklyEligibleSessions) * 7)
      : 1_000_000;
  const status =
    sessions.size >= 1000 && eventCoverage >= 0.9 && checkoutEvents.length >= 10
      ? "READY"
      : sessions.size >= 50 && expectedDurationDays <= 84
        ? "LIMITED"
        : "NOT_ELIGIBLE";
  return args.db.productQualification.upsert({
    where: { productId: product.id },
    create: {
      merchantId: args.merchantId,
      productId: product.id,
      windowStart,
      windowEnd: now,
      eligibleSessions: sessions.size,
      orders: checkoutEvents.length,
      revenueAmount,
      currencyCode,
      eventCoverage,
      weeklyEligibleSessions,
      targetSampleSize: 1000,
      expectedDurationDays,
      status,
      assumptionsJson: JSON.stringify({
        source: "AUTOPILOT_WEB_PIXEL_BASELINE",
        minimumDurationDays: 14,
        maximumDurationDays: 42,
      }),
    },
    update: {
      windowStart,
      windowEnd: now,
      eligibleSessions: sessions.size,
      orders: checkoutEvents.length,
      revenueAmount,
      currencyCode,
      eventCoverage,
      weeklyEligibleSessions,
      targetSampleSize: 1000,
      expectedDurationDays,
      status,
      assumptionsJson: JSON.stringify({
        source: "AUTOPILOT_WEB_PIXEL_BASELINE",
        minimumDurationDays: 14,
        maximumDurationDays: 42,
      }),
      evaluatedAt: now,
    },
  });
}

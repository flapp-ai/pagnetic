import type { PrismaClient } from "@prisma/client";

import {
  candidateChoicesFromScores,
  durationBandLabel,
  type AutopilotPlanState,
} from "./autopilot";
import {
  isBlockingMerchantNotice,
  presentPlanTimeline,
  presentAutopilotState,
} from "./autopilot-presentation";
import {
  calculateIncrementalValue,
  formatMinorMoney,
  recommendationForResult,
  type MatureResultState,
} from "./incremental-value";
import { reconcileSuccessfulAutopilotPreparationNotices } from "./autopilot-preparation.server";
import { MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION } from "./mvp-v2";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(value ?? "") as T;
  } catch {
    return fallback;
  }
}

type PresentationNotice = {
  id: string;
  planId: string | null;
  dedupeKey: string;
  kind: string;
  status: string;
  title: string;
  detail: string;
  actionLabel: string | null;
  actionHref: string | null;
  metadataJson: string;
  createdAt: Date;
};

const PLAN_WORKFLOW_NOTICE_KINDS = new Set([
  "CANDIDATE_TIE",
  "SOURCE_CHANGED",
  "ACTIVATION_BLOCKED",
  "INSUFFICIENT_TRAFFIC",
  "PREPARATION_FAILED",
  "THEME_SAVE_REQUIRED",
  "OPPORTUNITY_READY",
  "RESULT_READY",
]);

function preparationJobId(notice: PresentationNotice) {
  const metadata = parseJson<{ jobId?: unknown; errorCode?: unknown }>(
    notice.metadataJson,
    {},
  );
  const dedupeJobId = notice.dedupeKey.startsWith("autopilot-preparation:")
    ? notice.dedupeKey.slice("autopilot-preparation:".length)
    : null;
  return {
    jobId:
      typeof metadata.jobId === "string" && metadata.jobId
        ? metadata.jobId
        : dedupeJobId,
    errorCode:
      typeof metadata.errorCode === "string" ? metadata.errorCode : null,
  };
}

async function partitionCurrentNotices(args: {
  db: PrismaClient;
  merchantId: string;
  plan: { id: string; productId: string; cutoverReceiptId: string | null } | null;
  notices: PresentationNotice[];
}) {
  const preparationNoticeJobs = args.notices
    .filter((notice) => notice.kind === "PREPARATION_FAILED")
    .map(preparationJobId)
    .map((item) => item.jobId)
    .filter((jobId): jobId is string => Boolean(jobId));
  const jobs = preparationNoticeJobs.length
    ? await args.db.job.findMany({
        where: {
          merchantId: args.merchantId,
          id: { in: [...new Set(preparationNoticeJobs)].slice(0, 100) },
          type: "AUTOPILOT_PREPARATION",
        },
        select: { id: true, payloadJson: true, resultRef: true },
      })
    : [];
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const actionable: PresentationNotice[] = [];
  const history: PresentationNotice[] = [];

  for (const notice of args.notices) {
    let current = true;
    if (PLAN_WORKFLOW_NOTICE_KINDS.has(notice.kind)) {
      if (notice.planId && notice.planId !== args.plan?.id) current = false;
      if (args.plan && notice.dedupeKey === "no-eligible-product") {
        current = false;
      } else if (!args.plan && notice.kind === "PREPARATION_FAILED") {
        current =
          preparationJobId(notice).errorCode !==
          "V2_CUTOVER_RECEIPT_SUPERSEDED";
      } else if (args.plan && notice.kind === "CANDIDATE_TIE") {
        current = false;
      } else if (args.plan && notice.kind === "PREPARATION_FAILED") {
        const metadata = preparationJobId(notice);
        if (metadata.errorCode === "V2_CUTOVER_RECEIPT_SUPERSEDED") {
          current = false;
        } else if (notice.dedupeKey.startsWith("unsupported-content:")) {
          current =
            notice.dedupeKey === `unsupported-content:${args.plan.productId}`;
        } else if (metadata.jobId) {
          const job = jobsById.get(metadata.jobId);
          const payload = parseJson<{
            preferredProductId?: unknown;
            cutoverReceiptId?: unknown;
          }>(job?.payloadJson, {});
          current = Boolean(
            job &&
              (job.resultRef === args.plan.id ||
                (payload.preferredProductId === args.plan.productId &&
                  (args.plan.cutoverReceiptId
                    ? payload.cutoverReceiptId === args.plan.cutoverReceiptId
                    : payload.cutoverReceiptId == null))),
          );
        } else {
          current = false;
        }
      }
    }
    (current ? actionable : history).push(notice);
  }
  return { actionable, history };
}

function presentNotice(notice: PresentationNotice) {
  return {
    id: notice.id,
    kind: notice.kind,
    title: notice.title,
    detail: notice.detail,
    actionLabel: notice.actionLabel,
    actionHref: notice.actionHref,
    createdAt: notice.createdAt.toISOString(),
  };
}

export async function loadAutopilotPresentation(args: {
  db: PrismaClient;
  merchantId: string;
}) {
  const plan = await args.db.autopilotPlan.findFirst({
      where: { merchantId: args.merchantId },
      orderBy: { updatedAt: "desc" },
      include: {
        product: true,
        candidateScore: true,
        transitions: { orderBy: { occurredAt: "desc" }, take: 8 },
      },
    });
  if (plan)
    await reconcileSuccessfulAutopilotPreparationNotices({
      db: args.db,
      merchantId: args.merchantId,
      planId: plan.id,
    });
  const [allOpenNotices, runtime, latestCandidates] = await Promise.all([
    args.db.merchantNotice.findMany({
      where: { merchantId: args.merchantId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    args.db.runtimeControl.findUnique({
      where: { merchantId: args.merchantId },
    }),
    (async () => {
      const latest = await args.db.productCandidateScore.findFirst({
        where: { merchantId: args.merchantId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!latest) return [];
      return args.db.productCandidateScore.findMany({
        where: {
          merchantId: args.merchantId,
          createdAt: { gte: new Date(latest.createdAt.getTime() - 60_000) },
        },
        include: { product: { select: { title: true } } },
        orderBy: [{ createdAt: "desc" }, { totalScore: "desc" }],
        take: 250,
      });
    })(),
  ]);
  const partitionedNotices = await partitionCurrentNotices({
    db: args.db,
    merchantId: args.merchantId,
    plan,
    notices: allOpenNotices,
  });
  const openNotices = partitionedNotices.actionable.slice(0, 5);
  const noticeHistory = partitionedNotices.history.slice(0, 20);
  const candidateChoices = candidateChoicesFromScores(
    latestCandidates.map((candidate) => ({
      ...candidate,
      exclusions: parseJson<string[]>(candidate.exclusionsJson, []),
    })),
  );
  const primaryNotice =
    openNotices.find((notice) => isBlockingMerchantNotice(notice.kind)) ??
    openNotices[0] ??
    null;
  const merchantState = presentAutopilotState({
    planState: (plan?.state as AutopilotPlanState | undefined) ?? null,
    openNoticeKind: primaryNotice?.kind,
    hasCandidateTie: primaryNotice?.kind === "CANDIDATE_TIE",
  });
  if (!plan) {
    return {
      merchantState,
      plan: null,
      product: null,
      candidates: candidateChoices.map((candidate) => ({
        productId: candidate.productId,
        title: candidate.product.title,
        score: candidate.totalScore,
        qualificationBand: candidate.qualificationBand,
      })),
      experiences: [],
      notices: openNotices.map(presentNotice),
      noticeHistory: noticeHistory.map(presentNotice),
      activity: [],
      measurement: null,
      result: null,
      safety: { originalServing: true, paused: Boolean(runtime?.killSwitch) },
    };
  }
  const contentIds = parseJson<string[]>(plan.contentVersionIdsJson, []);
  const experiences = await args.db.experienceVersion.findMany({
    where: { id: { in: contentIds }, merchantId: args.merchantId },
    include: {
      angle: { select: { key: true, label: true } },
      claims: {
        include: {
          evidenceLinks: {
            include: {
              evidence: {
                select: {
                  id: true,
                  verbatimText: true,
                  sourceId: true,
                  riskClass: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  const candidates = await args.db.productCandidateScore.findMany({
    where: {
      merchantId: args.merchantId,
      createdAt: { gte: new Date(plan.createdAt.getTime() - 60_000) },
    },
    include: { product: { select: { title: true } } },
    orderBy: [{ totalScore: "desc" }, { productId: "asc" }],
    take: 3,
  });
  const experimentId = plan.realExperimentId ?? plan.aaExperimentId;
  const experiment = experimentId
    ? await args.db.experiment.findFirst({
        where: { id: experimentId, merchantId: args.merchantId },
        include: {
          registration: true,
          _count: { select: { assignments: true, decisions: true } },
        },
      })
    : null;
  const target = experiment?.registration?.targetSampleSize ?? 1000;
  const measurement = experiment
    ? {
        phase:
          plan.state === "AA_RUNNING"
            ? "Checking measurement"
            : "Measuring additional revenue",
        eligibleAssignments: experiment._count.assignments,
        target,
        progress: Math.min(
          100,
          Math.round((experiment._count.assignments / target) * 100),
        ),
        startedAt: experiment.startedAt.toISOString(),
        minimumDurationDays:
          experiment.registration?.minimumDurationDays ?? null,
        dataMaturityLagDays:
          experiment.registration?.dataMaturityLagDays ?? null,
      }
    : null;
  const legacyDurationLabel = durationBandLabel(
    plan.candidateScore.durationBand as Parameters<typeof durationBandLabel>[0],
  );
  const timelineLabel = presentPlanTimeline({
    planState: plan.state as AutopilotPlanState,
    v2:
      experiment?.lifecycleVersion === 2 ||
      plan.orchestrationProtocolVersion ===
        MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
    baselineComplete:
      plan.state === "AA_RUNNING" && Boolean(experiment?.finalResultSnapshotId),
    legacyQualificationBand: plan.candidateScore.qualificationBand,
    legacyDurationLabel,
  });

  let result: null | {
    state: MatureResultState;
    verifiedLabel: string;
    intervalLabel: string | null;
    differenceLabel: string;
    projectedLabel: string | null;
    recommendation: string;
    eligibleSessions: number;
    currencyCode: string;
    startedAt: string;
    endedAt: string;
    snapshotId: string;
  } = null;
  if (plan.resultSnapshotId && experiment?.lifecycleVersion !== 2) {
    const snapshot = await args.db.experimentResultSnapshot.findFirst({
      where: {
        id: plan.resultSnapshotId,
        experiment: { merchantId: args.merchantId },
      },
      include: { experiment: true },
    });
    if (
      snapshot &&
      ["POSITIVE", "NEGATIVE", "INCONCLUSIVE", "INVALID"].includes(
        snapshot.resultState,
      )
    ) {
      const payload = parseJson<{
        analysis?: {
          currencyCode?: string | null;
          control?: { revenue?: number; sessions?: number };
          treatment?: { revenue?: number; sessions?: number };
          interval?: { lower?: number; upper?: number };
        };
      }>(snapshot.payloadJson, {});
      const analysis = payload.analysis;
      const resultState = snapshot.resultState as MatureResultState;
      const currency = analysis?.currencyCode ?? "USD";
      const totalSessions =
        (analysis?.control?.sessions ?? 0) +
        (analysis?.treatment?.sessions ?? 0);
      const durationDays = Math.max(
        1,
        (snapshot.createdAt.getTime() - snapshot.experiment.startedAt.getTime()) /
          86_400_000,
      );
      const value = calculateIncrementalValue({
        resultState,
        currencyCode: currency,
        treatmentNetRevenueMinor: Math.round(
          (analysis?.treatment?.revenue ?? 0) * 100,
        ),
        treatmentEligibleSessions: analysis?.treatment?.sessions ?? 0,
        controlNetRevenueMinor: Math.round(
          (analysis?.control?.revenue ?? 0) * 100,
        ),
        controlEligibleSessions: analysis?.control?.sessions ?? 0,
        intervalLowMinorPerSession:
          analysis?.interval?.lower == null
            ? null
            : analysis.interval.lower * 100,
        intervalHighMinorPerSession:
          analysis?.interval?.upper == null
            ? null
            : analysis.interval.upper * 100,
        projectedMonthlyEligibleSessions:
          resultState === "POSITIVE"
            ? Math.round((totalSessions / durationDays) * 30)
            : null,
      });
      result = {
        state: resultState,
        verifiedLabel: formatMinorMoney(
          value.verifiedIncrementalMinor,
          currency,
        ),
        intervalLabel:
          value.intervalLowMinor == null || value.intervalHighMinor == null
            ? null
            : `${formatMinorMoney(value.intervalLowMinor, currency)} to ${formatMinorMoney(value.intervalHighMinor, currency)}`,
        differenceLabel: `${formatMinorMoney(Math.round(value.differenceMinorPerSession), currency)} per eligible session`,
        projectedLabel:
          value.projectedMonthlyMinor == null
            ? null
            : formatMinorMoney(value.projectedMonthlyMinor, currency),
        recommendation: recommendationForResult(resultState),
        eligibleSessions: totalSessions,
        currencyCode: currency,
        startedAt: snapshot.experiment.startedAt.toISOString(),
        endedAt: (
          snapshot.experiment.endedAt ?? snapshot.createdAt
        ).toISOString(),
        snapshotId: snapshot.id,
      };
    }
  }
  const source = parseJson<{
    featuredImage?: { url?: string; altText?: string | null } | null;
    description?: string | null;
    templateSuffix?: string | null;
  }>(plan.product.sourceSnapshot, {});
  return {
    merchantState,
    plan: {
      id: plan.id,
      state: plan.state,
      version: plan.version,
      planHash: plan.planHash,
      orchestrationProtocolVersion: plan.orchestrationProtocolVersion,
      cutoverReceiptId: plan.cutoverReceiptId,
      approvedAt: plan.approvedAt?.toISOString() ?? null,
      hasMediumRisk: experiences.some(
        (item) =>
          item.riskClass === "MEDIUM" ||
          item.claims.some((claim) => claim.riskClass === "MEDIUM"),
      ),
      durationBand: legacyDurationLabel,
      timelineLabel,
      qualificationBand: plan.candidateScore.qualificationBand,
      score: plan.candidateScore.totalScore,
      explanations: parseJson<string[]>(
        plan.candidateScore.explanationJson,
        [],
      ),
    },
    product: {
      id: plan.product.id,
      title: plan.product.title,
      handle: plan.product.handle,
      imageUrl: source.featuredImage?.url ?? null,
      imageAlt: source.featuredImage?.altText ?? plan.product.title,
      description: source.description ?? null,
      templateSuffix: source.templateSuffix ?? null,
      sourceVersion: plan.product.sourceVersion,
      sourceHash: plan.product.sourceHash,
    },
    candidates: candidates.map((candidate) => ({
      productId: candidate.productId,
      title: candidate.product.title,
      score: candidate.totalScore,
      qualificationBand: candidate.qualificationBand,
    })),
    experiences: experiences.map((experience) => ({
      id: experience.id,
      angle: experience.angle?.label ?? "Universal",
      angleKey: experience.angle?.key ?? "universal",
      headline: experience.headline,
      supportingLine: experience.supportingLine,
      benefits: parseJson<string[]>(experience.benefitsJson, []),
      riskClass: experience.riskClass,
      evidence: experience.claims.flatMap((claim) =>
        claim.evidenceLinks.map(({ evidence }) => ({
          id: evidence.id,
          claim: claim.claimText,
          source: evidence.verbatimText,
          sourceId: evidence.sourceId,
          riskClass: evidence.riskClass,
        })),
      ),
    })),
    notices: openNotices.map(presentNotice),
    noticeHistory: noticeHistory.map(presentNotice),
    activity: plan.transitions.map((transition) => ({
      id: transition.id,
      state: transition.toState,
      reason: transition.reasonCode,
      actorType: transition.actorType,
      occurredAt: transition.occurredAt.toISOString(),
    })),
    measurement,
    result,
    safety: {
      originalServing:
        Boolean(runtime?.killSwitch) ||
        ["PREPARING", "READY_FOR_APPROVAL", "APPROVED", "WAITING_FOR_THEME", "VERIFYING", "AA_RUNNING", "AA_FAILED", "PAUSED", "INVALIDATED"].includes(
          plan.state,
        ),
      paused: Boolean(runtime?.killSwitch) || plan.state === "PAUSED",
    },
  };
}

import { createHash } from "node:crypto";

export const AUTOPILOT_SCORING_VERSION = "candidate-v1";
export const AUTOPILOT_SAFETY_POLICY_VERSION = "pilot-safety-v1";
export const AUTOPILOT_PLAN_STATES = [
  "PREPARING",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "WAITING_FOR_THEME",
  "VERIFYING",
  "AA_RUNNING",
  "AA_FAILED",
  "REAL_TEST_RUNNING",
  "PAUSED",
  "RESULT_READY",
  "INVALIDATED",
] as const;

export type AutopilotPlanState = (typeof AUTOPILOT_PLAN_STATES)[number];
export type TrafficQualification =
  | "READY"
  | "LIMITED"
  | "INSUFFICIENT"
  | "UNKNOWN";
export type DurationBand =
  | "UNDER_14_DAYS"
  | "DAYS_14_TO_30"
  | "OVER_30_DAYS"
  | "NOT_ENOUGH_DATA";

export type CandidateInput = {
  productId: string;
  title: string;
  status: string;
  sourceTextLength: number;
  sourceReadinessScore: number;
  recentEligibleSessions: number | null;
  recentNetRevenueMinor: number | null;
  recentOrders: number | null;
  acquisitionCoverage: number | null;
  availableVariants: number;
  totalVariants: number;
  conflictingExperiment: boolean;
  excludedCategory?: boolean;
  targetSampleSize?: number;
};

export type CandidateScore = {
  productId: string;
  scoringVersion: string;
  eligible: boolean;
  inputAvailability: {
    traffic: boolean;
    revenue: boolean;
    acquisition: boolean;
  };
  componentScores: {
    traffic: number;
    economic: number;
    sourceReadiness: number;
    acquisitionCoverage: number;
    stability: number;
  };
  exclusions: string[];
  explanations: string[];
  totalScore: number;
  qualificationBand: TrafficQualification;
  durationBand: DurationBand;
  expectedDurationDays: number | null;
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

export function scoreProductCandidate(input: CandidateInput): CandidateScore {
  const exclusions: string[] = [];
  if (input.status !== "ACTIVE") exclusions.push("Product is not active.");
  if (input.excludedCategory) exclusions.push("Product category is excluded.");
  if (input.sourceTextLength < 40)
    exclusions.push("Product source text is too limited.");
  if (input.totalVariants > 0 && input.availableVariants === 0)
    exclusions.push("No variant is available for sale.");
  if (input.conflictingExperiment)
    exclusions.push("Another experiment is already active on this product.");

  const targetSampleSize = Math.max(20, input.targetSampleSize ?? 1000);
  const weeklySessions =
    input.recentEligibleSessions == null
      ? null
      : Math.max(0, input.recentEligibleSessions) / 4;
  const expectedDurationDays =
    weeklySessions && weeklySessions > 0
      ? Math.ceil((targetSampleSize / weeklySessions) * 7)
      : null;

  let qualificationBand: TrafficQualification;
  let durationBand: DurationBand;
  if (exclusions.length) {
    qualificationBand = "INSUFFICIENT";
    durationBand = "NOT_ENOUGH_DATA";
  } else if (weeklySessions == null) {
    qualificationBand = "UNKNOWN";
    durationBand = "NOT_ENOUGH_DATA";
  } else if (weeklySessions < 25) {
    qualificationBand = "INSUFFICIENT";
    durationBand = "NOT_ENOUGH_DATA";
  } else if ((expectedDurationDays ?? Infinity) <= 30) {
    qualificationBand = "READY";
    durationBand =
      (expectedDurationDays ?? Infinity) < 14
        ? "UNDER_14_DAYS"
        : "DAYS_14_TO_30";
  } else {
    qualificationBand = "LIMITED";
    durationBand = "OVER_30_DAYS";
  }

  const traffic =
    weeklySessions == null ? 12 : 30 * clamp(weeklySessions / 250);
  const economic =
    input.recentNetRevenueMinor == null
      ? 8
      : 12 * clamp(input.recentNetRevenueMinor / 500_000) +
        8 * clamp((input.recentOrders ?? 0) / 50);
  const sourceReadiness = 25 * clamp(input.sourceReadinessScore / 100);
  const acquisitionCoverage =
    input.acquisitionCoverage == null
      ? 3
      : 10 * clamp(input.acquisitionCoverage);
  const stability =
    15 *
    (input.totalVariants === 0
      ? 0.5
      : clamp(input.availableVariants / input.totalVariants));
  const componentScores = {
    traffic: Number(traffic.toFixed(2)),
    economic: Number(economic.toFixed(2)),
    sourceReadiness: Number(sourceReadiness.toFixed(2)),
    acquisitionCoverage: Number(acquisitionCoverage.toFixed(2)),
    stability: Number(stability.toFixed(2)),
  };
  const totalScore = exclusions.length
    ? 0
    : Number(
        Object.values(componentScores)
          .reduce((sum, value) => sum + value, 0)
          .toFixed(2),
      );
  const explanations = [
    qualificationBand === "UNKNOWN"
      ? "Recommendation is source-based while a traffic baseline is collected."
      : qualificationBand === "READY"
        ? "Observed traffic can reach the registered target within 30 days."
        : qualificationBand === "LIMITED"
          ? "The product is eligible, but a result may take more than 30 days."
          : "The product does not currently have a responsible test path.",
    `Source readiness contributes ${componentScores.sourceReadiness.toFixed(1)} of 25 points.`,
    `Availability and stability contribute ${componentScores.stability.toFixed(1)} of 15 points.`,
  ];
  return {
    productId: input.productId,
    scoringVersion: AUTOPILOT_SCORING_VERSION,
    eligible: exclusions.length === 0,
    inputAvailability: {
      traffic: input.recentEligibleSessions != null,
      revenue: input.recentNetRevenueMinor != null,
      acquisition: input.acquisitionCoverage != null,
    },
    componentScores,
    exclusions,
    explanations,
    totalScore,
    qualificationBand,
    durationBand,
    expectedDurationDays,
  };
}

export function rankProductCandidates(inputs: CandidateInput[]) {
  const scores = inputs
    .map(scoreProductCandidate)
    .sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        right.totalScore - left.totalScore ||
        left.productId.localeCompare(right.productId),
    );
  const credible = scores.filter(
    (score) => score.eligible && score.qualificationBand !== "INSUFFICIENT",
  );
  const top = credible[0] ?? scores[0] ?? null;
  const tied = top
    ? credible.filter((score) => top.totalScore - score.totalScore <= 3).slice(0, 3)
    : [];
  return { scores, selected: tied.length > 1 ? null : top, tied };
}

export function candidateChoicesFromScores<T extends {
  productId: string;
  totalScore: number;
  qualificationBand: string;
  exclusions: string[];
}>(scores: T[]) {
  const latestByProduct = new Map<string, T>();
  for (const score of scores) {
    if (!latestByProduct.has(score.productId)) {
      latestByProduct.set(score.productId, score);
    }
  }
  const eligible = [...latestByProduct.values()]
    .filter(
      (score) =>
        score.exclusions.length === 0 &&
        score.qualificationBand !== "INSUFFICIENT",
    )
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore ||
        left.productId.localeCompare(right.productId),
    );
  const top = eligible[0];
  return top
    ? eligible.filter((score) => top.totalScore - score.totalScore <= 3).slice(0, 3)
    : [];
}

export const AUTHORIZED_AUTOPILOT_TRANSITIONS: Record<
  AutopilotPlanState,
  AutopilotPlanState[]
> = {
  PREPARING: ["READY_FOR_APPROVAL", "INVALIDATED"],
  READY_FOR_APPROVAL: ["APPROVED", "INVALIDATED"],
  APPROVED: ["WAITING_FOR_THEME", "PAUSED", "INVALIDATED"],
  WAITING_FOR_THEME: ["VERIFYING", "PAUSED", "INVALIDATED"],
  VERIFYING: ["AA_RUNNING", "WAITING_FOR_THEME", "PAUSED", "INVALIDATED"],
  AA_RUNNING: ["REAL_TEST_RUNNING", "AA_FAILED", "PAUSED", "INVALIDATED"],
  AA_FAILED: ["PAUSED", "INVALIDATED"],
  REAL_TEST_RUNNING: ["RESULT_READY", "PAUSED", "INVALIDATED"],
  PAUSED: ["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING", "INVALIDATED"],
  RESULT_READY: ["PAUSED", "INVALIDATED"],
  INVALIDATED: [],
};

export function canTransitionAutopilot(
  from: AutopilotPlanState,
  to: AutopilotPlanState,
) {
  return AUTHORIZED_AUTOPILOT_TRANSITIONS[from].includes(to);
}

export function autopilotPlanMaterial(input: {
  productId: string;
  candidateScoreSnapshot: unknown;
  contentVersionIds: string[];
  contentHashes: string[];
  evidenceSnapshotHash: string;
  mappingVersions: unknown[];
  unknownTrafficPolicy: string;
  aaProtocol: unknown;
  realExperimentProtocol: unknown;
  safetyPolicyVersion: string;
  authorizedTransitions: unknown;
  cutoverReceiptId?: string;
}) {
  return {
    productId: input.productId,
    candidateScoreSnapshot: input.candidateScoreSnapshot,
    contentVersionIds: [...input.contentVersionIds].sort(),
    contentHashes: [...input.contentHashes].sort(),
    evidenceSnapshotHash: input.evidenceSnapshotHash,
    mappingVersions: input.mappingVersions,
    unknownTrafficPolicy: input.unknownTrafficPolicy,
    aaProtocol: input.aaProtocol,
    realExperimentProtocol: input.realExperimentProtocol,
    safetyPolicyVersion: input.safetyPolicyVersion,
    authorizedTransitions: input.authorizedTransitions,
    ...(input.cutoverReceiptId
      ? { cutoverReceiptId: input.cutoverReceiptId }
      : {}),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function autopilotHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function durationBandLabel(durationBand: DurationBand) {
  return {
    UNDER_14_DAYS: "under 14 days",
    DAYS_14_TO_30: "14–30 days",
    OVER_30_DAYS: "more than 30 days",
    NOT_ENOUGH_DATA: "not enough data yet",
  }[durationBand];
}

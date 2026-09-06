export type AnalysisArm = "ORIGINAL" | "MATCHED";
export type AnalysisResultState =
  | "COLLECTING"
  | "VALIDATED"
  | "FAILED_VALIDATION"
  | "POSITIVE"
  | "NEGATIVE"
  | "INCONCLUSIVE"
  | "INVALID";

export type AnalysisRegistration = {
  hypothesis: string;
  revenueDefinition: "GROSS" | "NET";
  minimumMeaningfulLift: number;
  alpha: number;
  targetSampleSize: number;
  minimumDurationDays: number;
  maximumDurationDays: number;
  dataMaturityLagDays: number;
};

export type ExperimentAnalysisInput = {
  testType: "AA" | "AB";
  startedAt: Date;
  endedAt: Date | null;
  now: Date;
  healthReadiness: "READY" | "COLLECTING" | "HOLD";
  registration: AnalysisRegistration;
  assignments: Array<{ id: string; arm: AnalysisArm }>;
  decisions: Array<{
    id: string;
    assignmentId: string | null;
    sessionId: string;
  }>;
  orders: Array<{
    assignmentId: string;
    decisionId: string;
    grossAmount: number;
    netAmount: number;
    currencyCode: string;
    cancelled: boolean;
  }>;
};

export type ArmAnalysis = {
  assignments: number;
  sessions: number;
  orders: number;
  purchasers: number;
  revenue: number;
  revenuePerSession: number;
  conversionRate: number;
  averageOrderValue: number;
  clusterVariance: number;
};

export type ExperimentAnalysis = {
  resultState: AnalysisResultState;
  maturity: "PRELIMINARY" | "MATURE";
  currencyCode: string | null;
  control: ArmAnalysis;
  treatment: ArmAnalysis;
  absoluteLift: number;
  relativeLift: number | null;
  standardError: number;
  confidenceLevel: number;
  interval: { lower: number; upper: number };
  sampleTargetMet: boolean;
  durationMet: boolean;
  durationDays: number;
  dataMaturityAt: Date;
  reasons: string[];
};

function inverseNormalCdf(probability: number) {
  if (probability <= 0 || probability >= 1)
    throw new Error("Probability must be between zero and one.");
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269,
    -30.6647980661472, 2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197,
    -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878,
  ];
  const d = [
    0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

function emptyArm(): ArmAnalysis {
  return {
    assignments: 0,
    sessions: 0,
    orders: 0,
    purchasers: 0,
    revenue: 0,
    revenuePerSession: 0,
    conversionRate: 0,
    averageOrderValue: 0,
    clusterVariance: 0,
  };
}

export function analyzeExperiment(
  input: ExperimentAnalysisInput,
): ExperimentAnalysis {
  const assignmentById = new Map(
    input.assignments.map((item) => [item.id, item]),
  );
  const clusters = new Map<
    string,
    { arm: AnalysisArm; sessions: Set<string>; revenue: number; orders: number }
  >();
  for (const assignment of input.assignments) {
    clusters.set(assignment.id, {
      arm: assignment.arm,
      sessions: new Set(),
      revenue: 0,
      orders: 0,
    });
  }
  const decisionById = new Map(
    input.decisions.map((decision) => [decision.id, decision]),
  );
  for (const decision of input.decisions) {
    if (!decision.assignmentId) continue;
    clusters.get(decision.assignmentId)?.sessions.add(decision.sessionId);
  }
  const currencies = new Set<string>();
  const purchasers = new Map<AnalysisArm, Set<string>>([
    ["ORIGINAL", new Set()],
    ["MATCHED", new Set()],
  ]);
  for (const order of input.orders) {
    const assignment = assignmentById.get(order.assignmentId);
    const decision = decisionById.get(order.decisionId);
    const cluster = assignment ? clusters.get(assignment.id) : null;
    if (!assignment || !decision || !cluster || order.cancelled) continue;
    currencies.add(order.currencyCode);
    const revenue =
      input.registration.revenueDefinition === "GROSS"
        ? order.grossAmount
        : order.netAmount;
    cluster.revenue += revenue;
    cluster.orders += 1;
    purchasers.get(assignment.arm)?.add(assignment.id);
  }

  const buildArm = (arm: AnalysisArm) => {
    const selected = [...clusters.values()].filter(
      (cluster) => cluster.arm === arm,
    );
    const sessions = selected.reduce(
      (sum, cluster) => sum + cluster.sessions.size,
      0,
    );
    const revenue = selected.reduce((sum, cluster) => sum + cluster.revenue, 0);
    const orders = selected.reduce((sum, cluster) => sum + cluster.orders, 0);
    const revenuePerSession = sessions ? revenue / sessions : 0;
    const residualSquares = selected.reduce((sum, cluster) => {
      const residual =
        cluster.revenue - revenuePerSession * cluster.sessions.size;
      return sum + residual * residual;
    }, 0);
    const clusterVariance =
      selected.length > 1 && sessions
        ? ((selected.length / (selected.length - 1)) * residualSquares) /
          (sessions * sessions)
        : 0;
    return {
      ...emptyArm(),
      assignments: selected.length,
      sessions,
      orders,
      purchasers: purchasers.get(arm)?.size ?? 0,
      revenue,
      revenuePerSession,
      conversionRate: sessions
        ? (purchasers.get(arm)?.size ?? 0) / sessions
        : 0,
      averageOrderValue: orders ? revenue / orders : 0,
      clusterVariance,
    };
  };

  const control = buildArm("ORIGINAL");
  const treatment = buildArm("MATCHED");
  const absoluteLift = treatment.revenuePerSession - control.revenuePerSession;
  const relativeLift =
    control.revenuePerSession > 0
      ? absoluteLift / control.revenuePerSession
      : null;
  const standardError = Math.sqrt(
    control.clusterVariance + treatment.clusterVariance,
  );
  const critical = inverseNormalCdf(1 - input.registration.alpha / 2);
  const interval = {
    lower: absoluteLift - critical * standardError,
    upper: absoluteLift + critical * standardError,
  };
  const durationDays = Math.max(
    0,
    (input.now.getTime() - input.startedAt.getTime()) / 86_400_000,
  );
  const totalSessions = control.sessions + treatment.sessions;
  const sampleTargetMet = totalSessions >= input.registration.targetSampleSize;
  const durationMet = durationDays >= input.registration.minimumDurationDays;
  const maturityBase =
    input.endedAt ??
    new Date(
      input.startedAt.getTime() +
        input.registration.minimumDurationDays * 86_400_000,
    );
  const dataMaturityAt = new Date(
    maturityBase.getTime() +
      input.registration.dataMaturityLagDays * 86_400_000,
  );
  const mature = sampleTargetMet && durationMet && input.now >= dataMaturityAt;
  const reasons: string[] = [];
  if (input.healthReadiness === "HOLD")
    reasons.push("A material data-quality check is failing.");
  if (!sampleTargetMet)
    reasons.push(
      `${totalSessions} of ${input.registration.targetSampleSize} eligible sessions collected.`,
    );
  if (!durationMet)
    reasons.push(
      `${durationDays.toFixed(1)} of ${input.registration.minimumDurationDays} minimum days elapsed.`,
    );
  if (currencies.size > 1)
    reasons.push(
      "Attributed revenue contains multiple currencies without normalization.",
    );
  if (!control.sessions || !treatment.sessions)
    reasons.push("Both logical arms need eligible sessions.");

  let resultState: AnalysisResultState = "COLLECTING";
  if (input.healthReadiness === "HOLD" || currencies.size > 1) {
    resultState = "INVALID";
  } else if (mature) {
    if (input.testType === "AA") {
      const materialDifference =
        relativeLift != null &&
        Math.abs(relativeLift) >= input.registration.minimumMeaningfulLift &&
        (interval.lower > 0 || interval.upper < 0);
      resultState = materialDifference ? "FAILED_VALIDATION" : "VALIDATED";
    } else if (
      interval.lower > 0 &&
      relativeLift != null &&
      relativeLift >= input.registration.minimumMeaningfulLift
    ) {
      resultState = "POSITIVE";
    } else if (interval.upper < 0) {
      resultState = "NEGATIVE";
    } else {
      resultState = "INCONCLUSIVE";
    }
  }

  return {
    resultState,
    maturity: mature ? "MATURE" : "PRELIMINARY",
    currencyCode: currencies.size === 1 ? [...currencies][0] : null,
    control,
    treatment,
    absoluteLift,
    relativeLift,
    standardError,
    confidenceLevel: 1 - input.registration.alpha,
    interval,
    sampleTargetMet,
    durationMet,
    durationDays,
    dataMaturityAt,
    reasons,
  };
}

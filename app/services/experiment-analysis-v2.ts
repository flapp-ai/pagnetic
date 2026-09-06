export type V2ExperimentArm = "ORIGINAL" | "MATCHED";
export type V2AnalysisState =
  | "COLLECTING"
  | "MATURING"
  | "INTERRUPTED"
  | "INVALID"
  | "INSUFFICIENT_EVIDENCE"
  | "MEASUREMENT_CHECKS_PASSED"
  | "FAILED_VALIDATION"
  | "POSITIVE"
  | "NEGATIVE"
  | "INCONCLUSIVE";

export type V2AnalysisInput = {
  testType: "AA" | "AB";
  now: Date;
  enrollmentStartedAt: Date;
  enrollmentClosedAt: Date | null;
  financialMaturityAt: Date | null;
  stopReason: string | null;
  healthState: "READY" | "INSUFFICIENT" | "INVALID";
  financialComplete: boolean;
  targetVisitors: number;
  minimumPaidOrders: number;
  minimumWorthwhileRelativeEffect: number;
  alpha: number;
  currencyCode: string;
  assignments: Array<{ id: string; arm: V2ExperimentArm }>;
  outcomes: Array<{
    assignmentId: string;
    netFocalRevenueMinor: string;
    paidOrders: number;
  }>;
};

export type V2ArmAnalysis = {
  assignments: number;
  paidPurchasers: number;
  paidOrders: number;
  netRevenueMinor: string;
  meanMinor: number;
  varianceMinorSquared: number;
  purchaserRate: number;
};

const LANCZOS = [
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function logGamma(value: number): number {
  if (value < 0.5)
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.99999999999980993;
  const z = value - 1;
  for (let index = 0; index < LANCZOS.length; index += 1)
    x += LANCZOS[index]! / (z + index + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaFraction(x: number, a: number, b: number) {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const floor = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let result = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const even = 2 * iteration;
    let coefficient = (iteration * (b - iteration) * x) /
      ((qam + even) * (a + even));
    d = 1 + coefficient * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + coefficient / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    result *= d * c;
    coefficient = -((a + iteration) * (qab + iteration) * x) /
      ((a + even) * (qap + even));
    d = 1 + coefficient * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + coefficient / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < epsilon) return result;
  }
  throw new Error("STUDENT_T_NUMERIC_CONVERGENCE_FAILED");
}

function regularizedIncompleteBeta(x: number, a: number, b: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (factor * betaFraction(x, a, b)) / a
    : 1 - (factor * betaFraction(1 - x, b, a)) / b;
}

export function studentTCdf(value: number, degreesOfFreedom: number) {
  if (!Number.isFinite(value) || !Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 0)
    throw new Error("STUDENT_T_INPUT_INVALID");
  if (value === 0) return 0.5;
  const x = degreesOfFreedom / (degreesOfFreedom + value * value);
  const tail = regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5) / 2;
  return value > 0 ? 1 - tail : tail;
}

export function studentTQuantile(
  probability: number,
  degreesOfFreedom: number,
): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1)
    throw new Error("STUDENT_T_PROBABILITY_INVALID");
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 0)
    throw new Error("STUDENT_T_INPUT_INVALID");
  if (probability === 0.5) return 0;
  if (probability < 0.5)
    return -studentTQuantile(1 - probability, degreesOfFreedom);
  let low = 0;
  let high = 1;
  while (studentTCdf(high, degreesOfFreedom) < probability) {
    high *= 2;
    if (high > 1e6) throw new Error("STUDENT_T_QUANTILE_UNBOUNDED");
  }
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    if (studentTCdf(middle, degreesOfFreedom) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function exactMinor(value: string) {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value))
    throw new Error("ANALYSIS_MONEY_INVALID");
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Error("ANALYSIS_MONEY_UNSAFE");
  return Number(parsed);
}

function armAnalysis(values: Array<{ revenue: number; paidOrders: number }>): V2ArmAnalysis {
  const count = values.length;
  const exactTotal = values.reduce(
    (sum, value) => sum + BigInt(value.revenue),
    0n,
  );
  if (
    exactTotal > BigInt(Number.MAX_SAFE_INTEGER) ||
    exactTotal < BigInt(Number.MIN_SAFE_INTEGER)
  ) throw new Error("ANALYSIS_TOTAL_UNSAFE");
  const total = Number(exactTotal);
  const mean = count ? total / count : 0;
  const variance = count > 1
    ? values.reduce((sum, value) => sum + (value.revenue - mean) ** 2, 0) /
      (count - 1)
    : 0;
  const paidPurchasers = values.filter((value) => value.paidOrders > 0).length;
  return {
    assignments: count,
    paidPurchasers,
    paidOrders: values.reduce((sum, value) => sum + value.paidOrders, 0),
    netRevenueMinor: exactTotal.toString(),
    meanMinor: mean,
    varianceMinorSquared: variance,
    purchaserRate: count ? paidPurchasers / count : 0,
  };
}

export function analyzeV2Experiment(input: V2AnalysisInput) {
  if (!Number.isFinite(input.alpha) || input.alpha <= 0 || input.alpha >= 1)
    throw new Error("ANALYSIS_ALPHA_INVALID");
  if (
    !Number.isSafeInteger(input.targetVisitors) || input.targetVisitors < 1 ||
    !Number.isSafeInteger(input.minimumPaidOrders) || input.minimumPaidOrders < 0 ||
    !Number.isFinite(input.minimumWorthwhileRelativeEffect) || input.minimumWorthwhileRelativeEffect <= 0 ||
    !["USD", "EUR", "GBP", "TRY", "ILS", "UNKNOWN"].includes(input.currencyCode) ||
    !["AA", "AB"].includes(input.testType) ||
    !["READY", "INSUFFICIENT", "INVALID"].includes(input.healthState) ||
    [input.now, input.enrollmentStartedAt, input.enrollmentClosedAt, input.financialMaturityAt]
      .some((date) => date != null && !Number.isFinite(date.getTime())) ||
    (input.enrollmentClosedAt != null && input.enrollmentClosedAt < input.enrollmentStartedAt) ||
    input.assignments.some((assignment) => !assignment.id || !["ORIGINAL", "MATCHED"].includes(assignment.arm)) ||
    input.outcomes.some((outcome) => !Number.isSafeInteger(outcome.paidOrders) || outcome.paidOrders < 0)
  ) throw new Error("ANALYSIS_INPUT_INVALID");
  const assignmentIds = new Set(input.assignments.map((item) => item.id));
  if (assignmentIds.size !== input.assignments.length)
    throw new Error("ANALYSIS_ASSIGNMENT_DUPLICATE");
  const outcomeIds = new Set(input.outcomes.map((item) => item.assignmentId));
  if (
    outcomeIds.size !== input.outcomes.length ||
    input.outcomes.some((outcome) => !assignmentIds.has(outcome.assignmentId))
  ) throw new Error("ANALYSIS_OUTCOME_SCOPE_INVALID");
  const outcomeByAssignment = new Map(
    input.outcomes.map((outcome) => [outcome.assignmentId, outcome]),
  );
  const byArm = new Map<V2ExperimentArm, Array<{ revenue: number; paidOrders: number }>>([
    ["ORIGINAL", []],
    ["MATCHED", []],
  ]);
  for (const assignment of input.assignments) {
    const outcome = outcomeByAssignment.get(assignment.id);
    byArm.get(assignment.arm)!.push({
      revenue: outcome ? exactMinor(outcome.netFocalRevenueMinor) : 0,
      paidOrders: outcome?.paidOrders ?? 0,
    });
  }
  const control = armAnalysis(byArm.get("ORIGINAL")!);
  const treatment = armAnalysis(byArm.get("MATCHED")!);
  const effectMinor = treatment.meanMinor - control.meanMinor;
  const relativeEffect = control.meanMinor > 0 ? effectMinor / control.meanMinor : null;
  const controlTerm = control.assignments > 0
    ? control.varianceMinorSquared / control.assignments
    : 0;
  const treatmentTerm = treatment.assignments > 0
    ? treatment.varianceMinorSquared / treatment.assignments
    : 0;
  const standardErrorMinor = Math.sqrt(controlTerm + treatmentTerm);
  const denominator =
    (control.assignments > 1 ? controlTerm ** 2 / (control.assignments - 1) : 0) +
    (treatment.assignments > 1 ? treatmentTerm ** 2 / (treatment.assignments - 1) : 0);
  const degreesOfFreedom = denominator > 0
    ? (controlTerm + treatmentTerm) ** 2 / denominator
    : 0;
  const critical = degreesOfFreedom > 0
    ? studentTQuantile(1 - input.alpha / 2, degreesOfFreedom)
    : 0;
  const intervalMinor = {
    lower: effectMinor - critical * standardErrorMinor,
    upper: effectMinor + critical * standardErrorMinor,
  };
  const reasons: string[] = [];
  const totalAssignments = input.assignments.length;
  const totalPaidOrders = control.paidOrders + treatment.paidOrders;
  const statisticalInformation =
    control.assignments >= 2 && treatment.assignments >= 2 &&
    control.varianceMinorSquared > 0 && treatment.varianceMinorSquared > 0 &&
    standardErrorMinor > 0 && Number.isFinite(standardErrorMinor);
  if (!statisticalInformation) reasons.push("INSUFFICIENT_STATISTICAL_INFORMATION");
  if (totalAssignments < input.targetVisitors) reasons.push("TARGET_VISITORS_NOT_REACHED");
  if (totalPaidOrders < input.minimumPaidOrders) reasons.push("PAID_ORDER_FLOOR_NOT_REACHED");
  if (input.healthState === "INSUFFICIENT") reasons.push("INSUFFICIENT_HEALTH_EVIDENCE");
  if (!input.financialComplete) reasons.push("FINANCIAL_RECONCILIATION_INCOMPLETE");

  let resultState: V2AnalysisState;
  if (input.stopReason && input.stopReason !== "MAX_DURATION_UNDER_TARGET")
    resultState =
      input.enrollmentClosedAt && input.financialMaturityAt &&
      input.now >= input.financialMaturityAt && input.financialComplete
        ? "INTERRUPTED"
        : "MATURING";
  else if (input.healthState === "INVALID") resultState = "INVALID";
  else if (!input.enrollmentClosedAt) resultState = "COLLECTING";
  else if (!input.financialMaturityAt || input.now < input.financialMaturityAt || !input.financialComplete)
    resultState = "MATURING";
  else if (
    totalAssignments < input.targetVisitors || totalPaidOrders < input.minimumPaidOrders ||
    input.healthState !== "READY" || !statisticalInformation
  ) resultState = "INSUFFICIENT_EVIDENCE";
  else if (input.testType === "AA") {
    const materialDiagnosticDifference = relativeEffect != null &&
      Math.abs(relativeEffect) >= input.minimumWorthwhileRelativeEffect &&
      (intervalMinor.lower > 0 || intervalMinor.upper < 0);
    resultState = materialDiagnosticDifference
      ? "FAILED_VALIDATION"
      : "MEASUREMENT_CHECKS_PASSED";
  } else if (
    intervalMinor.lower > 0 && relativeEffect != null &&
    relativeEffect >= input.minimumWorthwhileRelativeEffect
  ) resultState = "POSITIVE";
  else if (intervalMinor.upper < 0) resultState = "NEGATIVE";
  else {
    resultState = "INCONCLUSIVE";
    if (
      intervalMinor.lower > 0 && relativeEffect != null &&
      relativeEffect < input.minimumWorthwhileRelativeEffect
    ) reasons.push("BELOW_ECONOMIC_THRESHOLD");
  }

  return {
    resultState,
    currencyCode: input.currencyCode,
    control,
    treatment,
    effectMinor,
    relativeEffect,
    standardErrorMinor,
    degreesOfFreedom,
    confidenceLevel: 1 - input.alpha,
    intervalMinor,
    estimatedAdditionalSalesMinor: (() => {
      const estimate = Math.round(effectMinor * treatment.assignments);
      if (!Number.isSafeInteger(estimate)) throw new Error("ANALYSIS_ESTIMATE_UNSAFE");
      return estimate.toString();
    })(),
    reasons,
  };
}

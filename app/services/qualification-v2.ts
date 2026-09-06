import { createHash } from "node:crypto";

import { canonicalQueuePayload } from "./job-outbox.server";
import { forecastQualificationHealth } from "./qualification-health-forecast";

const DAY_MS = 86_400_000;
const BASELINE_MIN_DAYS = 7;
const BASELINE_MIN_VISITORS = 2_000;
const BASELINE_MIN_PURCHASERS = 50;
const DEFAULT_SIMULATIONS = 2_000;
const MAX_BOOTSTRAP_PER_ARM = 5_000_000;
const MAX_POWER_ATTEMPTS = 7;
export const QUALIFICATION_V2_VERSION = "pagnetic-qualification-v2.3";

type SeededRandom = () => number;

function inverseNormalCdf(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1)
    throw new Error("QUALIFICATION_PROBABILITY_INVALID");
  const a = [
    -39.6968302866538, 220.946098424521, -275.928510446969,
    138.357751867269, -30.6647980661472, 2.50662827745924,
  ];
  const b = [
    -54.4760987982241, 161.585836858041, -155.698979859887,
    66.8013118877197, -13.2806815528857,
  ];
  const c = [
    -0.00778489400243029, -0.322396458041136, -2.40075827716184,
    -2.54973253934373, 4.37466414146497, 2.93816398269878,
  ];
  const d = [
    0.00778469570904146, 0.32246712907004, 2.445134137143,
    3.75440866190742,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (probability > high) return -inverseNormalCdf(1 - probability);
  const q = probability - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function mulberry32(seed: number): SeededRandom {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function exactMinor(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("QUALIFICATION_OUTCOME_INVALID");
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("QUALIFICATION_OUTCOME_UNSAFE");
  return Number(parsed);
}

function meanVariance(values: number[]) {
  if (values.length === 0) return { mean: 0, variance: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1)
    : 0;
  return { mean, variance };
}

function normalSample(random: SeededRandom) {
  const first = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
}

function poissonSample(rate: number, random: SeededRandom) {
  if (rate <= 0) return 0;
  if (rate >= 30)
    return Math.max(0, Math.round(rate + Math.sqrt(rate) * normalSample(random)));
  const limit = Math.exp(-rate);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit);
  return count - 1;
}

function bootstrapPower(args: {
  values: number[];
  samplePerArm: number;
  relativeEffect: number;
  alpha: number;
  simulations: number;
  random: SeededRandom;
}) {
  const critical = inverseNormalCdf(1 - args.alpha / 2);
  const bootstrapRate = args.samplePerArm / args.values.length;
  let positive = 0;
  for (let simulation = 0; simulation < args.simulations; simulation += 1) {
    let controlSum = 0;
    let controlSquares = 0;
    let controlCount = 0;
    let treatmentSum = 0;
    let treatmentSquares = 0;
    let treatmentCount = 0;
    for (const value of args.values) {
      const controlWeight = poissonSample(bootstrapRate, args.random);
      const treatmentWeight = poissonSample(bootstrapRate, args.random);
      const treatmentValue = value * (1 + args.relativeEffect);
      controlCount += controlWeight;
      treatmentCount += treatmentWeight;
      controlSum += controlWeight * value;
      controlSquares += controlWeight * value * value;
      treatmentSum += treatmentWeight * treatmentValue;
      treatmentSquares += treatmentWeight * treatmentValue * treatmentValue;
    }
    if (controlCount < 2 || treatmentCount < 2) continue;
    const controlMean = controlSum / controlCount;
    const treatmentMean = treatmentSum / treatmentCount;
    const controlVariance = controlCount > 1
      ? (controlSquares - controlCount * controlMean ** 2) /
        (controlCount - 1)
      : 0;
    const treatmentVariance = treatmentCount > 1
      ? (treatmentSquares - treatmentCount * treatmentMean ** 2) /
        (treatmentCount - 1)
      : 0;
    const standardError = Math.sqrt(
      Math.max(0, controlVariance) / controlCount +
        Math.max(0, treatmentVariance) / treatmentCount,
    );
    if (
      standardError > 0 &&
      treatmentMean - controlMean - critical * standardError > 0
    ) positive += 1;
  }
  return positive / args.simulations;
}

// A point estimate at 80% is not evidence of >=80% power. Account for Monte
// Carlo uncertainty, with a Bonferroni adjustment for at most seven targets.
export function conservativePowerLowerBound(rate: number, simulations: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1 || !Number.isSafeInteger(simulations) || simulations < 1)
    throw new Error("QUALIFICATION_POWER_INPUT_INVALID");
  const z = inverseNormalCdf(1 - .05 / MAX_POWER_ATTEMPTS);
  const z2 = z * z;
  return (rate + z2 / (2 * simulations) - z * Math.sqrt(
    rate * (1 - rate) / simulations + z2 / (4 * simulations ** 2),
  )) / (1 + z2 / simulations);
}

export type QualificationV2Input = {
  observationStart: Date;
  observationEnd: Date;
  dataSource: string;
  eligibleVisitors: number;
  eligibleSessions: number;
  paidPurchasers: number;
  visitorRevenueMinor: string[];
  dailyEligibleVisitors: number[];
  /** Count first observable checkout visitors by their first eligible cohort day. */
  dailyObservableCheckoutVisitors?: number[];
  /** Last verified source coverage; must cover seven days after baseline closes. */
  outcomesObservedThrough?: Date;
  currencyCode: string;
  coverage: number;
  targetEffect: number;
  alpha?: number;
  desiredPower?: number;
  minimumEnrollmentDays?: number;
  maximumEnrollmentDays?: number;
  instrumentationValidationDays?: number;
  attributionDays?: number;
  financialReviewDays?: number;
  bootstrapSeed?: number;
  simulations?: number;
  restrictionsApplied?: string[];
};

export function evaluateQualificationV2(input: QualificationV2Input) {
  const alpha = input.alpha ?? 0.05;
  const desiredPower = input.desiredPower ?? 0.8;
  const minimumEnrollmentDays = input.minimumEnrollmentDays ?? 14;
  const maximumEnrollmentDays = input.maximumEnrollmentDays ?? 42;
  const instrumentationValidationDays = input.instrumentationValidationDays ?? 21;
  const attributionDays = input.attributionDays ?? 7;
  const financialReviewDays = input.financialReviewDays ?? 7;
  const bootstrapSeed = input.bootstrapSeed ?? 20_260_905;
  const simulations = input.simulations ?? DEFAULT_SIMULATIONS;
  const observedDays =
    (input.observationEnd.getTime() - input.observationStart.getTime()) / DAY_MS;
  if (
    [input.coverage, input.targetEffect, alpha, desiredPower,
      minimumEnrollmentDays, maximumEnrollmentDays, instrumentationValidationDays,
      attributionDays, financialReviewDays, bootstrapSeed].some((value) => !Number.isFinite(value)) ||
    !Number.isSafeInteger(bootstrapSeed) || bootstrapSeed < 0 || bootstrapSeed > 0xffff_ffff ||
    !["USD", "EUR", "GBP", "TRY", "ILS"].includes(input.currencyCode) ||
    observedDays < 0 || !Number.isInteger(observedDays) ||
    input.dailyEligibleVisitors.length !== observedDays ||
    !Number.isInteger(input.eligibleVisitors) ||
    input.eligibleVisitors < 0 || input.visitorRevenueMinor.length !== input.eligibleVisitors ||
    !Number.isInteger(input.eligibleSessions) || input.eligibleSessions < 0 ||
    input.eligibleSessions < input.eligibleVisitors ||
    !Number.isInteger(input.paidPurchasers) || input.paidPurchasers < 0 ||
    input.paidPurchasers > input.eligibleVisitors ||
    input.dailyEligibleVisitors.some((value) => !Number.isInteger(value) || value < 0) ||
    input.dailyEligibleVisitors.reduce((sum, value) => sum+value, 0) !== input.eligibleVisitors ||
    (input.outcomesObservedThrough != null && !Number.isFinite(input.outcomesObservedThrough.getTime())) ||
    input.coverage < 0 || input.coverage > 1 || input.targetEffect <= 0 ||
    alpha <= 0 || alpha > .05 || desiredPower < .8 || desiredPower >= 1 ||
    !Number.isSafeInteger(minimumEnrollmentDays) || !Number.isSafeInteger(maximumEnrollmentDays) ||
    minimumEnrollmentDays < 14 || maximumEnrollmentDays > 42 || maximumEnrollmentDays < minimumEnrollmentDays ||
    instrumentationValidationDays < 0 || attributionDays !== 7 ||
    financialReviewDays !== 7 ||
    !Number.isInteger(simulations) || simulations < DEFAULT_SIMULATIONS || simulations > 100_000
  ) throw new Error("QUALIFICATION_INPUT_INVALID");
  const values = input.visitorRevenueMinor.map(exactMinor);
  const { mean, variance } = meanVariance(values);
  const reasons: string[] = [];
  if (observedDays < BASELINE_MIN_DAYS) reasons.push("BASELINE_DAYS_BELOW_FLOOR");
  if (input.eligibleVisitors < BASELINE_MIN_VISITORS)
    reasons.push("BASELINE_VISITORS_BELOW_FLOOR");
  if (input.paidPurchasers < BASELINE_MIN_PURCHASERS)
    reasons.push("BASELINE_PURCHASERS_BELOW_FLOOR");
  if (input.coverage < 0.95) reasons.push("BASELINE_COVERAGE_BELOW_GATE");
  if (!input.outcomesObservedThrough || input.outcomesObservedThrough.getTime() < input.observationEnd.getTime()+7*DAY_MS)
    reasons.push("BASELINE_OUTCOME_MATURITY_UNVERIFIED");
  if (mean <= 0 || !Number.isFinite(variance) || variance <= 0)
    reasons.push("BASELINE_VARIANCE_UNUSABLE");
  const belowBaselineFloor = reasons.length > 0;
  let analyticPerArm: number | null = null;
  let simulationPerArm: number | null = null;
  let simulatedPower: number | null = null;
  let simulatedPowerLowerBound: number | null = null;
  let targetVisitors: number | null = null;
  if (!belowBaselineFloor) {
    const delta = mean * input.targetEffect;
    const zAlpha = inverseNormalCdf(1 - alpha / 2);
    const zPower = inverseNormalCdf(desiredPower);
    analyticPerArm = Math.ceil(
      (2 * (zAlpha + zPower) ** 2 * variance) / delta ** 2,
    );
    if (analyticPerArm > MAX_BOOTSTRAP_PER_ARM) {
      reasons.push("BOOTSTRAP_TARGET_EXCEEDS_SUPPORTED_BOUND");
    } else {
      const random = mulberry32(bootstrapSeed);
      simulationPerArm = Math.max(2, analyticPerArm);
      for (let attempt = 0; attempt < MAX_POWER_ATTEMPTS; attempt += 1) {
        simulatedPower = bootstrapPower({
          values,
          samplePerArm: simulationPerArm,
          relativeEffect: input.targetEffect,
          alpha,
          simulations,
          random,
        });
        simulatedPowerLowerBound = conservativePowerLowerBound(simulatedPower, simulations);
        if (simulatedPowerLowerBound >= desiredPower) break;
        if (attempt === MAX_POWER_ATTEMPTS - 1) break;
        simulationPerArm = Math.ceil(simulationPerArm * 1.25);
        if (simulationPerArm > MAX_BOOTSTRAP_PER_ARM) {
          reasons.push("BOOTSTRAP_TARGET_EXCEEDS_SUPPORTED_BOUND");
          break;
        }
      }
      if (simulatedPowerLowerBound != null && simulatedPowerLowerBound < desiredPower)
        reasons.push("BOOTSTRAP_POWER_BELOW_TARGET");
      targetVisitors = 2 * Math.max(analyticPerArm, simulationPerArm);
    }
  }
  const healthForecast = forecastQualificationHealth({
    dailyEligibleVisitors: input.dailyEligibleVisitors,
    dailyObservableCheckoutVisitors: input.dailyObservableCheckoutVisitors,
    statisticalTargetVisitors: targetVisitors, minimumEnrollmentDays,
  });
  reasons.push(...healthForecast.reasons);
  const { enrollmentLowDays, enrollmentHighDays } = healthForecast;
  // Instrumentation includes A/A enrollment plus its own attribution/review.
  // Never let a caller's shorter trial erase either stage's maturity windows.
  const validationLowDays = healthForecast.validationLowDays == null ? null
    : Math.max(instrumentationValidationDays, healthForecast.validationLowDays + attributionDays + financialReviewDays);
  const validationHighDays = healthForecast.validationHighDays == null ? null
    : Math.max(instrumentationValidationDays, healthForecast.validationHighDays + attributionDays + financialReviewDays);
  const forecastLowDays = enrollmentLowDays == null || validationLowDays == null
    ? null
    : enrollmentLowDays + validationLowDays + attributionDays + financialReviewDays;
  const forecastHighDays = enrollmentHighDays == null || validationHighDays == null
    ? null
    : enrollmentHighDays + validationHighDays + attributionDays + financialReviewDays;
  if (
    targetVisitors &&
    (enrollmentHighDays == null || enrollmentHighDays > maximumEnrollmentDays)
  ) reasons.push("MAXIMUM_ENROLLMENT_DURATION_EXCEEDED");
  const status = belowBaselineFloor
    ? "BASELINE_REQUIRED"
    : reasons.length > 0
      ? "PREVIEW_ONLY"
      : "QUALIFIED";
  const outcomeDistributionHash = createHash("sha256")
    .update(canonicalQueuePayload([...input.visitorRevenueMinor].sort()))
    .digest("hex");
  const canonicalPayload = canonicalQueuePayload({
    version: QUALIFICATION_V2_VERSION,
    observationStart: input.observationStart.toISOString(),
    observationEnd: input.observationEnd.toISOString(),
    dataSource: input.dataSource,
    effectiveSample: input.eligibleVisitors,
    outcomeDistributionHash,
    eligibleSessions: input.eligibleSessions,
    dailyEligibleVisitors: input.dailyEligibleVisitors,
    dailyObservableCheckoutVisitors: input.dailyObservableCheckoutVisitors ?? null,
    outcomesObservedThrough: input.outcomesObservedThrough?.toISOString() ?? null,
    healthForecast,
    paidPurchasers: input.paidPurchasers,
    currencyCode: input.currencyCode,
    coverage: input.coverage,
    targetEffect: input.targetEffect,
    alpha,
    desiredPower,
    minimumEnrollmentDays,
    maximumEnrollmentDays,
    instrumentationValidationDays,
    attributionDays,
    financialReviewDays,
    analyticPerArm,
    simulationPerArm,
    simulatedPower,
    simulatedPowerLowerBound,
    powerMethod: "poisson-visitor-bootstrap-normal-test-bonferroni-wilson-v2",
    bootstrapSeed,
    simulations,
    targetVisitors,
    enrollmentLowDays,
    enrollmentHighDays,
    forecastLowDays,
    forecastHighDays,
    reasons,
    restrictionsApplied: input.restrictionsApplied ?? [],
  });
  return {
    status,
    reasons,
    observedDays,
    revenueMeanMinor: mean.toString(),
    revenueVariance: variance,
    targetVisitors,
    forecastLowDays,
    forecastHighDays,
    analyticPerArm,
    healthForecast,
    simulationPerArm,
    simulatedPower,
    simulatedPowerLowerBound,
    bootstrapSeed,
    simulations,
    canonicalPayload,
    snapshotHash: createHash("sha256").update(canonicalPayload).digest("hex"),
  };
}

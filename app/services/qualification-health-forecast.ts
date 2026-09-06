import { V2_CHECKOUT_ARM_FLOOR } from "./experiment-health-v2";

export const QUALIFICATION_HEALTH_FORECAST_VERSION = "checkout-visitor-planning-v1";
// One first observable checkout per visitor, not repeated orders or sessions.
// Conditional on independent visitor assignment and unchanged capture, the
// two-sided Hoeffding bound for fewer than 100 of 250 in either arm is <1.4%.
export const CHECKOUT_VISITOR_PLANNING_TARGET = 250;

function dailyBand(values: number[]) {
  if (values.length === 0) return { low: 0, high: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value-mean)**2, 0) / (values.length-1) : 0;
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { low: Math.max(0, mean-margin), high: mean+margin };
}

export function forecastQualificationHealth(args: {
  dailyEligibleVisitors: number[];
  dailyObservableCheckoutVisitors?: number[];
  statisticalTargetVisitors: number | null;
  minimumEnrollmentDays: number;
}) {
  if (!Number.isSafeInteger(args.minimumEnrollmentDays) || args.minimumEnrollmentDays < 1 ||
    (args.statisticalTargetVisitors != null && (!Number.isSafeInteger(args.statisticalTargetVisitors) || args.statisticalTargetVisitors < 1)) ||
    args.dailyEligibleVisitors.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("QUALIFICATION_HEALTH_FORECAST_INVALID");
  const visitorRates = dailyBand(args.dailyEligibleVisitors);
  const values = args.dailyObservableCheckoutVisitors;
  if (values && (values.length !== args.dailyEligibleVisitors.length || values.some((value, index) =>
    !Number.isSafeInteger(value) || value < 0 || value > args.dailyEligibleVisitors[index]!)))
    throw new Error("QUALIFICATION_CHECKOUT_RATE_INVALID");
  const checkoutRates = values ? dailyBand(values) : null;
  const days = (target: number, rate: number) => rate > 0 ? Math.ceil(target / rate) : null;
  function duration(visitorTarget: number, minimum: number, band: "low" | "high") {
    const traffic = days(visitorTarget, visitorRates[band]);
    const checkout = checkoutRates ? days(CHECKOUT_VISITOR_PLANNING_TARGET, checkoutRates[band]) : null;
    return traffic == null || checkout == null ? null : Math.max(minimum, traffic, checkout);
  }
  const validationLowDays = duration(1_000, 7, "high");
  const validationHighDays = duration(1_000, 7, "low");
  const enrollmentLowDays = args.statisticalTargetVisitors == null ? null
    : duration(args.statisticalTargetVisitors, args.minimumEnrollmentDays, "high");
  const enrollmentHighDays = args.statisticalTargetVisitors == null ? null
    : duration(args.statisticalTargetVisitors, args.minimumEnrollmentDays, "low");
  const reasons: string[] = [];
  if (!checkoutRates) reasons.push("CHECKOUT_VISITOR_RATE_UNOBSERVED");
  else if (checkoutRates.low <= 0) reasons.push("CHECKOUT_VISITOR_RATE_UNCERTAIN");
  else if (validationHighDays == null || validationHighDays > 14)
    reasons.push("VALIDATION_INFORMATION_FLOOR_INFEASIBLE");
  return {
    version: QUALIFICATION_HEALTH_FORECAST_VERSION,
    requiredObservableOutcomesPerArm: V2_CHECKOUT_ARM_FLOOR,
    planningCheckoutVisitors: CHECKOUT_VISITOR_PLANNING_TARGET,
    allocationTailBound: Math.min(1, 2 * Math.exp(-2 *
      (CHECKOUT_VISITOR_PLANNING_TARGET/2-V2_CHECKOUT_ARM_FLOOR)**2 / CHECKOUT_VISITOR_PLANNING_TARGET)),
    visitorRates, checkoutRates, validationLowDays, validationHighDays,
    enrollmentLowDays, enrollmentHighDays, reasons,
    scope: "Conditional planning band, not a prediction interval. First eligible visitor cohorts with mature seven-day observable checkout outcomes; stable traffic/capture and independent visitor allocation assumed. Actual per-arm evidence remains required.",
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { forecastQualificationHealth } from "../app/services/qualification-health-forecast";
import { evaluateQualificationV2 } from "../app/services/qualification-v2";

const rates = {
  dailyEligibleVisitors: [300, 300, 300, 300, 300, 300, 300],
  dailyObservableCheckoutVisitors: [50, 50, 50, 50, 50, 50, 50],
  statisticalTargetVisitors: 1_000, minimumEnrollmentDays: 14,
};
const baseline = {
  observationStart: new Date("2026-09-01Z"), observationEnd: new Date("2026-09-08Z"),
  outcomesObservedThrough: new Date("2026-09-15Z"), dataSource: "SYNTHETIC_ONLY",
  eligibleVisitors: 2_100, eligibleSessions: 2_100, paidPurchasers: 2_100,
  visitorRevenueMinor: Array.from({ length: 2_100 }, (_, index) => index%2 ? "100" : "110"),
  ...rates, currencyCode: "USD", coverage: 1, targetEffect: .05,
};

test("health planning retains seven-day AA floor and explicit per-arm checkout buffer", () => {
  const forecast = forecastQualificationHealth(rates);
  assert.equal(forecast.validationLowDays, 7);
  assert.equal(forecast.enrollmentHighDays, 14);
  assert.equal(forecast.requiredObservableOutcomesPerArm, 100);
  assert.equal(forecast.planningCheckoutVisitors, 250);
  assert.ok(forecast.allocationTailBound < .014);
  assert.deepEqual(forecast.reasons, []);
});

test("checkout rate rather than storefront traffic can delay validation or make it infeasible", () => {
  const delayed = forecastQualificationHealth({ ...rates, dailyObservableCheckoutVisitors: Array(7).fill(20) });
  assert.equal(delayed.validationHighDays, 13);
  assert.deepEqual(delayed.reasons, []);
  const infeasible = forecastQualificationHealth({ ...rates, dailyObservableCheckoutVisitors: Array(7).fill(10) });
  assert.equal(infeasible.validationHighDays, 25);
  assert.ok(infeasible.reasons.includes("VALIDATION_INFORMATION_FLOOR_INFEASIBLE"));
});

test("absent and unstable checkout evidence cannot produce a precise completion forecast", () => {
  const absent = forecastQualificationHealth({ ...rates, dailyObservableCheckoutVisitors: undefined });
  assert.equal(absent.validationHighDays, null);
  assert.equal(absent.enrollmentHighDays, null);
  assert.ok(absent.reasons.includes("CHECKOUT_VISITOR_RATE_UNOBSERVED"));
  const unstable = forecastQualificationHealth({ ...rates, dailyObservableCheckoutVisitors: [0, 0, 0, 0, 0, 0, 100] });
  assert.equal(unstable.validationHighDays, null);
  assert.ok(unstable.reasons.includes("CHECKOUT_VISITOR_RATE_UNCERTAIN"));
  for (const values of [[1], [NaN, 1, 1, 1, 1, 1, 1], Array(7).fill(301)])
    assert.throws(() => forecastQualificationHealth({ ...rates, dailyObservableCheckoutVisitors: values }), /CHECKOUT_RATE_INVALID/);
});

test("qualification requires mature outcomes and does not count returning visitors as new sample", () => {
  assert.ok(evaluateQualificationV2({ ...baseline, outcomesObservedThrough: undefined }).reasons.includes("BASELINE_OUTCOME_MATURITY_UNVERIFIED"));
  assert.equal(evaluateQualificationV2({ ...baseline, outcomesObservedThrough: new Date("2026-09-14Z") }).status, "BASELINE_REQUIRED");
  assert.throws(() => evaluateQualificationV2({ ...baseline, dailyEligibleVisitors: Array(7).fill(301) }), /QUALIFICATION_INPUT_INVALID/);
  for (const patch of [{ minimumEnrollmentDays: 7 }, { maximumEnrollmentDays: 90 },
    { attributionDays: 0 }, { financialReviewDays: 0 }, { desiredPower: .5 }, { alpha: .2 }])
    assert.throws(() => evaluateQualificationV2({ ...baseline, ...patch }), /QUALIFICATION_INPUT_INVALID/);
});

test("integrated qualification extends the full horizon and stays preview-only without checkout evidence", () => {
  assert.equal(evaluateQualificationV2(baseline).forecastLowDays, 49);
  const delayed = evaluateQualificationV2({ ...baseline, dailyObservableCheckoutVisitors: Array(7).fill(20) });
  assert.equal(delayed.status, "QUALIFIED");
  assert.equal(delayed.forecastLowDays, 55);
  const absent = evaluateQualificationV2({ ...baseline, dailyObservableCheckoutVisitors: undefined });
  assert.equal(absent.status, "PREVIEW_ONLY");
  assert.equal(absent.forecastHighDays, null);
  const slow = evaluateQualificationV2({ ...baseline, dailyObservableCheckoutVisitors: Array(7).fill(10) });
  assert.equal(slow.status, "PREVIEW_ONLY");
  assert.equal(slow.forecastHighDays, 78);
});

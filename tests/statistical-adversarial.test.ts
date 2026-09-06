import assert from "node:assert/strict";
import test from "node:test";

import { analyzeV2Experiment, studentTQuantile, type V2AnalysisInput } from "../app/services/experiment-analysis-v2";
import { conservativePowerLowerBound, evaluateQualificationV2 } from "../app/services/qualification-v2";

function fixture(): V2AnalysisInput {
  return {
    testType: "AB", now: new Date("2026-10-20Z"),
    enrollmentStartedAt: new Date("2026-09-01Z"), enrollmentClosedAt: new Date("2026-09-15Z"),
    financialMaturityAt: new Date("2026-09-29Z"), stopReason: null,
    healthState: "READY", financialComplete: true, targetVisitors: 200,
    minimumPaidOrders: 20, minimumWorthwhileRelativeEffect: .2, alpha: .05, currencyCode: "USD",
    assignments: Array.from({ length: 200 }, (_, i) => ({ id: String(i), arm: i < 100 ? "ORIGINAL" : "MATCHED" })),
    outcomes: Array.from({ length: 100 }, (_, i) => ({ assignmentId: String(2*i), netFocalRevenueMinor: i < 50 ? "100" : "200", paidOrders: 1 })),
  };
}

test("Student t rejects NaN and invalid degrees of freedom even at the median", () => {
  for (const probability of [NaN, Infinity, -Infinity, 0, 1])
    assert.throws(() => studentTQuantile(probability, 10), /PROBABILITY_INVALID/);
  for (const df of [NaN, Infinity, -1, 0])
    assert.throws(() => studentTQuantile(.5, df), /INPUT_INVALID/);
});

test("analysis rejects malformed gates, dates, counts, currencies and arm labels", () => {
  for (const patch of [
    { alpha: NaN }, { targetVisitors: NaN }, { minimumPaidOrders: -1 },
    { minimumWorthwhileRelativeEffect: Infinity }, { now: new Date("invalid") },
    { enrollmentClosedAt: new Date("2026-08-31Z") }, { currencyCode: "JPY" },
    { assignments: [{ id: "a", arm: "UNKNOWN" }] },
    { outcomes: [{ assignmentId: "0", netFocalRevenueMinor: "10", paidOrders: Infinity }] },
  ]) assert.throws(() => analyzeV2Experiment({ ...fixture(), ...patch } as V2AnalysisInput), /ANALYSIS_.*INVALID/);
});

test("one arm with zero observed variance cannot validate measurement or win", () => {
  const input = fixture();
  input.outcomes = input.outcomes.filter((outcome) => Number(outcome.assignmentId) >= 100);
  for (const testType of ["AA", "AB"] as const) {
    const result = analyzeV2Experiment({ ...input, testType });
    assert.equal(result.resultState, "INSUFFICIENT_EVIDENCE");
    assert.ok(result.reasons.includes("INSUFFICIENT_STATISTICAL_INFORMATION"));
  }
});

test("financial incompleteness, asymmetric loss and interrupted tests cannot claim a win", () => {
  assert.equal(analyzeV2Experiment(fixture()).resultState, "POSITIVE");
  assert.equal(analyzeV2Experiment({ ...fixture(), financialComplete: false }).resultState, "MATURING");
  assert.equal(analyzeV2Experiment({ ...fixture(), healthState: "INVALID" }).resultState, "INVALID");
  assert.equal(analyzeV2Experiment({ ...fixture(), stopReason: "SAFETY_STOP" }).resultState, "INTERRUPTED");
  assert.equal(analyzeV2Experiment({ ...fixture(), assignments: [], outcomes: [] }).resultState, "INSUFFICIENT_EVIDENCE");
});

test("qualification power accounts for simulation uncertainty and rejects nonfinite evidence", () => {
  assert.ok(conservativePowerLowerBound(.8, 2000) < .8);
  assert.ok(conservativePowerLowerBound(.85, 2000) > .8);
  const baseline = {
    observationStart: new Date("2026-09-01Z"), observationEnd: new Date("2026-09-08Z"),
    dataSource: "SYNTHETIC", eligibleVisitors: 0, eligibleSessions: 0,
    paidPurchasers: 0, visitorRevenueMinor: [], dailyEligibleVisitors: [0, 0, 0, 0, 0, 0, 0],
    currencyCode: "USD", coverage: 1, targetEffect: .2,
  };
  for (const patch of [{ coverage: NaN }, { targetEffect: Infinity }, { alpha: NaN },
    { bootstrapSeed: -1 }, { simulations: 1 }, { maximumEnrollmentDays: Infinity }, { currencyCode: "JPY" }])
    assert.throws(() => evaluateQualificationV2({ ...baseline, ...patch }), /QUALIFICATION_INPUT_INVALID/);
});

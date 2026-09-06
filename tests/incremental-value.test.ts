import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateIncrementalValue,
  formatMinorMoney,
  recommendationForResult,
} from "../app/services/incremental-value";
import { resultValueSemantics } from "../app/services/autopilot-presentation";

test("verified value follows the registered revenue-per-session formula", () => {
  const result = calculateIncrementalValue({
    resultState: "POSITIVE",
    currencyCode: "USD",
    treatmentNetRevenueMinor: 150_000,
    treatmentEligibleSessions: 1000,
    controlNetRevenueMinor: 100_000,
    controlEligibleSessions: 1000,
    intervalLowMinorPerSession: 10,
    intervalHighMinorPerSession: 90,
    projectedMonthlyEligibleSessions: 3000,
  });
  assert.equal(result.differenceMinorPerSession, 50);
  assert.equal(result.verifiedIncrementalMinor, 50_000);
  assert.equal(result.intervalLowMinor, 10_000);
  assert.equal(result.intervalHighMinor, 90_000);
  assert.equal(result.projectedMonthlyMinor, 150_000);
  assert.match(formatMinorMoney(result.verifiedIncrementalMinor, "USD"), /500/);
});

test("negative value is retained and invalid results never project upside", () => {
  const negative = calculateIncrementalValue({
    resultState: "NEGATIVE",
    currencyCode: "USD",
    treatmentNetRevenueMinor: 80_000,
    treatmentEligibleSessions: 1000,
    controlNetRevenueMinor: 100_000,
    controlEligibleSessions: 1000,
    projectedMonthlyEligibleSessions: 5000,
  });
  assert.equal(negative.verifiedIncrementalMinor, -20_000);
  assert.equal(negative.projectedMonthlyMinor, -100_000);

  const invalid = calculateIncrementalValue({
    resultState: "INVALID",
    currencyCode: "USD",
    treatmentNetRevenueMinor: 150_000,
    treatmentEligibleSessions: 1000,
    controlNetRevenueMinor: 100_000,
    controlEligibleSessions: 1000,
    projectedMonthlyEligibleSessions: 5000,
  });
  assert.equal(invalid.projectedMonthlyMinor, null);
  assert.match(recommendationForResult("INVALID"), /repair measurement/i);
});

test("verified and projected value have distinct visual and screen-reader semantics", () => {
  const semantics = resultValueSemantics();
  assert.notEqual(semantics.verified.visualTreatment, semantics.projected.visualTreatment);
  assert.match(semantics.verified.heading, /verified in-test/i);
  assert.match(semantics.verified.ariaLabel, /verified in-test/i);
  assert.match(semantics.projected.heading, /projection, not observed/i);
  assert.match(semantics.projected.ariaLabel, /not verified test value/i);
});

import assert from "node:assert/strict";
import test from "node:test";

import { runMixedLoadRehearsal } from "../scripts/lib/mixed-load-v2";

test("mixed v2 load at twice declared forecast isolates tenants and fails Original on mobile deadline", async () => {
  const result = await runMixedLoadRehearsal({
    tenantCount: 4,
    durationSeconds: 2,
    multiplier: 2,
    forecast: {
      storefrontDecisionsPerSecond: 4,
      financialWebhooksPerSecond: 1,
      reportReadsPerSecond: 1,
    },
    mobileFaultCount: 2,
    mobileRenderDeadlineMs: 50,
    mobileDeliveryDelayMs: 75,
  });
  assert.equal(result.exercisedMultiplier, 2);
  assert.deepEqual(result.totals, {
    attempted: 24,
    decisions: 16,
    webhooks: 4,
    reportReads: 4,
    errors: 0,
  });
  assert.equal(result.fallback.count, 0);
  assert.equal(result.tenantFairness.everyTenantSucceeded, true);
  assert.equal(result.mobileLatencyFault.originalFallbacks, 2);
  assert.equal(result.mobileLatencyFault.attempts, 2);
  assert.equal(result.queue.pending, 4);
  assert.equal(result.environment.productionCapacityClaim, false);
  assert.match(result.limitations.join(" "), /DB wait instrumentation remains unavailable/);
});

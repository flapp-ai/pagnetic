import assert from "node:assert/strict";
import test from "node:test";
import { assessExperimentHealthV2, type V2HealthInput } from "../app/services/experiment-health-v2";

function fixture(): V2HealthInput {
  const assignments = Array.from({ length: 200 }, (_, index) => ({ id: `a${index}`, arm: index < 100 ? "ORIGINAL" as const : "MATCHED" as const }));
  return { now: new Date("2026-09-05T12:00:00Z"), assignments,
    decisions: assignments.map((item) => ({ id: `d${item.id}`, assignmentId: item.id, policy: "ORIGINAL", occurredAt: new Date("2026-09-05T11:00:00Z") })),
    bridgeDecisionIds: assignments.map((item) => `d${item.id}`), renders: [],
    checkouts: assignments.map((item) => ({ identity: `order${item.id}`, assignmentId: item.id, linkedAssignmentId: item.id, test: false })),
    linkedEligibleOrders: 200, reconciledLinkedOrders: 200, contradictoryLinks: 0, unassignedFocalOrders: 0 };
}
test("healthy A/A checks both assignment arms without requiring a treatment render", () => {
  const result = assessExperimentHealthV2(fixture());
  assert.equal(result.state, "READY");
  assert.equal(result.render.coverage, null);
  assert.equal(result.checkouts.arms.MATCHED.observed, 100);
});
test("deduplication cannot manufacture checkout information or bridge coverage", () => {
  const input = fixture();
  input.checkouts = input.checkouts.slice(0, 199);
  input.checkouts.push(...input.checkouts);
  input.bridgeDecisionIds.push(...input.bridgeDecisionIds);
  const result = assessExperimentHealthV2(input);
  assert.equal(result.state, "INSUFFICIENT");
  assert.equal(result.checkouts.arms.MATCHED.observed, 99);
  assert.equal(result.bridge.observed, 200);
});
test("symmetric severe linkage loss is not a clean experiment", () => {
  const input = fixture();
  input.checkouts = input.checkouts.map((item) => ({ ...item, linkedAssignmentId: null }));
  const result = assessExperimentHealthV2(input);
  assert.equal(result.state, "INVALID");
  assert.equal(result.checkouts.armFailureDifference, 0);
  assert.ok(result.reasons.includes("CHECKOUT_LINKAGE_BELOW_GATE"));
});
test("three percentage points of arm-specific observable loss blocks a claim", () => {
  const input = fixture();
  input.checkouts.slice(100, 103).forEach((item) => { item.linkedAssignmentId = null; });
  assert.ok(assessExperimentHealthV2(input).reasons.includes("ASYMMETRIC_CHECKOUT_LINKAGE_LOSS"));
});
test("unassigned store orders stay separate and cannot inflate the experiment loss denominator", () => {
  const input = fixture();
  input.unassignedFocalOrders = 10000;
  input.checkouts.push({ identity: "unknown", assignmentId: null, linkedAssignmentId: null, test: false });
  const result = assessExperimentHealthV2(input);
  assert.equal(result.checkouts.observed, 200);
  assert.equal(result.checkouts.unknownContext, 1);
  assert.equal(result.state, "READY");
});
test("failed renders remain observations while missing reports and conflicting links fail health", () => {
  const input = fixture();
  input.decisions.forEach((item) => { item.policy = "UNIVERSAL"; });
  input.renders = input.decisions.slice(0, 180).map((item) => ({ decisionId: item.id, status: "FAILED" }));
  const result = assessExperimentHealthV2(input);
  assert.equal(result.render.observed, 180);
  assert.equal(result.render.failed, 180);
  assert.ok(result.reasons.includes("RENDER_COVERAGE_BELOW_GATE"));
  input.checkouts[0]!.linkedAssignmentId = "a199";
  assert.ok(assessExperimentHealthV2(input).reasons.includes("CONTRADICTORY_CHECKOUT_ASSIGNMENT"));
});

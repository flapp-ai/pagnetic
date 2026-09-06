export const V2_HEALTH_POLICY = "pagnetic-measurement-health-v2.1";
export const V2_CHECKOUT_ARM_FLOOR = 100;
const COVERAGE_GATE = .95;
const OBSERVATION_GRACE_MS = 5 * 60_000;

export type V2HealthInput = {
  now: Date;
  assignments: Array<{ id: string; arm: "ORIGINAL" | "MATCHED" }>;
  decisions: Array<{ id: string; assignmentId: string; policy: string; occurredAt: Date }>;
  bridgeDecisionIds: string[];
  renders: Array<{ decisionId: string; status: string }>;
  checkouts: Array<{ identity: string; assignmentId: string | null; linkedAssignmentId: string | null; test: boolean }>;
  linkedEligibleOrders: number;
  reconciledLinkedOrders: number;
  contradictoryLinks: number;
  unassignedFocalOrders: number;
};

export function assessExperimentHealthV2(input: V2HealthInput) {
  const assignments = new Map(input.assignments.map((item) => [item.id, item.arm]));
  if (!Number.isFinite(input.now.getTime()) || assignments.size !== input.assignments.length ||
    input.assignments.some((item) => !["ORIGINAL", "MATCHED"].includes(item.arm)) ||
    [input.linkedEligibleOrders, input.reconciledLinkedOrders, input.contradictoryLinks, input.unassignedFocalOrders]
      .some((value) => !Number.isSafeInteger(value) || value < 0) || input.reconciledLinkedOrders > input.linkedEligibleOrders)
    throw new Error("V2_HEALTH_INPUT_INVALID");
  const invalid = new Set<string>();
  const insufficient = new Set<string>();
  const decisions = new Map(input.decisions.filter((item) =>
    assignments.has(item.assignmentId) && item.occurredAt.getTime() <= input.now.getTime() - OBSERVATION_GRACE_MS)
    .map((item) => [item.id, item]));
  const bridge = new Set(input.bridgeDecisionIds.filter((id) => decisions.has(id)));
  const expectedRender = new Set([...decisions.values()].filter((item) => item.policy !== "ORIGINAL").map((item) => item.id));
  const renders = new Map<string, string>();
  for (const render of input.renders) {
    if (!expectedRender.has(render.decisionId)) continue;
    if (renders.has(render.decisionId) && renders.get(render.decisionId) !== render.status)
      invalid.add("CONTRADICTORY_RENDER_OUTCOMES");
    renders.set(render.decisionId, render.status);
  }
  const checkouts = new Map<string, V2HealthInput["checkouts"][number]>();
  let testCheckoutCount = 0;
  for (const checkout of input.checkouts) {
    if (checkout.test) { testCheckoutCount += 1; continue; }
    const prior = checkouts.get(checkout.identity);
    if (prior && ((prior.assignmentId && checkout.assignmentId && prior.assignmentId !== checkout.assignmentId) ||
      (prior.linkedAssignmentId && checkout.linkedAssignmentId && prior.linkedAssignmentId !== checkout.linkedAssignmentId)))
      invalid.add("CONTRADICTORY_CHECKOUT_IDENTITIES");
    checkouts.set(checkout.identity, { ...checkout, assignmentId: checkout.assignmentId ?? prior?.assignmentId ?? null,
      linkedAssignmentId: checkout.linkedAssignmentId ?? prior?.linkedAssignmentId ?? null });
  }
  const arms = {
    ORIGINAL: { observed: 0, linked: 0, failed: 0 },
    MATCHED: { observed: 0, linked: 0, failed: 0 },
  };
  let unknownContext = 0;
  for (const checkout of checkouts.values()) {
    const arm = checkout.assignmentId ? assignments.get(checkout.assignmentId) : null;
    if (!arm) { unknownContext += 1; continue; }
    arms[arm].observed += 1;
    if (checkout.linkedAssignmentId === checkout.assignmentId) arms[arm].linked += 1;
    else {
      arms[arm].failed += 1;
      if (checkout.linkedAssignmentId) invalid.add("CONTRADICTORY_CHECKOUT_ASSIGNMENT");
    }
  }
  const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
  const bridgeCoverage = ratio(bridge.size, decisions.size);
  const renderCoverage = ratio(renders.size, expectedRender.size);
  const observed = arms.ORIGINAL.observed + arms.MATCHED.observed;
  const linked = arms.ORIGINAL.linked + arms.MATCHED.linked;
  const checkoutLinkage = ratio(linked, observed);
  const controlFailure = ratio(arms.ORIGINAL.failed, arms.ORIGINAL.observed);
  const treatmentFailure = ratio(arms.MATCHED.failed, arms.MATCHED.observed);
  const armDifference = controlFailure == null || treatmentFailure == null ? null : Math.abs(controlFailure - treatmentFailure);
  if (decisions.size < 20) insufficient.add("INSUFFICIENT_BRIDGE_OBSERVATIONS");
  else if (bridgeCoverage! < COVERAGE_GATE) invalid.add("BRIDGE_COVERAGE_BELOW_GATE");
  if (expectedRender.size > 0 && expectedRender.size < 20) insufficient.add("INSUFFICIENT_RENDER_OBSERVATIONS");
  else if (renderCoverage != null && renderCoverage < COVERAGE_GATE) invalid.add("RENDER_COVERAGE_BELOW_GATE");
  if (arms.ORIGINAL.observed < V2_CHECKOUT_ARM_FLOOR || arms.MATCHED.observed < V2_CHECKOUT_ARM_FLOOR)
    insufficient.add("INSUFFICIENT_HEALTH_EVIDENCE");
  else {
    if (armDifference! > .02 + Number.EPSILON) invalid.add("ASYMMETRIC_CHECKOUT_LINKAGE_LOSS");
    // Additional conservative prelaunch rule: equally severe loss is not health.
    if (checkoutLinkage! < COVERAGE_GATE) invalid.add("CHECKOUT_LINKAGE_BELOW_GATE");
  }
  if (input.linkedEligibleOrders !== input.reconciledLinkedOrders) insufficient.add("FINANCIAL_RECONCILIATION_INCOMPLETE");
  if (input.contradictoryLinks) invalid.add("CONTRADICTORY_FINANCIAL_LINKS");
  const controlAssignments = input.assignments.filter((item) => item.arm === "ORIGINAL").length;
  const allocationZ = input.assignments.length ? Math.abs(controlAssignments-input.assignments.length/2) / Math.sqrt(input.assignments.length/4) : 0;
  if (input.assignments.length >= 20 && allocationZ >= 3.29) invalid.add("SAMPLE_RATIO_MISMATCH");
  return {
    policyVersion: V2_HEALTH_POLICY,
    state: invalid.size ? "INVALID" as const : insufficient.size ? "INSUFFICIENT" as const : "READY" as const,
    reasons: [...invalid, ...insufficient].sort(),
    bridge: { expected: decisions.size, observed: bridge.size, coverage: bridgeCoverage },
    render: { expected: expectedRender.size, observed: renders.size, coverage: renderCoverage,
      failed: [...renders.values()].filter((status) => status !== "RENDERED").length },
    checkouts: { arms, observed, linked, coverage: checkoutLinkage, armFailureDifference: armDifference,
      unknownContext, testCheckoutCount },
    ledger: { expected: input.linkedEligibleOrders, reconciled: input.reconciledLinkedOrders },
    unassignedFocalOrders: input.unassignedFocalOrders,
    observationScope: "Observed, consented eligible visitors; wholly unobserved losses are not inferable.",
    observationGraceMilliseconds: OBSERVATION_GRACE_MS,
  };
}

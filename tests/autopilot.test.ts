import assert from "node:assert/strict";
import test from "node:test";

import {
  autopilotHash,
  candidateChoicesFromScores,
  canTransitionAutopilot,
  rankProductCandidates,
  scoreProductCandidate,
} from "../app/services/autopilot";
import {
  presentAutopilotState,
  presentPlanTimeline,
  shouldOfferThemeVerification,
} from "../app/services/autopilot-presentation";

const candidate = (overrides: Record<string, unknown> = {}) => ({
  productId: "product-a",
  title: "Trail Runner",
  status: "ACTIVE",
  sourceTextLength: 500,
  sourceReadinessScore: 90,
  recentEligibleSessions: 5000,
  recentNetRevenueMinor: 800_000,
  recentOrders: 90,
  acquisitionCoverage: 0.8,
  availableVariants: 4,
  totalVariants: 4,
  conflictingExperiment: false,
  ...overrides,
});

test("selects a clear product deterministically", () => {
  const inputs = [
    candidate(),
    candidate({
      productId: "product-b",
      sourceReadinessScore: 40,
      recentEligibleSessions: 500,
      recentNetRevenueMinor: 50_000,
    }),
  ];
  const first = rankProductCandidates(inputs);
  const second = rankProductCandidates([...inputs].reverse());
  assert.equal(first.selected?.productId, "product-a");
  assert.equal(second.selected?.productId, "product-a");
  assert.deepEqual(first.scores, second.scores);
});

test("a material candidate tie asks the merchant to choose", () => {
  const result = rankProductCandidates([
    candidate(),
    candidate({ productId: "product-b" }),
  ]);
  assert.equal(result.selected, null);
  assert.equal(result.tied.length, 2);
});

test("candidate choices omit excluded rows and deduplicate recent scoring runs", () => {
  const choices = candidateChoicesFromScores([
    {
      productId: "excluded",
      totalScore: 100,
      qualificationBand: "INSUFFICIENT",
      exclusions: ["No variant is available for sale."],
    },
    {
      productId: "best",
      totalScore: 50.5,
      qualificationBand: "UNKNOWN",
      exclusions: [],
    },
    {
      productId: "runner-up",
      totalScore: 48,
      qualificationBand: "UNKNOWN",
      exclusions: [],
    },
    {
      productId: "best",
      totalScore: 50.5,
      qualificationBand: "UNKNOWN",
      exclusions: [],
    },
    {
      productId: "too-far",
      totalScore: 40,
      qualificationBand: "UNKNOWN",
      exclusions: [],
    },
  ]);
  assert.deepEqual(
    choices.map((choice) => choice.productId),
    ["best", "runner-up"],
  );
});

test("missing history produces a source-based recommendation without duration precision", () => {
  const score = scoreProductCandidate(
    candidate({
      recentEligibleSessions: null,
      recentNetRevenueMinor: null,
      recentOrders: null,
    }),
  );
  assert.equal(score.qualificationBand, "UNKNOWN");
  assert.equal(score.durationBand, "NOT_ENOUGH_DATA");
  assert.equal(score.expectedDurationDays, null);
  assert.match(score.explanations[0], /source-based/i);
});

test("excluded and unavailable products cannot become approvable", () => {
  for (const score of [
    scoreProductCandidate(candidate({ excludedCategory: true })),
    scoreProductCandidate(candidate({ availableVariants: 0 })),
    scoreProductCandidate(candidate({ conflictingExperiment: true })),
  ]) {
    assert.equal(score.eligible, false);
    assert.equal(score.qualificationBand, "INSUFFICIENT");
    assert.equal(score.totalScore, 0);
  }
});

test("plan hashing is stable across object key order and changes on frozen input drift", () => {
  const left = autopilotHash({
    product: "a",
    content: ["one"],
    protocol: { b: 2, a: 1 },
  });
  const reordered = autopilotHash({
    protocol: { a: 1, b: 2 },
    content: ["one"],
    product: "a",
  });
  const changed = autopilotHash({
    product: "a",
    content: ["two"],
    protocol: { b: 2, a: 1 },
  });
  assert.equal(left, reordered);
  assert.notEqual(left, changed);
});

test("state transitions preserve approval and experiment ordering", () => {
  assert.equal(canTransitionAutopilot("READY_FOR_APPROVAL", "APPROVED"), true);
  assert.equal(
    canTransitionAutopilot("READY_FOR_APPROVAL", "AA_RUNNING"),
    false,
  );
  assert.equal(canTransitionAutopilot("AA_FAILED", "REAL_TEST_RUNNING"), false);
  assert.equal(
    canTransitionAutopilot("REAL_TEST_RUNNING", "RESULT_READY"),
    true,
  );
  assert.equal(canTransitionAutopilot("REAL_TEST_RUNNING", "PAUSED"), true);
});

test("technical plan states collapse into exactly five merchant states", () => {
  const states = new Set(
    [
      "PREPARING",
      "READY_FOR_APPROVAL",
      "APPROVED",
      "WAITING_FOR_THEME",
      "VERIFYING",
      "AA_RUNNING",
      "AA_FAILED",
      "REAL_TEST_RUNNING",
      "PAUSED",
      "RESULT_READY",
      "INVALIDATED",
    ].map(
      (planState) =>
        presentAutopilotState({
          planState: planState as Parameters<
            typeof presentAutopilotState
          >[0]["planState"],
        }).state,
    ),
  );
  assert.deepEqual(
    [...states].sort(),
    [
      "MEASURING",
      "NEEDS_ATTENTION",
      "NEEDS_ENABLEMENT",
      "PREPARING",
      "RESULT_READY",
    ].sort(),
  );
});

test("blocking verification status names an owner and never claims no action is needed", () => {
  const status = presentAutopilotState({
    planState: "VERIFYING",
    openNoticeKind: "ACTIVATION_BLOCKED",
  });
  assert.equal(status.state, "NEEDS_ATTENTION");
  assert.equal(status.owner, "PAGNETIC");
  assert.equal(status.serving, "ORIGINAL");
  assert.equal(status.primaryAction?.label, "Contact Pagnetic support");
  assert.ok(
    status.blockers.some((blocker) => blocker.code === "ACTIVATION_BLOCKED"),
  );
  assert.doesNotMatch(
    `${status.title} ${status.detail} ${status.primaryAction?.label}`,
    /no action needed/i,
  );
});

test("VERIFYING offers release recapture only for missing runtime evidence", () => {
  assert.equal(
    shouldOfferThemeVerification({
      planState: "VERIFYING",
      pendingQaChecks: [
        "placement",
        "mobile",
        "desktop",
        "standard_checkout",
        "accelerated_checkout",
        "shop_pay",
        "consent_flows",
        "original_fallback",
        "performance",
      ],
    }),
    true,
  );
  assert.equal(
    shouldOfferThemeVerification({
      planState: "VERIFYING",
      pendingQaChecks: [
        "mobile",
        "desktop",
        "standard_checkout",
        "accelerated_checkout",
        "shop_pay",
        "consent_flows",
        "performance",
      ],
    }),
    false,
  );
  assert.equal(
    shouldOfferThemeVerification({
      planState: "VERIFYING",
      pendingQaChecks: null,
    }),
    false,
  );
  assert.equal(
    shouldOfferThemeVerification({
      planState: "WAITING_FOR_THEME",
      pendingQaChecks: null,
    }),
    true,
  );
});

test("healthy measurement and a paused plan expose truthful responsibility", () => {
  const collecting = presentAutopilotState({ planState: "REAL_TEST_RUNNING" });
  assert.equal(collecting.owner, "WAITING_FOR_DATA");
  assert.equal(collecting.serving, "TEST");
  assert.equal(collecting.primaryAction, null);

  const paused = presentAutopilotState({ planState: "PAUSED" });
  assert.equal(paused.state, "NEEDS_ATTENTION");
  assert.equal(paused.owner, "MERCHANT");
  assert.equal(paused.serving, "ORIGINAL");
  assert.equal(paused.primaryAction?.id, "resume-plan");
});

test("initial preparation cannot hide a blocker or required product choice", () => {
  const failed = presentAutopilotState({
    planState: "PREPARING",
    openNoticeKind: "PREPARATION_FAILED",
  });
  assert.equal(failed.state, "NEEDS_ATTENTION");
  assert.equal(failed.owner, "PAGNETIC");
  assert.equal(failed.primaryAction?.id, "contact-support");
  assert.ok(
    failed.blockers.some((blocker) => blocker.code === "PREPARATION_FAILED"),
  );
  const needsChoice = presentAutopilotState({
    planState: null,
    openNoticeKind: "CANDIDATE_TIE",
    hasCandidateTie: true,
  });
  assert.equal(needsChoice.state, "NEEDS_ATTENTION");
  assert.equal(needsChoice.owner, "MERCHANT");
  assert.equal(needsChoice.primaryAction?.label, "Choose a product");
  assert.equal(presentAutopilotState({ planState: null }).state, "PREPARING");
});

test("v2 plan timeline counts the fixed baseline once and never promises 49 days", () => {
  const common = {
    v2: true,
    legacyQualificationBand: "STRONG",
    legacyDurationLabel: "49 days",
  } as const;
  assert.equal(
    presentPlanTimeline({ ...common, planState: "READY_FOR_APPROVAL" }),
    "Registered measurement windows: 56–84 days after activation, plus any setup delay",
  );
  assert.equal(
    presentPlanTimeline({ ...common, planState: "AA_RUNNING" }),
    "Baseline: 14 days + 14 days maturity · message test then takes 28–56 days",
  );
  assert.equal(
    presentPlanTimeline({ ...common, planState: "AA_RUNNING", baselineComplete: true }),
    "Baseline complete · message-test result window: 28–56 days from its activation",
  );
  assert.equal(
    presentPlanTimeline({ ...common, planState: "REAL_TEST_RUNNING" }),
    "Message-test result window: 28–56 days from its activation",
  );
  assert.equal(
    presentPlanTimeline({ ...common, planState: "RESULT_READY" }),
    "Registered evidence complete",
  );
  assert.doesNotMatch(
    presentPlanTimeline({ ...common, planState: "APPROVED" }),
    /49/,
  );
  assert.equal(
    presentPlanTimeline({ ...common, v2: false, planState: "APPROVED" }),
    "STRONG traffic · expected completion 49 days",
  );
});

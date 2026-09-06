import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  allocationZScore,
  assessExperimentHealth,
  executionPolicyForArm,
  readinessFromChecks,
} from "../app/services/experiment-health";
import { analyzeExperiment } from "../app/services/experiment-analysis";
import {
  canonicalOrderId,
  activateWebPixel,
  experimentBucket,
  hashPixelToken,
  mergeOrderMetadata,
  pixelTokenMatches,
  sanitizedEventData,
  validOpaqueId,
} from "../app/services/measurement.server";
import { assessRuntimeSafety } from "../app/services/pilot-safety";
import { assessPilotLaunchReadiness } from "../app/services/pilot-readiness";

test("creates deterministic salted server-side assignment buckets", () => {
  const input = {
    merchantId: "merchant_1",
    experimentId: "experiment_1",
    randomizationUnitId: "visitor_1",
    salt: "registered-salt-v1",
  };
  const first = experimentBucket(input);
  assert.equal(first, experimentBucket(input));
  assert.ok(first >= 0 && first < 10_000);
  assert.notEqual(
    first,
    experimentBucket({ ...input, salt: "registered-salt-v2" }),
  );
});

test("validates opaque identifiers without accepting arbitrary shopper text", () => {
  assert.equal(validOpaqueId("asv_018f-abc:123"), true);
  assert.equal(validOpaqueId("person@example.com"), false);
  assert.equal(validOpaqueId("contains a space"), false);
});

test("compares pixel credentials using their hashes", () => {
  const token = "long-random-token-value-1234567890";
  const hash = hashPixelToken(token);
  assert.equal(pixelTokenMatches(token, hash), true);
  assert.equal(pixelTokenMatches("different-token", hash), false);
});

test("adopts and updates Shopify's existing Web Pixel after a database move", async () => {
  const calls: Array<{ query: string; variables?: Record<string, unknown> }> = [];
  const db = {
    pixelCredential: {
      findUnique: async () => null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => create,
    },
  } as unknown as PrismaClient;
  const graphql = async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => {
    calls.push({ query, variables: options?.variables });
    if (query.includes("CurrentAdaptivePixel")) {
      return Response.json({
        data: { webPixel: { id: "gid://shopify/WebPixel/42" } },
      });
    }
    return Response.json({
      data: {
        webPixelUpdate: {
          userErrors: [],
          webPixel: { id: "gid://shopify/WebPixel/42" },
        },
      },
    });
  };

  const credential = await activateWebPixel({
    db,
    merchantId: "merchant_1",
    shop: "shop.myshopify.com",
    endpoint: "https://pagnetic.example/storefront/events",
    graphql,
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /webPixel/);
  assert.match(calls[1].query, /webPixelUpdate/);
  assert.equal(calls[1].variables?.id, "gid://shopify/WebPixel/42");
  assert.equal(credential.webPixelId, "gid://shopify/WebPixel/42");
});

test("event payload data is allow-listed by event type", () => {
  assert.deepEqual(
    sanitizedEventData("checkout_completed", {
      amount: 42.5,
      currencyCode: "USD",
    }),
    { amount: 42.5, currencyCode: "USD" },
  );
  assert.equal(
    sanitizedEventData("checkout_completed", {
      amount: 42.5,
      emailAddress: "shopper@example.com",
    }),
    null,
  );
  assert.equal(
    sanitizedEventData("page_viewed", {
      url: "https://store.example/products/private",
    }),
    null,
  );
  assert.deepEqual(sanitizedEventData("page_viewed", undefined), {});
  assert.deepEqual(
    sanitizedEventData("adaptive_storefront_decision", {
      decisionTimeMs: 451,
      serverProcessingMs: 19,
    }),
    { decisionTimeMs: 451, serverProcessingMs: 19 },
  );
  assert.deepEqual(
    sanitizedEventData("adaptive_storefront_vitals", {
      lcpMs: 2100,
      clsMilli: 24,
      inpMs: 120,
    }),
    { lcpMs: 2100, clsMilli: 24, inpMs: 120 },
  );
  assert.equal(
    sanitizedEventData("adaptive_storefront_vitals", {
      lcpMs: 2100,
      url: "https://store.example/private",
    }),
    null,
  );
});

test("canonicalizes Shopify order identifiers", () => {
  assert.equal(canonicalOrderId("123"), "gid://shopify/Order/123");
  assert.equal(
    canonicalOrderId("gid://shopify/Order/123"),
    "gid://shopify/Order/123",
  );
  assert.equal(canonicalOrderId("order-123"), null);
});

test("supports A/A and A/B arm policies without changing assignment labels", () => {
  assert.equal(
    executionPolicyForArm("ORIGINAL", "ORIGINAL", "ORIGINAL"),
    "ORIGINAL",
  );
  assert.equal(
    executionPolicyForArm("MATCHED", "ORIGINAL", "ORIGINAL"),
    "ORIGINAL",
  );
  assert.equal(
    executionPolicyForArm("MATCHED", "ORIGINAL", "MATCHED"),
    "MATCHED",
  );
});

test("flags severe sample-ratio mismatch after the minimum sample", () => {
  assert.equal(
    allocationZScore({
      total: 100,
      observedControl: 50,
      controlPercentage: 50,
    }),
    0,
  );
  const checks = assessExperimentHealth({
    totalAssignments: 100,
    controlAssignments: 90,
    controlPercentage: 50,
    decisions: 100,
    decisionsWithPixelEvent: 100,
    matchedPolicyDecisions: 0,
    renderReports: 0,
    orders: 10,
    attributedOrders: 10,
  });
  assert.equal(
    checks.find((check) => check.key === "allocation")?.status,
    "WARN",
  );
  assert.equal(readinessFromChecks(checks), "HOLD");
});

test("keeps A/A readiness collecting until instrumentation has enough evidence", () => {
  const checks = assessExperimentHealth({
    totalAssignments: 8,
    controlAssignments: 4,
    controlPercentage: 50,
    decisions: 8,
    decisionsWithPixelEvent: 8,
    matchedPolicyDecisions: 0,
    renderReports: 0,
    orders: 0,
    attributedOrders: 0,
  });
  assert.equal(
    checks.find((check) => check.key === "renderCoverage")?.status,
    "NA",
  );
  assert.equal(readinessFromChecks(checks), "COLLECTING");
});

test("preserves immutable order metadata when update and recovery webhooks arrive", () => {
  const created = mergeOrderMetadata(null, {
    webhookId: "create-1",
    topic: "ORDERS_CREATE",
    lineItemCount: 1,
    test: true,
  });
  const updated = JSON.parse(
    mergeOrderMetadata(created, {
      webhookId: "update-1",
      topic: "ORDERS_UPDATED",
      lineItemCount: 0,
      test: false,
      recovered: true,
    }),
  ) as Record<string, unknown>;
  assert.equal(updated.firstWebhookId, "create-1");
  assert.equal(updated.webhookId, "update-1");
  assert.equal(updated.test, true);
  assert.equal(updated.lineItemCount, 1);
  assert.equal(updated.recovered, true);
});

function registeredAnalysis(
  overrides: Partial<Parameters<typeof analyzeExperiment>[0]> = {},
) {
  const assignments = Array.from({ length: 20 }, (_, index) => ({
    id: `assignment_${index}`,
    arm: index < 10 ? ("ORIGINAL" as const) : ("MATCHED" as const),
  }));
  const decisions = assignments.map((assignment, index) => ({
    id: `decision_${index}`,
    assignmentId: assignment.id,
    sessionId: `session_${index}`,
  }));
  return analyzeExperiment({
    testType: "AA",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: new Date("2026-01-15T00:00:00.000Z"),
    now: new Date("2026-01-23T00:00:00.000Z"),
    healthReadiness: "READY",
    registration: {
      hypothesis: "Registered test",
      revenueDefinition: "NET",
      minimumMeaningfulLift: 0.05,
      alpha: 0.05,
      targetSampleSize: 20,
      minimumDurationDays: 14,
      maximumDurationDays: 42,
      dataMaturityLagDays: 7,
    },
    assignments,
    decisions,
    orders: assignments.map((assignment, index) => ({
      assignmentId: assignment.id,
      decisionId: `decision_${index}`,
      grossAmount: 10,
      netAmount: 10,
      currencyCode: "USD",
      cancelled: false,
    })),
    ...overrides,
  });
}

test("validates a mature balanced A/A analysis", () => {
  const result = registeredAnalysis();
  assert.equal(result.resultState, "VALIDATED");
  assert.equal(result.maturity, "MATURE");
  assert.equal(result.absoluteLift, 0);
  assert.deepEqual(result.interval, { lower: 0, upper: 0 });
});

test("classifies a mature effect test using the frozen economic threshold", () => {
  const assignments = Array.from({ length: 20 }, (_, index) => ({
    id: `assignment_${index}`,
    arm: index < 10 ? ("ORIGINAL" as const) : ("MATCHED" as const),
  }));
  const orders = assignments.map((assignment, index) => ({
    assignmentId: assignment.id,
    decisionId: `decision_${index}`,
    grossAmount: index < 10 ? 10 : 12,
    netAmount: index < 10 ? 10 : 12,
    currencyCode: "USD",
    cancelled: false,
  }));
  const result = registeredAnalysis({
    testType: "AB",
    assignments,
    orders,
    registration: {
      hypothesis: "Treatment improves RPS",
      revenueDefinition: "NET",
      minimumMeaningfulLift: 0.05,
      alpha: 0.05,
      targetSampleSize: 20,
      minimumDurationDays: 14,
      maximumDurationDays: 42,
      dataMaturityLagDays: 7,
    },
  });
  assert.equal(result.resultState, "POSITIVE");
  assert.equal(result.relativeLift, 0.2);
});

test("triggers runtime rollback on severe incidents and mature guardrail failures", () => {
  assert.equal(
    assessRuntimeSafety({
      killSwitchActive: false,
      openSeverityOneIncidents: 1,
      renderAttempts: 0,
      renderFailures: 0,
      decisionLatenciesMs: [],
    }).rollback,
    true,
  );
  const slow = assessRuntimeSafety({
    killSwitchActive: false,
    openSeverityOneIncidents: 0,
    renderAttempts: 20,
    renderFailures: 0,
    decisionLatenciesMs: Array.from({ length: 20 }, () => 180),
  });
  assert.equal(slow.outcome, "ROLLBACK");
  assert.match(slow.reasons.join(" "), /150 ms/);

  const proxyAware = assessRuntimeSafety({
    killSwitchActive: false,
    openSeverityOneIncidents: 0,
    renderAttempts: 20,
    renderFailures: 0,
    decisionLatenciesMs: Array.from({ length: 20 }, () => 451),
    serverProcessingLatenciesMs: Array.from({ length: 20 }, () => 19),
    thresholds: {
      decisionP95MillisecondsMaximum: 1000,
      serverProcessingP95MillisecondsMaximum: 150,
    },
  });
  assert.equal(proxyAware.outcome, "HEALTHY");
  assert.equal(proxyAware.metrics.decisionP95Milliseconds, 451);
  assert.equal(proxyAware.metrics.serverProcessingP95Milliseconds, 19);
});

test("blocks pilot launch until registered protocol dependencies pass", () => {
  const blocked = assessPilotLaunchReadiness({
    hasRegistration: true,
    brandProfileApproved: true,
    pixelActive: true,
    killSwitchActive: false,
    productQualified: true,
    themeActive: true,
    qaComplete: true,
    incidentContactConfigured: true,
    productionEnvironmentReady: true,
    frozenConfigurationCurrent: true,
    requiresAaValidation: true,
    requiresUniversal: true,
    universalApproved: true,
    requiresMatched: true,
    matchedApprovedCount: 2,
    activeMappings: 1,
    aaValidated: true,
    stageOnePositive: false,
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(
    blocked.checks.filter((check) => !check.passed).map((check) => check.key),
    ["matched", "stageOne"],
  );
});

test("allows the first A/A instrumentation run without a prior A/A snapshot", () => {
  const readiness = assessPilotLaunchReadiness({
    hasRegistration: true,
    brandProfileApproved: true,
    pixelActive: true,
    killSwitchActive: false,
    productQualified: true,
    themeActive: true,
    qaComplete: true,
    incidentContactConfigured: true,
    productionEnvironmentReady: true,
    frozenConfigurationCurrent: true,
    requiresAaValidation: false,
    requiresUniversal: false,
    universalApproved: false,
    requiresMatched: false,
    matchedApprovedCount: 0,
    activeMappings: 0,
    aaValidated: false,
    stageOnePositive: false,
  });
  assert.equal(readiness.ready, true);
  assert.equal(
    readiness.checks.some((check) => check.key === "aa"),
    false,
  );
});

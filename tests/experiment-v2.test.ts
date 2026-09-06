import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  analyzeV2Experiment,
  studentTCdf,
  studentTQuantile,
} from "../app/services/experiment-analysis-v2";
import { closeV2EnrollmentIfDue } from "../app/services/experiment-lifecycle-v2.server";
import { snapshotV2ExperimentReport } from "../app/services/experiment-report-v2.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../app/services/mvp-v2";
import { evaluateQualificationV2 } from "../app/services/qualification-v2";
import { snapshotQualificationV2 } from "../app/services/qualification-v2.server";

const DAY_MS = 86_400_000;

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-experiment-v2-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function analysisInput() {
  return {
    testType: "AB" as const,
    now: new Date("2026-10-01T00:00:00.000Z"),
    enrollmentStartedAt: new Date("2026-09-01T00:00:00.000Z"),
    enrollmentClosedAt: new Date("2026-09-15T00:00:00.000Z"),
    financialMaturityAt: new Date("2026-09-29T00:00:00.000Z"),
    stopReason: null,
    healthState: "READY" as const,
    financialComplete: true,
    targetVisitors: 4,
    minimumPaidOrders: 0,
    minimumWorthwhileRelativeEffect: 0.05,
    alpha: 0.05,
    currencyCode: "USD",
    assignments: [
      { id: "c1", arm: "ORIGINAL" as const },
      { id: "c2", arm: "ORIGINAL" as const },
      { id: "t1", arm: "MATCHED" as const },
      { id: "t2", arm: "MATCHED" as const },
    ],
    outcomes: [
      { assignmentId: "c1", netFocalRevenueMinor: "100", paidOrders: 1 },
      { assignmentId: "t1", netFocalRevenueMinor: "150", paidOrders: 1 },
    ],
  };
}

test("Student t implementation matches reference quantiles and symmetry", () => {
  const quantile = studentTQuantile(0.975, 10);
  assert.ok(Math.abs(quantile - 2.228138852) < 1e-7);
  assert.ok(Math.abs(studentTCdf(quantile, 10) - 0.975) < 1e-10);
  assert.ok(Math.abs(studentTQuantile(0.025, 10) + quantile) < 1e-10);
});

test("assigned-visitor estimator includes zero-order visitors and uses Welch uncertainty", () => {
  const result = analyzeV2Experiment(analysisInput());
  assert.equal(result.control.assignments, 2);
  assert.equal(result.treatment.assignments, 2);
  assert.equal(result.control.meanMinor, 50);
  assert.equal(result.treatment.meanMinor, 75);
  assert.equal(result.effectMinor, 25);
  assert.equal(result.estimatedAdditionalSalesMinor, "50");
  assert.ok(result.standardErrorMinor > 0);
});

test("positive, degenerate, interrupted and deadline-under-target precedence is explicit", () => {
  const assignments = [];
  const outcomes = [];
  for (let index = 0; index < 100; index += 1) {
    assignments.push({ id: `c${index}`, arm: "ORIGINAL" as const });
    assignments.push({ id: `t${index}`, arm: "MATCHED" as const });
    outcomes.push({
      assignmentId: `c${index}`,
      netFocalRevenueMinor: index % 2 ? "100" : "0",
      paidOrders: index % 2,
    });
    outcomes.push({
      assignmentId: `t${index}`,
      netFocalRevenueMinor: index % 2 ? "200" : "0",
      paidOrders: index % 2,
    });
  }
  const positive = analyzeV2Experiment({
    ...analysisInput(),
    targetVisitors: 200,
    minimumPaidOrders: 20,
    assignments,
    outcomes,
  });
  assert.equal(positive.resultState, "POSITIVE");
  const negative = analyzeV2Experiment({
    ...analysisInput(),
    targetVisitors: 200,
    minimumPaidOrders: 20,
    assignments,
    outcomes: outcomes.map((outcome) => ({
      ...outcome,
      netFocalRevenueMinor: outcome.assignmentId.startsWith("t")
        ? (Number(outcome.netFocalRevenueMinor) / 4).toString()
        : outcome.netFocalRevenueMinor,
    })),
  });
  assert.equal(negative.resultState, "NEGATIVE");
  assert.equal(analyzeV2Experiment(analysisInput()).resultState, "INCONCLUSIVE");
  assert.equal(analyzeV2Experiment({
    ...analysisInput(),
    healthState: "INVALID",
  }).resultState, "INVALID");
  assert.equal(analyzeV2Experiment({
    ...analysisInput(),
    enrollmentClosedAt: null,
    targetVisitors: 200,
    minimumPaidOrders: 20,
    assignments,
    outcomes,
  }).resultState, "COLLECTING");
  assert.equal(analyzeV2Experiment({
    ...analysisInput(),
    now: new Date("2026-09-20T00:00:00.000Z"),
    targetVisitors: 200,
    minimumPaidOrders: 20,
    assignments,
    outcomes,
  }).resultState, "MATURING");
  const degenerate = analyzeV2Experiment({
    ...analysisInput(),
    assignments: assignments.slice(0, 4),
    outcomes: [],
  });
  assert.equal(degenerate.resultState, "INSUFFICIENT_EVIDENCE");
  assert.ok(degenerate.reasons.includes("INSUFFICIENT_STATISTICAL_INFORMATION"));
  const oneArm = analyzeV2Experiment({
    ...analysisInput(),
    targetVisitors: 2,
    assignments: [
      { id: "c1", arm: "ORIGINAL" },
      { id: "c2", arm: "ORIGINAL" },
    ],
    outcomes: [],
  });
  assert.equal(oneArm.resultState, "INSUFFICIENT_EVIDENCE");
  assert.equal(analyzeV2Experiment({
    ...analysisInput(),
    now: new Date("2026-09-20T00:00:00.000Z"),
    stopReason: "MERCHANT_PAUSE",
  }).resultState, "MATURING");
  assert.equal(analyzeV2Experiment({
    ...analysisInput(),
    stopReason: "MERCHANT_PAUSE",
  }).resultState, "INTERRUPTED");
  assert.equal(analyzeV2Experiment({
    ...analysisInput(),
    stopReason: "MAX_DURATION_UNDER_TARGET",
    targetVisitors: 10,
  }).resultState, "INSUFFICIENT_EVIDENCE");

  const aa = analyzeV2Experiment({
    ...analysisInput(),
    testType: "AA",
    targetVisitors: 200,
    minimumPaidOrders: 20,
    assignments,
    outcomes: outcomes.map((outcome) => ({
      ...outcome,
      netFocalRevenueMinor: outcome.assignmentId.startsWith("t")
        ? (Number(outcome.netFocalRevenueMinor) / 2).toString()
        : outcome.netFocalRevenueMinor,
    })),
  });
  assert.equal(aa.resultState, "MEASUREMENT_CHECKS_PASSED");
});

test("qualification requires observed baseline floors and persists calibrated evidence", async () => {
  const below = evaluateQualificationV2({
    observationStart: new Date("2026-09-01T00:00:00.000Z"),
    observationEnd: new Date("2026-09-06T00:00:00.000Z"),
    dataSource: "CONSENTED_PIXEL_AND_LEDGER_V2",
    eligibleVisitors: 2,
    eligibleSessions: 2,
    paidPurchasers: 0,
    visitorRevenueMinor: ["0", "0"],
    dailyEligibleVisitors: [1, 1, 0, 0, 0],
    currencyCode: "USD",
    coverage: 1,
    targetEffect: 0.05,
  });
  assert.equal(below.status, "BASELINE_REQUIRED");
  assert.equal(below.targetVisitors, null);

  const input = {
    observationStart: new Date("2026-09-01T00:00:00.000Z"),
    observationEnd: new Date("2026-09-08T00:00:00.000Z"),
    dataSource: "CONSENTED_PIXEL_AND_LEDGER_V2",
    eligibleVisitors: 2_000,
    eligibleSessions: 2_400,
    paidPurchasers: 2_000,
    visitorRevenueMinor: Array.from({ length: 2_000 }, (_, index) =>
      index % 2 ? "100" : "110"),
    dailyEligibleVisitors: [286, 286, 286, 286, 286, 285, 285],
    dailyObservableCheckoutVisitors: [50, 50, 50, 50, 50, 50, 50],
    outcomesObservedThrough: new Date("2026-09-15T00:00:00.000Z"),
    currencyCode: "USD",
    coverage: 0.99,
    targetEffect: 0.05,
    bootstrapSeed: 42,
  };
  const qualified = evaluateQualificationV2(input);
  assert.equal(qualified.status, "QUALIFIED");
  assert.ok(qualified.targetVisitors! >= qualified.analyticPerArm! * 2);
  assert.ok(qualified.simulatedPower! >= 0.8);
  assert.equal(qualified.simulations, 2_000);
  assert.ok(qualified.forecastLowDays! >= 49);

  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({ data: { shop: "qualification-v2.myshopify.com" } });
    const product = await fixture.db.product.create({ data: {
      merchantId: merchant.id,
      shopifyProductId: "gid://shopify/Product/qualification",
      title: "Qualification product",
      handle: "qualification-product",
      status: "ACTIVE",
      sourceVersion: "v1",
      sourceHash: "source-hash",
      sourceSnapshot: "{}",
    } });
    const first = await snapshotQualificationV2({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      input,
    });
    const replay = await snapshotQualificationV2({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      input,
    });
    assert.equal(replay.id, first.id);
    const secondMerchant = await fixture.db.merchant.create({
      data: { shop: "qualification-v2-second.myshopify.com" },
    });
    const secondProduct = await fixture.db.product.create({ data: {
      merchantId: secondMerchant.id,
      shopifyProductId: "gid://shopify/Product/qualification-second",
      title: "Second qualification product",
      handle: "qualification-product-second",
      status: "ACTIVE",
      sourceVersion: "v1",
      sourceHash: "source-hash-second",
      sourceSnapshot: "{}",
    } });
    const isolated = await snapshotQualificationV2({
      db: fixture.db,
      merchantId: secondMerchant.id,
      productId: secondProduct.id,
      input,
    });
    assert.notEqual(isolated.id, first.id);
    assert.notEqual(isolated.snapshotHash, first.snapshotHash);
    assert.equal(await fixture.db.qualificationSnapshot.count(), 2);
  } finally { await fixture.close(); }
});

async function seedV2Experiment(db: PrismaClient, suffix: string) {
  const merchant = await db.merchant.create({ data: { shop: `lifecycle-${suffix}.myshopify.com` } });
  const product = await db.product.create({ data: {
    merchantId: merchant.id,
    shopifyProductId: `gid://shopify/Product/${suffix}`,
    title: "Lifecycle product",
    handle: `lifecycle-${suffix}`,
    status: "ACTIVE",
    sourceVersion: "v1",
    sourceHash: `source-${suffix}`,
    sourceSnapshot: "{}",
  } });
  const started = new Date("2026-09-01T00:00:00.000Z");
  const experiment = await db.experiment.create({ data: {
    merchantId: merchant.id,
    productId: product.id,
    key: `effect-${suffix}`,
    salt: `salt-${suffix}`,
    controlPolicy: "ORIGINAL",
    treatmentPolicy: "MATCHED",
    startedAt: started,
    enrollmentStartedAt: started,
    lifecycleVersion: 2,
    registration: { create: {
      protocolVersion: MVP_V2_PROTOCOL_VERSION,
      hypothesis: "Matched message changes focal net revenue per assigned visitor.",
      primaryMetric: MVP_V2_PRIMARY_METRIC,
      revenueDefinition: "NET_FOCAL_MERCHANDISE",
      minimumMeaningfulLift: 0.05,
      alpha: 0.05,
      power: 0.8,
      targetSampleSize: 4,
      minimumDurationDays: 14,
      maximumDurationDays: 42,
      randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
      eligibilityJson: "{}",
      exclusionsJson: "[]",
      covariatesJson: "[]",
      stoppingRule: "FIXED_COHORT_V2",
      analysisVersion: "welch-assigned-visitor-v2.1",
      contentVersionsJson: "[]",
      mappingVersionsJson: "[]",
      guardrailsJson: "{}",
      dataMaturityLagDays: 7,
      registrationHash: `registration-${suffix}`,
    } },
  } });
  return { merchant, product, experiment, started };
}

test("early lifecycle close requires target plus 100 observable checkouts per arm", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedV2Experiment(fixture.db, "target");
    const assignments = Array.from({ length: 200 }, (_, index) => ({
        id: `assignment-target-${index}`,
        merchantId: seeded.merchant.id,
        experimentId: seeded.experiment.id,
        randomizationUnitId: `visitor-${index}`,
        randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
        visitorHash: `visitor-${index}`,
        arm: index % 2 ? "MATCHED" : "ORIGINAL",
        bucket: index * 37,
        saltVersion: 1,
        consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
        assignedAt: new Date(seeded.started.getTime() + (index % 4) * DAY_MS),
        expiresAt: new Date(seeded.started.getTime() + ((index % 4) + 7) * DAY_MS),
    }));
    for (let index = 0; index < assignments.length; index += 50) {
      await fixture.db.assignment.createMany({ data: assignments.slice(index, index + 50) });
    }
    const now = new Date(seeded.started.getTime() + 14 * DAY_MS);
    const withoutOutcomes = await closeV2EnrollmentIfDue({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      now,
    });
    assert.equal(withoutOutcomes.phase, "ENROLLING");
    assert.equal(withoutOutcomes.checkoutFloorReached, false);
    assert.deepEqual(withoutOutcomes.checkoutCounts, { ORIGINAL: 0, MATCHED: 0 });

    const decisions = assignments.map((assignment, index) => ({
      id: `decision-target-${index}`,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      assignmentId: assignment.id,
      productId: seeded.product.id,
      sessionId: `session-${index}`,
      visitorId: assignment.visitorHash,
      arm: assignment.arm,
      policy: assignment.arm === "ORIGINAL" ? "ORIGINAL" : "MATCHED",
      reason: "test-observable-checkout-floor",
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      occurredAt: new Date(seeded.started.getTime() + 8 * DAY_MS),
    }));
    const checkouts = decisions.map((decision, index) => ({
      merchantId: seeded.merchant.id,
      eventId: `checkout-target-${index}`,
      source: "WEB_PIXEL",
      eventType: "checkout_completed",
      occurredAt: new Date(seeded.started.getTime() + 9 * DAY_MS),
      decisionId: decision.id,
      productId: seeded.product.shopifyProductId,
      checkoutToken: `checkout-token-${index}`,
      consentState: "analytics_and_preferences_allowed",
    }));
    for (let index = 0; index < decisions.length; index += 50) {
      await fixture.db.decision.createMany({ data: decisions.slice(index, index + 50) });
      await fixture.db.commerceEvent.createMany({ data: checkouts.slice(index, index + 50) });
    }
    const closed = await closeV2EnrollmentIfDue({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      now,
    });
    assert.equal(closed.changed, true);
    assert.equal(closed.experiment.enrollmentClosedAt?.toISOString(), now.toISOString());
    assert.equal(
      closed.experiment.attributionClosesAt?.toISOString(),
      new Date(seeded.started.getTime() + 10 * DAY_MS).toISOString(),
    );
    assert.equal(
      closed.experiment.financialMaturityAt?.toISOString(),
      new Date(seeded.started.getTime() + 17 * DAY_MS).toISOString(),
    );
    const replay = await closeV2EnrollmentIfDue({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      now: new Date(seeded.started.getTime() + 20 * DAY_MS),
    });
    assert.equal(replay.changed, false);
    assert.equal(await fixture.db.auditLog.count({
      where: { action: "V2_EXPERIMENT_ENROLLMENT_CLOSED" },
    }), 1);
  } finally { await fixture.close(); }
});

test("hard deadline closes under-target cohort and mature report cannot invent a winner", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedV2Experiment(fixture.db, "deadline");
    const afterDeadline = new Date(seeded.started.getTime() + 50 * DAY_MS);
    const closed = await closeV2EnrollmentIfDue({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      now: afterDeadline,
    });
    assert.equal(
      closed.experiment.enrollmentClosedAt?.toISOString(),
      new Date(seeded.started.getTime() + 42 * DAY_MS).toISOString(),
    );
    assert.equal(closed.experiment.stopReason, "MAX_DURATION_UNDER_TARGET");
    const snapshot = await snapshotV2ExperimentReport({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      healthState: "READY",
      now: afterDeadline,
    });
    assert.equal(snapshot.resultState, "INSUFFICIENT_EVIDENCE");
    assert.match(snapshot.reportMarkdown, /Do not make a monetary or winning claim|Apply only the frozen result rule/);
    assert.match(snapshot.reportMarkdown, /Estimated additional sales are not reportable/);
    assert.doesNotMatch(snapshot.reportMarkdown, /Estimated in-test additional focal-product sales:/);
    const current = await fixture.db.experiment.findUniqueOrThrow({
      where: { id: seeded.experiment.id },
    });
    assert.equal(current.status, "COMPLETED");
    assert.equal(current.finalizedAt?.toISOString(), afterDeadline.toISOString());
    assert.equal(current.finalResultSnapshotId, snapshot.id);
    const replay = await snapshotV2ExperimentReport({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      experimentId: seeded.experiment.id,
      healthState: "READY",
      now: new Date(afterDeadline.getTime() + DAY_MS),
    });
    assert.equal(replay.id, snapshot.id);
    const invalidLater = await snapshotV2ExperimentReport({
      db: fixture.db, merchantId: seeded.merchant.id, experimentId: seeded.experiment.id,
      healthState: "INVALID", now: new Date(afterDeadline.getTime() + 2 * DAY_MS),
    });
    assert.equal(invalidLater.id, snapshot.id);
    assert.equal(invalidLater.reportMarkdown, snapshot.reportMarkdown);
    assert.equal(await fixture.db.experimentResultSnapshot.count(), 1);
    assert.equal(await fixture.db.auditLog.count({
      where: { action: "V2_EXPERIMENT_FINALIZED" },
    }), 1);
  } finally { await fixture.close(); }
});

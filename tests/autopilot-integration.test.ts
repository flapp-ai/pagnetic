import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  advanceAutopilotPlan,
  markAutopilotVerifying,
  pauseAutopilotPlan,
} from "../app/services/autopilot-orchestrator.server";
import { advanceAutopilotPlanV2 } from "../app/services/autopilot-v2-orchestrator.server";
import {
  LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_PRIMARY_METRIC,
  MVP_V2_PROTOCOL_VERSION,
} from "../app/services/mvp-v2";
import {
  approveAutopilotPlan,
  prepareAutopilotOpportunity,
} from "../app/services/autopilot-preparation.server";
import { PILOT_QA_KEYS } from "../app/services/pilot-setup";
import { reconcileBetaEntitlement } from "../app/services/beta-entitlement.server";
import { loadAutopilotPresentation } from "../app/services/autopilot-presentation.server";
import { disableMerchantAfterUninstall } from "../app/services/uninstall.server";
import { hashValue } from "../app/services/governance.server";
import {
  beginSelectedTestStoreV2Cutover,
  recordOperatorV2QaEvidence,
  releaseSelectedTestStoreV2CutoverHold,
} from "../app/services/test-store-cutover.server";

function qaArtifactReference(label: string) {
  return `qa-artifact:v1:${createHash("sha256").update(label).digest("hex")}`;
}

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-autopilot-"));
  const databasePath = path.join(directory, "test.sqlite");
  const url = `file:${databasePath}`;
  for (const migration of readdirSync("prisma/migrations")
    .filter((entry) => /^\d/.test(entry))
    .sort()) {
    const migrationPath = path.join(
      "prisma/migrations",
      migration,
      "migration.sql",
    );
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(migrationPath),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: url });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("protocol boundary migration backfills an existing approval as legacy", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-plan-migration-"));
  const databasePath = path.join(directory, "legacy.sqlite");
  try {
    execFileSync("sqlite3", [databasePath], {
      input: [
        'CREATE TABLE "AutopilotPlan" ("id" TEXT PRIMARY KEY, "state" TEXT NOT NULL, "planHash" TEXT NOT NULL, "approvalRecordJson" TEXT);',
        'INSERT INTO "AutopilotPlan" ("id","state","planHash","approvalRecordJson") VALUES (\'legacy-approved\',\'VERIFYING\',\'historic-hash\',\'{"planHash":"historic-hash"}\');',
      ].join("\n"),
      stdio: ["pipe", "ignore", "pipe"],
    });
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(
        "prisma/migrations/20260906030000_autopilot_protocol_boundary/migration.sql",
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
    const row = execFileSync(
      "sqlite3",
      ["-json", databasePath, "SELECT * FROM AutopilotPlan"],
      { encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(row), [
      {
        id: "legacy-approved",
        state: "VERIFYING",
        planHash: "historic-hash",
        approvalRecordJson: '{"planHash":"historic-hash"}',
        orchestrationProtocolVersion:
          LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
      },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function seedOpportunity(db: PrismaClient, suffix: string) {
  const merchant = await db.merchant.create({
    data: { shop: `autopilot-${suffix}.myshopify.com` },
  });
  await db.betaEntitlement.create({ data: { merchantId: merchant.id } });
  const universal = await db.acquisitionAngle.create({
    data: {
      merchantId: merchant.id,
      key: "universal",
      label: "Universal",
    },
  });
  const sourceSnapshot = JSON.stringify({
    title: "Trail Runner",
    description:
      "Soft recycled knit supports comfortable daily movement. Responsive foam supports steady movement. Durable rubber provides grip on city streets.",
    productType: "Shoes",
    status: "ACTIVE",
    variants: [{ id: "variant-1", availableForSale: true }],
  });
  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      shopifyProductId: `gid://shopify/Product/${suffix}`,
      title: "Trail Runner",
      handle: `trail-runner-${suffix}`,
      status: "ACTIVE",
      sourceVersion: "2026-09-04T00:00:00Z",
      sourceHash: `source-${suffix}`,
      sourceSnapshot,
      syncedAt: new Date("2026-09-04T00:00:00.000Z"),
    },
  });
  const document = await db.sourceDocument.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      sourceType: "SHOPIFY_PRODUCT",
      sourceId: `${product.shopifyProductId}:product`,
      sourceVersion: product.sourceVersion,
      payloadJson: sourceSnapshot,
      contentHash: `document-${suffix}`,
    },
  });
  await db.evidenceObject.createMany({
    data: [
      {
        merchantId: merchant.id,
        productId: product.id,
        sourceDocumentId: document.id,
        sourceType: "SHOPIFY_PRODUCT_FIELD",
        sourceId: `${product.shopifyProductId}:title`,
        sourceVersion: product.sourceVersion,
        verbatimText: product.title,
        productScope: product.shopifyProductId,
        riskClass: "LOW",
        sourceHash: hashValue(product.title),
      },
      {
        merchantId: merchant.id,
        productId: product.id,
        sourceDocumentId: document.id,
        sourceType: "SHOPIFY_PRODUCT_FIELD",
        sourceId: `${product.shopifyProductId}:description`,
        sourceVersion: product.sourceVersion,
        verbatimText:
          "Soft recycled knit supports comfortable daily movement. Responsive foam supports steady movement. Durable rubber provides grip on city streets.",
        productScope: product.shopifyProductId,
        riskClass: "MEDIUM",
        sourceHash: hashValue(
          "Soft recycled knit supports comfortable daily movement. Responsive foam supports steady movement. Durable rubber provides grip on city streets.",
        ),
      },
    ],
  });
  await db.brandProfile.create({
    data: {
      merchantId: merchant.id,
      sourceHash: `brand-${suffix}`,
      voiceTraitsJson: "[]",
      vocabularyJson: "[]",
      analysisJson: "{}",
    },
  });
  return { merchant, product, universal };
}

async function makeActivationReady(
  db: PrismaClient,
  merchantId: string,
  productId: string,
) {
  await db.productQualification.create({
    data: {
      merchantId,
      productId,
      windowStart: new Date("2026-08-01T00:00:00Z"),
      windowEnd: new Date("2026-09-01T00:00:00Z"),
      eligibleSessions: 5_000,
      orders: 100,
      revenueAmount: 20_000,
      currencyCode: "USD",
      eventCoverage: 0.99,
      weeklyEligibleSessions: 1129,
      targetSampleSize: 1000,
      expectedDurationDays: 7,
      status: "READY",
    },
  });
  await db.themeActivation.create({
    data: {
      merchantId,
      productId,
      extensionStatus: "ACTIVE",
      activeOnPublishedTheme: true,
      themeId: "gid://shopify/OnlineStoreTheme/1",
    },
  });
  await db.pixelCredential.create({
    data: {
      merchantId,
      webPixelId: "pixel-1",
      tokenHash: `token-${merchantId}`,
      endpoint: "https://example.com/storefront/events",
      status: "ACTIVE",
    },
  });
  await db.pilotQaCheck.createMany({
    data: PILOT_QA_KEYS.map((key) => ({
      merchantId,
      productId,
      key,
      status: "PASSED",
      evidence: "Automated integration fixture",
    })),
  });
}

async function createApprovedPlan(db: PrismaClient, suffix: string) {
  const seeded = await seedOpportunity(db, suffix);
  const prepared = await prepareAutopilotOpportunity({
    db,
    merchantId: seeded.merchant.id,
    actor: "system:test",
  });
  assert.equal(prepared.status, "READY");
  if (prepared.status !== "READY") throw new Error("Fixture preparation failed.");
  const approved = await approveAutopilotPlan({
    db,
    merchantId: seeded.merchant.id,
    planId: prepared.plan.id,
    planHash: prepared.plan.planHash,
    actor: "merchant:test",
    mediumRiskAcknowledged: true,
  });
  return { ...seeded, prepared: prepared.plan, approved };
}

async function createApprovedV2Plan(db: PrismaClient, suffix: string) {
  const legacy = await createApprovedPlan(db, suffix);
  const cutover = await beginSelectedTestStoreV2Cutover({
    db,
    merchantId: legacy.merchant.id,
    productId: legacy.product.id,
    legacyPlanId: legacy.approved.id,
    expectedSourceVersion: legacy.product.sourceVersion,
    expectedSourceHash: legacy.product.sourceHash,
    actor: "merchant:test",
    idempotencyKey: `cutover:${suffix}`,
    now: new Date("2026-09-04T00:05:00.000Z"),
  });
  const prepared = await prepareAutopilotOpportunity({
    db,
    merchantId: legacy.merchant.id,
    actor: "system:test-v2",
    preferredProductId: legacy.product.id,
    cutoverReceiptId: cutover.receipt.id,
    now: new Date("2026-09-04T00:06:00.000Z"),
  });
  assert.equal(prepared.status, "READY");
  if (prepared.status !== "READY") throw new Error("V2 fixture preparation failed.");
  const approved = await approveAutopilotPlan({
    db,
    merchantId: legacy.merchant.id,
    planId: prepared.plan.id,
    planHash: prepared.plan.planHash,
    actor: "merchant:test-v2",
    mediumRiskAcknowledged: true,
    now: new Date("2026-09-04T00:07:00.000Z"),
  });
  return {
    ...legacy,
    legacyPlan: legacy.approved,
    cutover,
    prepared: prepared.plan,
    approved,
  };
}

async function driveToRealTest(db: PrismaClient, suffix: string) {
  const fixture = await createApprovedPlan(db, suffix);
  await makeActivationReady(db, fixture.merchant.id, fixture.product.id);
  await markAutopilotVerifying({
    db,
    merchantId: fixture.merchant.id,
    planId: fixture.approved.id,
    actor: "merchant:test",
    themeActive: true,
  });
  const aaStarted = await advanceAutopilotPlan({
    db,
    merchantId: fixture.merchant.id,
    planId: fixture.approved.id,
  });
  assert.equal(aaStarted.outcome, "AA_STARTED");
  const aaPlan = await db.autopilotPlan.findUniqueOrThrow({
    where: { id: fixture.approved.id },
  });
  await db.experimentResultSnapshot.create({
    data: {
      experimentId: aaPlan.aaExperimentId!,
      analysisVersion: "cluster-rps-v1",
      resultState: "VALIDATED",
      dataMaturityAt: new Date(),
      dataHash: `aa-valid-${suffix}`,
      payloadJson: "{}",
      reportMarkdown: "A/A valid",
    },
  });
  const realStarted = await advanceAutopilotPlan({
    db,
    merchantId: fixture.merchant.id,
    planId: fixture.approved.id,
  });
  assert.equal(realStarted.outcome, "REAL_TEST_STARTED");
  const realPlan = await db.autopilotPlan.findUniqueOrThrow({
    where: { id: fixture.approved.id },
  });
  return { ...fixture, realPlan };
}

test("approved plan advances A/A exactly once and safety pause preserves Original", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const { merchant, product } = await seedOpportunity(db, "101");
    const prepared = await prepareAutopilotOpportunity({
      db,
      merchantId: merchant.id,
      actor: "system:test",
    });
    assert.equal(
      prepared.status,
      "READY",
      JSON.stringify(
        await db.experienceVersion.findMany({
          include: { claims: { include: { evidenceLinks: true } }, angle: true },
        }),
      ),
    );
    if (prepared.status !== "READY") return;
    assert.equal(prepared.plan.state, "READY_FOR_APPROVAL");
    const approved = await approveAutopilotPlan({
      db,
      merchantId: merchant.id,
      planId: prepared.plan.id,
      planHash: prepared.plan.planHash,
      actor: "merchant:test",
      mediumRiskAcknowledged: true,
    });
    assert.equal(approved.state, "WAITING_FOR_THEME");
    await makeActivationReady(db, merchant.id, product.id);
    await markAutopilotVerifying({
      db,
      merchantId: merchant.id,
      planId: approved.id,
      actor: "merchant:test",
      themeActive: true,
    });
    const aaStarted = await advanceAutopilotPlan({
      db,
      merchantId: merchant.id,
      planId: approved.id,
    });
    assert.equal(aaStarted.outcome, "AA_STARTED");
    const afterAa = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: approved.id },
    });
    assert.ok(afterAa.aaExperimentId);
    await db.experimentResultSnapshot.create({
      data: {
        experimentId: afterAa.aaExperimentId!,
        analysisVersion: "cluster-rps-v1",
        resultState: "VALIDATED",
        dataMaturityAt: new Date(),
        dataHash: "aa-valid-101",
        payloadJson: "{}",
        reportMarkdown: "A/A valid",
      },
    });
    const realStarted = await advanceAutopilotPlan({
      db,
      merchantId: merchant.id,
      planId: approved.id,
    });
    assert.equal(realStarted.outcome, "REAL_TEST_STARTED");
    const repeated = await advanceAutopilotPlan({
      db,
      merchantId: merchant.id,
      planId: approved.id,
    });
    assert.equal(repeated.outcome, "REAL_TEST_COLLECTING");
    assert.equal(
      await db.experiment.count({ where: { merchantId: merchant.id } }),
      2,
    );
    await pauseAutopilotPlan({
      db,
      merchantId: merchant.id,
      planId: approved.id,
      actor: "merchant:test",
    });
    const paused = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: approved.id },
    });
    const runtime = await db.runtimeControl.findUniqueOrThrow({
      where: { merchantId: merchant.id },
    });
    assert.equal(paused.state, "PAUSED");
    assert.equal(runtime.killSwitch, true);
    assert.equal(
      await db.experiment.count({
        where: { merchantId: merchant.id, status: "ACTIVE" },
      }),
      0,
    );
  } finally {
    await database.close();
  }
});

test("failed A/A never starts a real experiment", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const { merchant, product } = await seedOpportunity(db, "202");
    const prepared = await prepareAutopilotOpportunity({
      db,
      merchantId: merchant.id,
      actor: "system:test",
    });
    assert.equal(
      prepared.status,
      "READY",
      JSON.stringify(
        await db.experienceVersion.findMany({
          include: { claims: { include: { evidenceLinks: true } }, angle: true },
        }),
      ),
    );
    if (prepared.status !== "READY") return;
    const approved = await approveAutopilotPlan({
      db,
      merchantId: merchant.id,
      planId: prepared.plan.id,
      planHash: prepared.plan.planHash,
      actor: "merchant:test",
      mediumRiskAcknowledged: true,
    });
    await makeActivationReady(db, merchant.id, product.id);
    await markAutopilotVerifying({
      db,
      merchantId: merchant.id,
      planId: approved.id,
      actor: "merchant:test",
      themeActive: true,
    });
    await advanceAutopilotPlan({ db, merchantId: merchant.id, planId: approved.id });
    const aaPlan = await db.autopilotPlan.findUniqueOrThrow({ where: { id: approved.id } });
    await db.experimentResultSnapshot.create({
      data: {
        experimentId: aaPlan.aaExperimentId!,
        analysisVersion: "cluster-rps-v1",
        resultState: "FAILED_VALIDATION",
        dataMaturityAt: new Date(),
        dataHash: "aa-failed-202",
        payloadJson: "{}",
        reportMarkdown: "A/A failed",
      },
    });
    const result = await advanceAutopilotPlan({ db, merchantId: merchant.id, planId: approved.id });
    assert.equal(result.outcome, "AA_FAILED");
    const failed = await db.autopilotPlan.findUniqueOrThrow({ where: { id: approved.id } });
    assert.equal(failed.state, "AA_FAILED");
    assert.equal(failed.realExperimentId, null);
    assert.equal(await db.experiment.count({ where: { merchantId: merchant.id } }), 1);
  } finally {
    await database.close();
  }
});

test("negative outcomes remain free and reconciliation is idempotent", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const { merchant, product } = await seedOpportunity(db, "303");
    const experiment = await db.experiment.create({
      data: {
        merchantId: merchant.id,
        productId: product.id,
        key: "entitlement-stage1",
        salt: "test-salt",
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "UNIVERSAL",
      },
    });
    const negative = await db.experimentResultSnapshot.create({
      data: {
        experimentId: experiment.id,
        analysisVersion: "cluster-rps-v1",
        resultState: "NEGATIVE",
        dataMaturityAt: new Date(),
        dataHash: "negative-303",
        payloadJson: "{}",
        reportMarkdown: "negative",
      },
    });
    await reconcileBetaEntitlement({
      db,
      merchantId: merchant.id,
      snapshotId: negative.id,
    });
    await reconcileBetaEntitlement({
      db,
      merchantId: merchant.id,
      snapshotId: negative.id,
    });
    const entitlement = await db.betaEntitlement.findUniqueOrThrow({
      where: { merchantId: merchant.id },
    });
    assert.equal(entitlement.status, "FREE_EXTENSION");
    assert.equal(entitlement.revisedExperimentsRemaining, 1);
    assert.ok(entitlement.freeExtensionUntil);
    assert.equal(
      await db.auditLog.count({
        where: {
          merchantId: merchant.id,
          action: "FOUNDING_BETA_RESULT_RECONCILED",
        },
      }),
      1,
    );
  } finally {
    await database.close();
  }
});

test("approval freezes content, evidence, mappings, protocols, safety, and authority", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const { approved, prepared } = await createApprovedPlan(db, "401");
    const approval = JSON.parse(approved.approvalRecordJson ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(approved.state, "WAITING_FOR_THEME");
    assert.equal(approval.planHash, prepared.planHash);
    assert.deepEqual(approval.contentVersionIds, JSON.parse(prepared.contentVersionIdsJson));
    assert.deepEqual(approval.contentHashes, JSON.parse(prepared.contentHashesJson));
    assert.equal(approval.evidenceSnapshotHash, prepared.evidenceSnapshotHash);
    assert.deepEqual(approval.mappingVersions, JSON.parse(prepared.mappingVersionsJson));
    assert.equal(typeof approval.aaProtocolHash, "string");
    assert.equal(typeof approval.realProtocolHash, "string");
    assert.equal(approval.safetyPolicyVersion, prepared.safetyPolicyVersion);
    assert.equal(
      approval.orchestrationProtocolVersion,
      prepared.orchestrationProtocolVersion,
    );
    assert.deepEqual(
      approval.grantedActions,
      JSON.parse(prepared.authorizedTransitionsJson),
    );
  } finally {
    await database.close();
  }
});

test("drift in every frozen authority field invalidates the plan before activation", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const driftCases: Array<{ label: string; data: Record<string, string> }> = [
      { label: "candidate score", data: { candidateScoreSnapshotJson: '{"changed":true}' } },
      { label: "content ids", data: { contentVersionIdsJson: "[]" } },
      { label: "content hashes", data: { contentHashesJson: '["changed"]' } },
      { label: "evidence", data: { evidenceSnapshotHash: "changed" } },
      { label: "mappings", data: { mappingVersionsJson: '[{"changed":true}]' } },
      { label: "unknown traffic", data: { unknownTrafficPolicy: "MATCHED" } },
      { label: "A/A protocol", data: { aaProtocolJson: '{"changed":true}' } },
      { label: "real protocol", data: { realExperimentProtocolJson: '{"changed":true}' } },
      { label: "safety policy", data: { safetyPolicyVersion: "changed" } },
      { label: "transition authority", data: { authorizedTransitionsJson: "{}" } },
      { label: "approval record", data: { approvalRecordJson: "{" } },
      { label: "plan hash", data: { planHash: "f".repeat(64) } },
    ];
    for (const [index, drift] of driftCases.entries()) {
      const fixture = await createApprovedPlan(db, `drift-${index}`);
      await markAutopilotVerifying({
        db,
        merchantId: fixture.merchant.id,
        planId: fixture.approved.id,
        actor: "merchant:test",
        themeActive: true,
      });
      await db.autopilotPlan.update({
        where: { id: fixture.approved.id },
        data: drift.data,
      });
      const result = await advanceAutopilotPlan({
        db,
        merchantId: fixture.merchant.id,
        planId: fixture.approved.id,
      });
      assert.equal(result.outcome, "INVALIDATED", drift.label);
      assert.equal(
        (await db.autopilotPlan.findUniqueOrThrow({ where: { id: fixture.approved.id } })).state,
        "INVALIDATED",
        drift.label,
      );
    }
  } finally {
    await database.close();
  }
});

test("an unpublished theme remains blocked and cannot start A/A", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const fixture = await createApprovedPlan(db, "402");
    const unchanged = await markAutopilotVerifying({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      actor: "merchant:test",
      themeActive: false,
    });
    assert.equal(unchanged.state, "WAITING_FOR_THEME");
    assert.equal(await db.experiment.count({ where: { merchantId: fixture.merchant.id } }), 0);
    assert.equal(
      await db.merchantNotice.count({
        where: {
          merchantId: fixture.merchant.id,
          kind: "THEME_SAVE_REQUIRED",
          status: "OPEN",
        },
      }),
      1,
    );
  } finally {
    await database.close();
  }
});

test("A/A cannot start until every technical gate passes", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const fixture = await createApprovedPlan(db, "403");
    await makeActivationReady(db, fixture.merchant.id, fixture.product.id);
    await db.pilotQaCheck.deleteMany({
      where: { merchantId: fixture.merchant.id, key: PILOT_QA_KEYS[0] },
    });
    await markAutopilotVerifying({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      actor: "merchant:test",
      themeActive: true,
    });
    const blocked = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
    });
    assert.equal(blocked.outcome, "GATES_BLOCKED");
    assert.equal(await db.experiment.count({ where: { merchantId: fixture.merchant.id } }), 0);
  } finally {
    await database.close();
  }
});

test("an early real-test snapshot is never promoted to a final result", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const fixture = await driveToRealTest(db, "404");
    await db.experimentResultSnapshot.create({
      data: {
        experimentId: fixture.realPlan.realExperimentId!,
        analysisVersion: "cluster-rps-v1",
        resultState: "EARLY",
        dataMaturityAt: new Date(Date.now() + 7 * 86_400_000),
        dataHash: "early-404",
        payloadJson: "{}",
        reportMarkdown: "Directional only",
      },
    });
    const result = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
    });
    assert.equal(result.outcome, "REAL_TEST_COLLECTING");
    const current = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: fixture.approved.id },
    });
    assert.equal(current.state, "REAL_TEST_RUNNING");
    assert.equal(current.resultSnapshotId, null);
  } finally {
    await database.close();
  }
});

test("repeated result automation creates one result transition, notice, and entitlement decision", async () => {
  const database = testDatabase();
  const previousBilling = process.env.SHOPIFY_BILLING_ENABLED;
  process.env.SHOPIFY_BILLING_ENABLED = "false";
  try {
    const { db } = database;
    const fixture = await driveToRealTest(db, "405");
    await db.experimentResultSnapshot.create({
      data: {
        experimentId: fixture.realPlan.realExperimentId!,
        analysisVersion: "cluster-rps-v1",
        resultState: "POSITIVE",
        dataMaturityAt: new Date(),
        dataHash: "positive-405",
        payloadJson: "{}",
        reportMarkdown: "Positive mature result",
      },
    });
    const first = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
    });
    const repeated = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
    });
    assert.equal(first.outcome, "RESULT_READY");
    assert.equal(repeated.outcome, "NO_ACTION");
    assert.equal(await db.experiment.count({ where: { merchantId: fixture.merchant.id } }), 2);
    assert.equal(
      await db.autopilotTransition.count({
        where: { planId: fixture.approved.id, toState: "RESULT_READY" },
      }),
      1,
    );
    assert.equal(
      await db.merchantNotice.count({
        where: { merchantId: fixture.merchant.id, kind: "RESULT_READY" },
      }),
      1,
    );
    const reconciliations = await db.auditLog.findMany({
      where: {
        merchantId: fixture.merchant.id,
        action: "FOUNDING_BETA_RESULT_RECONCILED",
      },
    });
    assert.equal(reconciliations.length, 1);
    assert.equal(JSON.parse(reconciliations[0]!.detailsJson).billingEnabled, false);
  } finally {
    if (previousBilling == null) delete process.env.SHOPIFY_BILLING_ENABLED;
    else process.env.SHOPIFY_BILLING_ENABLED = previousBilling;
    await database.close();
  }
});

test("one merchant cannot read or mutate another merchant's plan", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const owner = await createApprovedPlan(db, "406-owner");
    const outsider = await seedOpportunity(db, "406-outsider");
    const outsiderView = await loadAutopilotPresentation({
      db,
      merchantId: outsider.merchant.id,
    });
    assert.equal(outsiderView.plan, null);
    await assert.rejects(
      approveAutopilotPlan({
        db,
        merchantId: outsider.merchant.id,
        planId: owner.approved.id,
        planHash: owner.approved.planHash,
        actor: "merchant:outsider",
        mediumRiskAcknowledged: true,
      }),
      /not found for this store/i,
    );
    await assert.rejects(
      pauseAutopilotPlan({
        db,
        merchantId: outsider.merchant.id,
        planId: owner.approved.id,
        actor: "merchant:outsider",
      }),
      /not found for this store/i,
    );
    assert.equal(
      (await db.autopilotPlan.findUniqueOrThrow({ where: { id: owner.approved.id } })).state,
      "WAITING_FOR_THEME",
    );
  } finally {
    await database.close();
  }
});

test("inconclusive and invalid outcomes preserve free access", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    for (const [index, resultState] of ["INCONCLUSIVE", "INVALID"].entries()) {
      const { merchant, product } = await seedOpportunity(db, `free-${index}`);
      const experiment = await db.experiment.create({
        data: {
          merchantId: merchant.id,
          productId: product.id,
          key: `free-${index}`,
          salt: `salt-${index}`,
          controlPolicy: "ORIGINAL",
          treatmentPolicy: "UNIVERSAL",
        },
      });
      const snapshot = await db.experimentResultSnapshot.create({
        data: {
          experimentId: experiment.id,
          analysisVersion: "cluster-rps-v1",
          resultState,
          dataMaturityAt: new Date(),
          dataHash: `free-result-${index}`,
          payloadJson: "{}",
          reportMarkdown: resultState,
        },
      });
      const entitlement = await reconcileBetaEntitlement({
        db,
        merchantId: merchant.id,
        snapshotId: snapshot.id,
      });
      assert.equal(
        entitlement.status,
        resultState === "INCONCLUSIVE"
          ? "FREE_EXTENSION"
          : "FREE_UNTIL_VALID_RESULT",
      );
      assert.equal(
        entitlement.revisedExperimentsRemaining,
        resultState === "INCONCLUSIVE" ? 1 : 0,
      );
    }
  } finally {
    await database.close();
  }
});

test("uninstall disables runtime, experiments, pixels, sessions, and plan automation", async () => {
  const database = testDatabase();
  try {
    const { db } = database;
    const fixture = await createApprovedPlan(db, "407");
    await makeActivationReady(db, fixture.merchant.id, fixture.product.id);
    const experiment = await db.experiment.create({
      data: {
        merchantId: fixture.merchant.id,
        productId: fixture.product.id,
        key: "uninstall-live",
        salt: "uninstall-salt",
        status: "ACTIVE",
      },
    });
    await db.evaluationConsumption.create({
      data: {
        merchantId: fixture.merchant.id,
        allowanceKey: "MESSAGE_TEST_V1",
        experimentId: experiment.id,
        offerVersion: "founding-beta-v1",
        inputHash: "uninstall-evaluation-input",
      },
    });
    await db.session.create({
      data: {
        id: "offline_uninstall",
        shop: fixture.merchant.shop,
        state: "state",
        accessToken: "test-token",
      },
    });
    await disableMerchantAfterUninstall({
      db,
      merchantId: fixture.merchant.id,
      shop: fixture.merchant.shop,
      shopHash: "shop-hash-407",
      now: new Date("2026-09-04T20:00:00Z"),
    });
    assert.equal(
      (await db.runtimeControl.findUniqueOrThrow({ where: { merchantId: fixture.merchant.id } })).killSwitch,
      true,
    );
    assert.equal((await db.experiment.findUniqueOrThrow({ where: { id: experiment.id } })).status, "PAUSED");
    assert.equal(
      (await db.pixelCredential.findUniqueOrThrow({ where: { merchantId: fixture.merchant.id } })).status,
      "INACTIVE",
    );
    assert.equal(
      (await db.autopilotPlan.findUniqueOrThrow({ where: { id: fixture.approved.id } })).state,
      "INVALIDATED",
    );
    assert.equal(await db.session.count({ where: { shop: fixture.merchant.shop } }), 0);
    assert.equal(
      await db.evaluationConsumption.count({ where: { merchantId: fixture.merchant.id } }),
      1,
      "uninstall must not reset the one-time evaluation allowance",
    );
    assert.equal(
      await db.privacyRequest.count({
        where: { shopHash: "shop-hash-407", requestType: "APP_UNINSTALLED" },
      }),
      1,
    );
    const after = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
    });
    assert.equal(after.outcome, "NO_ACTION");
  } finally {
    await database.close();
  }
});

test("enabling v2 never reinterprets a previously approved legacy plan", async () => {
  const database = testDatabase();
  const previous = process.env.PAGNETIC_V2_ENABLED;
  try {
    delete process.env.PAGNETIC_V2_ENABLED;
    const { db } = database;
    const fixture = await createApprovedPlan(db, "legacy-v2-boundary");
    assert.equal(
      fixture.approved.orchestrationProtocolVersion,
      LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
    );

    // Production approvals created before this discriminator have no copy of
    // the marker in approvalRecordJson. The migration backfills their row as
    // legacy, and that absence must never be interpreted as v2 authority.
    const historicApproval = JSON.parse(
      fixture.approved.approvalRecordJson ?? "{}",
    ) as Record<string, unknown>;
    delete historicApproval.orchestrationProtocolVersion;
    await db.autopilotPlan.update({
      where: { id: fixture.approved.id },
      data: { approvalRecordJson: JSON.stringify(historicApproval) },
    });
    await makeActivationReady(db, fixture.merchant.id, fixture.product.id);
    await markAutopilotVerifying({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      actor: "merchant:legacy-v2-boundary",
      themeActive: true,
    });

    process.env.PAGNETIC_V2_ENABLED = "true";
    const result = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      now: new Date("2026-09-06T12:00:00.000Z"),
    });

    assert.equal(result.outcome, "AA_STARTED");
    const plan = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: fixture.approved.id },
    });
    const experiment = await db.experiment.findUniqueOrThrow({
      where: { id: plan.aaExperimentId! },
      include: { registration: true },
    });
    assert.equal(experiment.lifecycleVersion, 1);
    assert.equal(experiment.registration?.protocolVersion, "autopilot-aa-v1");
    assert.equal(
      await db.deploymentVersion.count({
        where: { merchantId: fixture.merchant.id },
      }),
      0,
    );
    assert.equal(
      await db.activeDeployment.count({
        where: { merchantId: fixture.merchant.id },
      }),
      0,
    );
  } finally {
    if (previous == null) delete process.env.PAGNETIC_V2_ENABLED;
    else process.env.PAGNETIC_V2_ENABLED = previous;
    await database.close();
  }
});

test("v2 plans fail closed while disabled or when their persisted origin contradicts their snapshots", async () => {
  const database = testDatabase();
  const previous = process.env.PAGNETIC_V2_ENABLED;
  const previousShops = process.env.PAGNETIC_V2_ENABLED_SHOPS;
  try {
    process.env.PAGNETIC_V2_ENABLED = "true";
    const { db } = database;
    const disabled = await createApprovedV2Plan(db, "v2-disabled-boundary");

    const notAllowlisted = await advanceAutopilotPlan({
      db,
      merchantId: disabled.merchant.id,
      planId: disabled.approved.id,
    });
    assert.equal(notAllowlisted.outcome, "V2_DISABLED");
    assert.equal(
      await db.experiment.count({ where: { merchantId: disabled.merchant.id } }),
      0,
    );

    process.env.PAGNETIC_V2_ENABLED = "false";
    const disabledResult = await advanceAutopilotPlan({
      db,
      merchantId: disabled.merchant.id,
      planId: disabled.approved.id,
    });
    assert.equal(disabledResult.outcome, "V2_DISABLED");
    assert.equal(
      await db.experiment.count({
        where: { merchantId: disabled.merchant.id },
      }),
      0,
    );
    assert.equal(
      await db.deploymentVersion.count({
        where: { merchantId: disabled.merchant.id },
      }),
      0,
    );

    process.env.PAGNETIC_V2_ENABLED = "true";
    const mismatched = await createApprovedV2Plan(db, "v2-marker-mismatch");
    process.env.PAGNETIC_V2_ENABLED_SHOPS = mismatched.merchant.shop;
    const contradictoryApproval = JSON.parse(
      mismatched.approved.approvalRecordJson ?? "{}",
    ) as Record<string, unknown>;
    contradictoryApproval.orchestrationProtocolVersion =
      LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION;
    await db.autopilotPlan.update({
      where: { id: mismatched.approved.id },
      data: {
        orchestrationProtocolVersion:
          LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        approvalRecordJson: JSON.stringify(contradictoryApproval),
      },
    });
    const mismatchResult = await advanceAutopilotPlan({
      db,
      merchantId: mismatched.merchant.id,
      planId: mismatched.approved.id,
    });
    assert.equal(mismatchResult.outcome, "PROTOCOL_MISMATCH");
    assert.equal(
      await db.experiment.count({
        where: { merchantId: mismatched.merchant.id },
      }),
      0,
    );
    assert.equal(
      await db.deploymentVersion.count({
        where: { merchantId: mismatched.merchant.id },
      }),
      0,
    );
  } finally {
    if (previous == null) delete process.env.PAGNETIC_V2_ENABLED;
    else process.env.PAGNETIC_V2_ENABLED = previous;
    if (previousShops == null) delete process.env.PAGNETIC_V2_ENABLED_SHOPS;
    else process.env.PAGNETIC_V2_ENABLED_SHOPS = previousShops;
    await database.close();
  }
});

test("v2 plan bootstraps Original baseline, freezes qualified message test, and exposes only pinned result", async () => {
  const database = testDatabase();
  const previous = process.env.PAGNETIC_V2_ENABLED;
  const previousShops = process.env.PAGNETIC_V2_ENABLED_SHOPS;
  process.env.PAGNETIC_V2_ENABLED = "true";
  try {
    const { db } = database;
    const fixture = await createApprovedV2Plan(db, "v2-plan");
    process.env.PAGNETIC_V2_ENABLED_SHOPS = fixture.merchant.shop;
    assert.equal(
      fixture.approved.orchestrationProtocolVersion,
      MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
    );
    assert.equal(
      (JSON.parse(fixture.approved.approvalRecordJson ?? "{}") as Record<
        string,
        unknown
      >).orchestrationProtocolVersion,
      MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
    );
    const startedAt = new Date("2026-09-05T00:00:00.000Z");
    await db.pilotRole.create({
      data: {
        merchantId: fixture.merchant.id,
        actorKey: "operator:v2-plan",
        role: "OPERATOR",
        grantedBy: "merchant:v2-plan",
      },
    });
    await makeActivationReady(db, fixture.merchant.id, fixture.product.id);
    await db.themeActivation.update({
      where: { productId: fixture.product.id },
      data: {
        activationTarget: "product",
        detectedAt: startedAt,
        verifiedAt: startedAt,
        verifiedBy: "merchant:v2-plan",
      },
    });
    for (const checkKey of PILOT_QA_KEYS) {
      await recordOperatorV2QaEvidence({
        db,
        merchantId: fixture.merchant.id,
        productId: fixture.product.id,
        checkKey,
        applicability: "APPLICABLE",
        artifactRef: qaArtifactReference(`${checkKey}-integration-v1`),
        artifactBytes: Buffer.from(`integration evidence ${checkKey}`),
        actor: "operator:v2-plan",
        idempotencyKey: `v2-qa:${checkKey}:integration-v1`,
        capturedAt: startedAt,
        now: startedAt,
        environment: { APP_RELEASE: "integration-v2-r1" },
      });
    }
    await markAutopilotVerifying({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      actor: "merchant:v2-plan",
      themeActive: true,
    });
    await releaseSelectedTestStoreV2CutoverHold({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      actor: "merchant:v2-plan",
      now: startedAt,
      environment: { APP_RELEASE: "integration-v2-r1" },
    });
    const baselineStarted = await advanceAutopilotPlan({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      now: startedAt,
    });
    assert.equal(baselineStarted.outcome, "V2_BASELINE_STARTED");
    const baselinePlan = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: fixture.approved.id },
    });
    assert.equal(baselinePlan.state, "AA_RUNNING");
    const baselineExperiment = await db.experiment.findUniqueOrThrow({
      where: { id: baselinePlan.aaExperimentId! },
      include: { registration: true },
    });
    assert.equal(baselineExperiment.lifecycleVersion, 2);
    assert.equal(baselineExperiment.status, "ACTIVE");
    assert.equal(baselineExperiment.controlPolicy, "ORIGINAL");
    assert.equal(baselineExperiment.treatmentPolicy, "ORIGINAL");
    assert.equal(baselineExperiment.registration?.protocolVersion, MVP_V2_PROTOCOL_VERSION);
    assert.equal(baselineExperiment.registration?.primaryMetric, MVP_V2_PRIMARY_METRIC);
    assert.equal(await db.evaluationConsumption.count({
      where: { merchantId: fixture.merchant.id, allowanceKey: "MEASUREMENT_CHECK_V1" },
    }), 1);
    const baselinePointer = await db.activeDeployment.findUniqueOrThrow({
      where: { productId: fixture.product.id },
    });

    const baselineResult = await db.experimentResultSnapshot.create({
      data: {
        experimentId: baselineExperiment.id,
        analysisVersion: "assigned-visitor-welch-v2.3",
        resultState: "MEASUREMENT_CHECKS_PASSED",
        dataMaturityAt: new Date("2026-09-19T00:00:00.000Z"),
        dataHash: "v2-baseline-result-hash",
        payloadJson: "{}",
        reportMarkdown: "Frozen baseline result",
      },
    });
    await db.experiment.update({
      where: { id: baselineExperiment.id },
      data: {
        enrollmentClosedAt: new Date("2026-09-12T00:00:00.000Z"),
        attributionClosesAt: new Date("2026-09-12T00:00:00.000Z"),
        financialMaturityAt: new Date("2026-09-19T00:00:00.000Z"),
        finalizedAt: new Date("2026-09-19T00:00:00.000Z"),
        finalResultSnapshotId: baselineResult.id,
        status: "COMPLETED",
      },
    });
    const qualification = await db.qualificationSnapshot.create({
      data: {
        merchantId: fixture.merchant.id,
        productId: fixture.product.id,
        observationStart: startedAt,
        observationEnd: new Date("2026-09-12T00:00:00.000Z"),
        dataSource: "ORIGINAL_ASSIGNED_VISITOR_IMMUTABLE_FINANCIAL_V2",
        eligibleVisitors: 2_100,
        eligibleSessions: 2_100,
        paidPurchasers: 200,
        revenueMeanMinor: "10",
        revenueVariance: 100,
        currencyCode: "USD",
        coverage: 1,
        targetEffect: .05,
        targetVisitors: 400,
        forecastLowDays: 42,
        forecastHighDays: 55,
        status: "QUALIFIED",
        version: "pagnetic-qualification-v2.3",
        canonicalPayload: "{}",
        snapshotHash: "v2-qualified-snapshot-hash",
      },
    });
    await db.qaEvidence.updateMany({
      where: { merchantId: fixture.merchant.id, productId: fixture.product.id },
      data: { deploymentVersionId: baselinePointer.deploymentVersionId },
    });
    await db.themeActivation.update({
      where: { productId: fixture.product.id },
      data: {
        detectedAt: new Date("2026-09-20T00:00:00.000Z"),
        verifiedAt: new Date("2026-09-20T00:00:00.000Z"),
        verifiedBy: "merchant:v2-plan-message-gate",
      },
    });
    const messageStarted = await advanceAutopilotPlanV2({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      now: new Date("2026-09-20T00:00:00.000Z"),
      snapshotBaseline: async () => ({
        state: "QUALIFIED",
        input: null,
        reasons: [],
        evidence: {
          dataSource: "ORIGINAL_ASSIGNED_VISITOR_IMMUTABLE_FINANCIAL_V2",
          observedDays: 7,
          sourceEvidenceHash: "baseline-evidence-hash",
        },
        snapshot: qualification,
      }),
    });
    assert.equal(messageStarted.outcome, "V2_MESSAGE_TEST_STARTED");
    const messagePlan = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: fixture.approved.id },
    });
    assert.equal(messagePlan.state, "REAL_TEST_RUNNING");
    const messageExperiment = await db.experiment.findUniqueOrThrow({
      where: { id: messagePlan.realExperimentId! },
      include: { registration: true },
    });
    assert.equal(messageExperiment.registration?.targetSampleSize, 400);
    assert.equal(messageExperiment.treatmentPolicy, "UNIVERSAL");
    const frozenContent = JSON.parse(messageExperiment.registration!.contentVersionsJson) as Array<{ id: string; contentHash: string }>;
    assert.equal(frozenContent.length, 1);
    assert.equal(frozenContent[0]?.id, JSON.parse(messagePlan.contentVersionIdsJson)[0]);
    assert.match(messageExperiment.registration!.guardrailsJson, new RegExp(qualification.id));
    assert.equal(await db.evaluationConsumption.count({
      where: { merchantId: fixture.merchant.id, allowanceKey: "MESSAGE_TEST_V1" },
    }), 1);

    const finalResult = await db.experimentResultSnapshot.create({
      data: {
        experimentId: messageExperiment.id,
        analysisVersion: "assigned-visitor-welch-v2.3",
        resultState: "POSITIVE",
        dataMaturityAt: new Date("2026-10-20T00:00:00.000Z"),
        dataHash: "v2-message-result-hash",
        payloadJson: "{}",
        reportMarkdown: "Frozen message result",
      },
    });
    await db.experiment.update({
      where: { id: messageExperiment.id },
      data: {
        enrollmentClosedAt: new Date("2026-10-13T00:00:00.000Z"),
        attributionClosesAt: new Date("2026-10-13T00:00:00.000Z"),
        financialMaturityAt: new Date("2026-10-20T00:00:00.000Z"),
        finalizedAt: new Date("2026-10-20T00:00:00.000Z"),
        finalResultSnapshotId: finalResult.id,
        status: "COMPLETED",
      },
    });
    const ready = await advanceAutopilotPlanV2({
      db,
      merchantId: fixture.merchant.id,
      planId: fixture.approved.id,
      now: new Date("2026-10-21T00:00:00.000Z"),
    });
    assert.equal(ready.outcome, "V2_RESULT_READY");
    const completed = await db.autopilotPlan.findUniqueOrThrow({
      where: { id: fixture.approved.id },
    });
    assert.equal(completed.state, "RESULT_READY");
    assert.equal(completed.resultSnapshotId, finalResult.id);
    assert.equal((await db.activeDeployment.findUniqueOrThrow({
      where: { productId: fixture.product.id },
    })).revision, 2);
  } finally {
    if (previous == null) delete process.env.PAGNETIC_V2_ENABLED;
    else process.env.PAGNETIC_V2_ENABLED = previous;
    if (previousShops == null) delete process.env.PAGNETIC_V2_ENABLED_SHOPS;
    else process.env.PAGNETIC_V2_ENABLED_SHOPS = previousShops;
    await database.close();
  }
});

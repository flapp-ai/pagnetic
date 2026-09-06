import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  advanceAutopilotPlan,
  classifyAutopilotPlanProtocol,
  markAutopilotVerifying,
} from "../app/services/autopilot-orchestrator.server";
import {
  approveAutopilotPlan,
  prepareAutopilotOpportunity,
} from "../app/services/autopilot-preparation.server";
import { loadAutopilotPresentation } from "../app/services/autopilot-presentation.server";
import { hashValue } from "../app/services/governance.server";
import {
  hashPixelToken,
  ingestPixelEvent,
} from "../app/services/measurement.server";
import {
  LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
} from "../app/services/mvp-v2";
import { PILOT_QA_KEYS } from "../app/services/pilot-setup";
import {
  assertSelectedV2CutoverShop,
  beginSelectedTestStoreV2Cutover,
  loadAuthenticatedV2QaEvidenceProgress,
  loadSourceInvalidatedLegacyCutoverCandidate,
  loadV2TestStoreCutoverReceipt,
  recordAuthenticatedV2ThemeEvidence,
  recordOperatorV2QaEvidence,
  releaseSelectedTestStoreV2CutoverHold,
  reviseSelectedTestStoreV2CutoverProduct,
} from "../app/services/test-store-cutover.server";
import { resolveV2Decision } from "../app/services/v2-decision.server";

const BASE = new Date("2026-09-06T10:00:00.000Z");

function artifactReference(label: string) {
  return `qa-artifact:v1:${createHash("sha256").update(label).digest("hex")}`;
}

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-v2-cutover-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((entry) => /^\d/.test(entry))
    .sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(
        path.join("prisma/migrations", migration, "migration.sql"),
      ),
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

async function legacyFixture(db: PrismaClient, suffix: string) {
  const merchant = await db.merchant.create({
    data: { shop: `cutover-${suffix}.myshopify.com` },
  });
  await db.pilotRole.create({
    data: {
      merchantId: merchant.id,
      actorKey: "operator:test",
      role: "OPERATOR",
      grantedBy: "owner:test",
    },
  });
  await db.betaEntitlement.create({ data: { merchantId: merchant.id } });
  await db.acquisitionAngle.create({
    data: {
      merchantId: merchant.id,
      key: "universal",
      label: "Universal",
    },
  });
  const sourceText =
    "Soft recycled knit supports comfortable daily movement. Responsive foam supports steady movement. Durable rubber provides grip on city streets.";
  const sourceSnapshot = JSON.stringify({
    title: "Trail Runner",
    description: sourceText,
    productType: "Shoes",
    status: "ACTIVE",
    templateSuffix: null,
    variants: [{ id: "variant-1", availableForSale: true }],
  });
  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      shopifyProductId: `gid://shopify/Product/${suffix}`,
      title: "Trail Runner",
      handle: `trail-runner-${suffix}`,
      status: "ACTIVE",
      sourceVersion: BASE.toISOString(),
      sourceHash: `source-${suffix}`,
      sourceSnapshot,
      syncedAt: BASE,
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
        verbatimText: sourceText,
        productScope: product.shopifyProductId,
        riskClass: "MEDIUM",
        sourceHash: hashValue(sourceText),
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
  const prepared = await prepareAutopilotOpportunity({
    db,
    merchantId: merchant.id,
    actor: "system:test",
    now: BASE,
  });
  assert.equal(prepared.status, "READY");
  if (prepared.status !== "READY") throw new Error("legacy plan missing");
  const approved = await approveAutopilotPlan({
    db,
    merchantId: merchant.id,
    planId: prepared.plan.id,
    planHash: prepared.plan.planHash,
    mediumRiskAcknowledged: true,
    actor: "owner:test",
    now: new Date(BASE.getTime() + 1_000),
  });
  return { merchant, product, approved };
}

async function cutoverAndPrepare(db: PrismaClient, suffix: string) {
  const legacy = await legacyFixture(db, suffix);
  const originalApproval = legacy.approved.approvalRecordJson;
  const cutover = await beginSelectedTestStoreV2Cutover({
    db,
    merchantId: legacy.merchant.id,
    productId: legacy.product.id,
    legacyPlanId: legacy.approved.id,
    expectedSourceVersion: legacy.product.sourceVersion,
    expectedSourceHash: legacy.product.sourceHash,
    actor: "operator:test",
    idempotencyKey: `cutover:${suffix}`,
    now: new Date(BASE.getTime() + 2_000),
  });
  const prepared = await prepareAutopilotOpportunity({
    db,
    merchantId: legacy.merchant.id,
    actor: "system:test-v2",
    preferredProductId: legacy.product.id,
    cutoverReceiptId: cutover.receipt.id,
    now: new Date(BASE.getTime() + 3_000),
  });
  assert.equal(prepared.status, "READY");
  if (prepared.status !== "READY") throw new Error("v2 plan missing");
  const approved = await approveAutopilotPlan({
    db,
    merchantId: legacy.merchant.id,
    planId: prepared.plan.id,
    planHash: prepared.plan.planHash,
    mediumRiskAcknowledged: true,
    actor: "owner:test-v2",
    now: new Date(BASE.getTime() + 4_000),
  });
  return {
    ...legacy,
    legacyPlan: legacy.approved,
    originalApproval,
    cutover,
    prepared: prepared.plan,
    approved,
  };
}

test("selected-store permission is an exact allowlist rather than a global v2 flag", () => {
  const environment = {
    PAGNETIC_V2_CUTOVER_SHOPS:
      "selected.myshopify.com, second-test.myshopify.com",
  };
  assert.equal(
    assertSelectedV2CutoverShop({
      shop: "SELECTED.myshopify.com",
      environment,
    }),
    "selected.myshopify.com",
  );
  assert.throws(
    () =>
      assertSelectedV2CutoverShop({
        shop: "wrong.myshopify.com",
        environment,
      }),
    /V2_CUTOVER_STORE_NOT_SELECTED/,
  );
  assert.throws(
    () =>
      assertSelectedV2CutoverShop({
        shop: "selected.myshopify.com",
        environment: { PAGNETIC_V2_ENABLED: "true" },
      }),
    /V2_CUTOVER_STORE_NOT_SELECTED/,
  );
});

test("cutover receipt atomically retires only safe legacy authority and preserves its approval and QA registration", async () => {
  const fixture = testDatabase();
  try {
    const legacy = await legacyFixture(fixture.db, "receipt");
    const qa = await fixture.db.experiment.create({
      data: {
        merchantId: legacy.merchant.id,
        productId: legacy.product.id,
        key: "legacy-aa",
        status: "ACTIVE",
        salt: "legacy-aa-salt",
        controlPolicy: "ORIGINAL",
        treatmentPolicy: "ORIGINAL",
        registration: {
          create: {
            protocolVersion: "legacy-aa-v1",
            hypothesis: "legacy",
            primaryMetric: "legacy-rps",
            revenueDefinition: "legacy",
            minimumMeaningfulLift: 0.05,
            alpha: 0.05,
            power: 0.8,
            targetSampleSize: 100,
            minimumDurationDays: 7,
            maximumDurationDays: 14,
            randomizationUnit: "session",
            eligibilityJson: "{}",
            exclusionsJson: "[]",
            covariatesJson: "[]",
            stoppingRule: "fixed",
            analysisVersion: "legacy",
            contentVersionsJson: "[]",
            mappingVersionsJson: "[]",
            guardrailsJson: "{}",
            registrationHash: "legacy-registration-immutable",
          },
        },
      },
      include: { registration: true },
    });
    await fixture.db.autopilotPlan.update({
      where: { id: legacy.approved.id },
      data: { aaExperimentId: qa.id },
    });
    const before = await fixture.db.autopilotPlan.findUniqueOrThrow({
      where: { id: legacy.approved.id },
    });
    const args = {
      db: fixture.db,
      merchantId: legacy.merchant.id,
      productId: legacy.product.id,
      legacyPlanId: legacy.approved.id,
      expectedSourceVersion: legacy.product.sourceVersion,
      expectedSourceHash: legacy.product.sourceHash,
      actor: "operator:test",
      idempotencyKey: "cutover:receipt:fixed",
      now: new Date(BASE.getTime() + 2_000),
    };
    const first = await beginSelectedTestStoreV2Cutover(args);
    const replay = await beginSelectedTestStoreV2Cutover(args);
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.id, first.receipt.id);
    const after = await fixture.db.autopilotPlan.findUniqueOrThrow({
      where: { id: legacy.approved.id },
    });
    assert.equal(after.state, "INVALIDATED");
    assert.equal(after.planHash, before.planHash);
    assert.equal(after.approvalRecordJson, before.approvalRecordJson);
    assert.equal(after.approvedAt?.toISOString(), before.approvedAt?.toISOString());
    assert.equal(
      classifyAutopilotPlanProtocol(after),
      "LEGACY_V1",
    );
    assert.equal(
      (await fixture.db.experiment.findUniqueOrThrow({ where: { id: qa.id } }))
        .status,
      "PAUSED",
    );
    assert.equal(
      (
        await fixture.db.experimentRegistration.findUniqueOrThrow({
          where: { experimentId: qa.id },
        })
      ).registrationHash,
      "legacy-registration-immutable",
    );
    const runtime = await fixture.db.runtimeControl.findUniqueOrThrow({
      where: { merchantId: legacy.merchant.id },
    });
    assert.equal(runtime.killSwitch, true);
    assert.equal(runtime.reason, first.scope.holdReason);
    assert.equal(
      await fixture.db.actionReceipt.count({
        where: { merchantId: legacy.merchant.id },
      }),
      1,
    );
  } finally {
    await fixture.close();
  }
});

test("a fresh-source cutover adopts only the exact prior source-drift invalidation without reviving its approval", async () => {
  const fixture = testDatabase();
  try {
    const legacy = await legacyFixture(fixture.db, "source-invalidated");
    const originalApproval = legacy.approved.approvalRecordJson;
    const originalPlanHash = legacy.approved.planHash;
    await markAutopilotVerifying({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      planId: legacy.approved.id,
      actor: "operator:test",
      themeActive: true,
    });
    const contentIds = JSON.parse(
      legacy.approved.contentVersionIdsJson,
    ) as string[];
    await fixture.db.experienceVersion.updateMany({
      where: { id: { in: contentIds }, merchantId: legacy.merchant.id },
      data: { staleAt: new Date(BASE.getTime() + 2_000) },
    });
    const invalidated = await advanceAutopilotPlan({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      planId: legacy.approved.id,
      now: new Date(BASE.getTime() + 3_000),
    });
    assert.equal(invalidated.outcome, "INVALIDATED");
    const driftTransition = await fixture.db.autopilotTransition.findFirstOrThrow({
      where: {
        merchantId: legacy.merchant.id,
        planId: legacy.approved.id,
        reasonCode: "FROZEN_INPUT_DRIFT",
      },
    });
    assert.deepEqual(
      await loadSourceInvalidatedLegacyCutoverCandidate({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        planId: legacy.approved.id,
      }),
      { transitionId: driftTransition.id },
    );
    const sourceVersion = new Date(BASE.getTime() + 4_000).toISOString();
    const sourceHash = "source-invalidated-current";
    await fixture.db.product.update({
      where: { id: legacy.product.id },
      data: {
        sourceVersion,
        sourceHash,
        syncedAt: new Date(BASE.getTime() + 4_000),
      },
    });
    const cutover = await beginSelectedTestStoreV2Cutover({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      productId: legacy.product.id,
      legacyPlanId: legacy.approved.id,
      expectedSourceVersion: sourceVersion,
      expectedSourceHash: sourceHash,
      actor: "operator:test",
      idempotencyKey: "cutover:source-invalidated:fresh",
      now: new Date(BASE.getTime() + 5_000),
    });
    assert.equal(
      cutover.scope.sourceInvalidationTransitionId,
      driftTransition.id,
    );
    const retained = await fixture.db.autopilotPlan.findUniqueOrThrow({
      where: { id: legacy.approved.id },
    });
    assert.equal(retained.state, "INVALIDATED");
    assert.equal(retained.planHash, originalPlanHash);
    assert.equal(retained.approvalRecordJson, originalApproval);
    assert.equal(
      (
        await fixture.db.merchantNotice.findUniqueOrThrow({
          where: {
            merchantId_dedupeKey: {
              merchantId: legacy.merchant.id,
              dedupeKey: `source-changed:${legacy.approved.id}`,
            },
          },
        })
      ).status,
      "RESOLVED",
    );
    assert.equal(
      await fixture.db.autopilotTransition.count({
        where: {
          planId: legacy.approved.id,
          reasonCode: "V2_TEST_STORE_CUTOVER",
        },
      }),
      0,
    );
    assert.equal(
      await loadSourceInvalidatedLegacyCutoverCandidate({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        planId: legacy.approved.id,
      }),
      null,
    );
    const replay = await beginSelectedTestStoreV2Cutover({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      productId: legacy.product.id,
      legacyPlanId: legacy.approved.id,
      expectedSourceVersion: sourceVersion,
      expectedSourceHash: sourceHash,
      actor: "operator:test",
      idempotencyKey: "cutover:source-invalidated:fresh",
      now: new Date(BASE.getTime() + 6_000),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.id, cutover.receipt.id);
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        productId: legacy.product.id,
        legacyPlanId: legacy.approved.id,
        expectedSourceVersion: sourceVersion,
        expectedSourceHash: sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:source-invalidated:second",
        now: new Date(BASE.getTime() + 6_000),
      }),
      /V2_CUTOVER_ALREADY_RECORDED/,
    );
    await fixture.db.autopilotTransition.update({
      where: { id: driftTransition.id },
      data: { reasonCode: "UNRELATED_INVALIDATION" },
    });
    await assert.rejects(
      loadV2TestStoreCutoverReceipt({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        receiptId: cutover.receipt.id,
      }),
      /V2_CUTOVER_SOURCE_INVALIDATION_HISTORY_MISMATCH/,
    );
  } finally {
    await fixture.close();
  }
});

test("an unrelated invalidation or pre-existing safety hold cannot become source-drift cutover authority", async () => {
  const fixture = testDatabase();
  try {
    const unrelated = await legacyFixture(fixture.db, "unrelated-invalidated");
    await fixture.db.autopilotPlan.update({
      where: { id: unrelated.approved.id },
      data: { state: "INVALIDATED" },
    });
    await fixture.db.autopilotTransition.create({
      data: {
        merchantId: unrelated.merchant.id,
        planId: unrelated.approved.id,
        fromState: unrelated.approved.state,
        toState: "INVALIDATED",
        actorType: "SYSTEM",
        actorId: "system:safety",
        reasonCode: "AUTOMATED_ROLLBACK",
        gateSnapshotHash: "unrelated-safety",
        idempotencyKey: "unrelated-invalidation",
      },
    });
    await fixture.db.merchantNotice.create({
      data: {
        merchantId: unrelated.merchant.id,
        planId: unrelated.approved.id,
        dedupeKey: `source-changed:${unrelated.approved.id}`,
        kind: "SOURCE_CHANGED",
        title: "untrusted lookalike",
        detail: "untrusted lookalike",
      },
    });
    assert.equal(
      await loadSourceInvalidatedLegacyCutoverCandidate({
        db: fixture.db,
        merchantId: unrelated.merchant.id,
        planId: unrelated.approved.id,
      }),
      null,
    );
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: unrelated.merchant.id,
        productId: unrelated.product.id,
        legacyPlanId: unrelated.approved.id,
        expectedSourceVersion: unrelated.product.sourceVersion,
        expectedSourceHash: unrelated.product.sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:unrelated-invalidated",
        now: new Date(BASE.getTime() + 2_000),
      }),
      /V2_CUTOVER_LEGACY_PLAN_ALREADY_RETIRED/,
    );

    const held = await legacyFixture(fixture.db, "source-held");
    await fixture.db.runtimeControl.create({
      data: {
        merchantId: held.merchant.id,
        killSwitch: true,
        reason: "AUTOMATED_ROLLBACK:REAL_INCIDENT",
      },
    });
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: held.merchant.id,
        productId: held.product.id,
        legacyPlanId: held.approved.id,
        expectedSourceVersion: held.product.sourceVersion,
        expectedSourceHash: held.product.sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:held-authority",
        now: new Date(BASE.getTime() + 2_000),
      }),
      /V2_CUTOVER_SAFETY_HOLD_ACTIVE/,
    );
  } finally {
    await fixture.close();
  }
});

test("cutover fails closed for stale source, wrong scope, and an active real experiment", async () => {
  const fixture = testDatabase();
  try {
    const legacy = await legacyFixture(fixture.db, "guards");
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        productId: legacy.product.id,
        legacyPlanId: legacy.approved.id,
        expectedSourceVersion: legacy.product.sourceVersion,
        expectedSourceHash: legacy.product.sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:stale:catalog",
        now: new Date(BASE.getTime() + 16 * 60_000),
      }),
      /V2_CUTOVER_CATALOG_SYNC_STALE/,
    );
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        productId: "foreign-product",
        legacyPlanId: legacy.approved.id,
        expectedSourceVersion: legacy.product.sourceVersion,
        expectedSourceHash: legacy.product.sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:wrong:product",
        now: new Date(BASE.getTime() + 2_000),
      }),
      /V2_CUTOVER_SCOPE_MISMATCH/,
    );
    const conflictingReceipt = await fixture.db.actionReceipt.create({
      data: {
        merchantId: legacy.merchant.id,
        actor: "operator:test",
        action: "OTHER_GOVERNED_ACTION",
        idempotencyKey: "cutover:conflicting:key",
        inputHash: "different-input",
        responseRef: "{}",
      },
    });
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        productId: legacy.product.id,
        legacyPlanId: legacy.approved.id,
        expectedSourceVersion: legacy.product.sourceVersion,
        expectedSourceHash: legacy.product.sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:conflicting:key",
        now: new Date(BASE.getTime() + 2_000),
      }),
      /idempotency key was already used/i,
    );
    await fixture.db.actionReceipt.delete({
      where: { id: conflictingReceipt.id },
    });
    const real = await fixture.db.experiment.create({
      data: {
        merchantId: legacy.merchant.id,
        productId: legacy.product.id,
        key: "legacy-real",
        status: "ACTIVE",
        salt: "legacy-real-salt",
      },
    });
    await fixture.db.autopilotPlan.update({
      where: { id: legacy.approved.id },
      data: { realExperimentId: real.id },
    });
    await assert.rejects(
      beginSelectedTestStoreV2Cutover({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        productId: legacy.product.id,
        legacyPlanId: legacy.approved.id,
        expectedSourceVersion: legacy.product.sourceVersion,
        expectedSourceHash: legacy.product.sourceHash,
        actor: "operator:test",
        idempotencyKey: "cutover:active:real",
        now: new Date(BASE.getTime() + 2_000),
      }),
      /V2_CUTOVER_ACTIVE_REAL_EXPERIMENT/,
    );
    assert.equal(
      (
        await fixture.db.autopilotPlan.findUniqueOrThrow({
          where: { id: legacy.approved.id },
        })
      ).state,
      "WAITING_FOR_THEME",
    );
    assert.equal(
      await fixture.db.actionReceipt.count({
        where: { merchantId: legacy.merchant.id },
      }),
      0,
    );
  } finally {
    await fixture.close();
  }
});

test("a selected product with no current supported opportunity abstains after cutover and keeps Original on", async () => {
  const fixture = testDatabase();
  try {
    const legacy = await legacyFixture(fixture.db, "abstain");
    const currentSource = JSON.stringify({
      title: "Snowboard",
      description: "Awesome!",
      productType: "Snowboard",
      status: "ACTIVE",
      variants: [{ id: "variant-1", availableForSale: true }],
    });
    await fixture.db.product.update({
      where: { id: legacy.product.id },
      data: {
        title: "Snowboard",
        sourceVersion: "2026-09-06T10:00:01.000Z",
        sourceHash: "current-short-source",
        sourceSnapshot: currentSource,
        syncedAt: BASE,
      },
    });
    const cutover = await beginSelectedTestStoreV2Cutover({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      productId: legacy.product.id,
      legacyPlanId: legacy.approved.id,
      expectedSourceVersion: "2026-09-06T10:00:01.000Z",
      expectedSourceHash: "current-short-source",
      actor: "operator:test",
      idempotencyKey: "cutover:abstain:current",
      now: new Date(BASE.getTime() + 1_000),
    });
    const prepared = await prepareAutopilotOpportunity({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      actor: "system:test-v2",
      preferredProductId: legacy.product.id,
      cutoverReceiptId: cutover.receipt.id,
      now: new Date(BASE.getTime() + 2_000),
    });
    assert.equal(prepared.status, "NO_ELIGIBLE_PRODUCT");
    assert.equal(
      await fixture.db.autopilotPlan.count({
        where: {
          merchantId: legacy.merchant.id,
          orchestrationProtocolVersion:
            MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
        },
      }),
      0,
    );
    assert.equal(
      (
        await fixture.db.runtimeControl.findUniqueOrThrow({
          where: { merchantId: legacy.merchant.id },
        })
      ).killSwitch,
      true,
    );
  } finally {
    await fixture.close();
  }
});

test("reviewed v2 protocol can be enabled under the exact cutover hold without exposing treatment", async () => {
  const fixture = testDatabase();
  try {
    const legacy = await legacyFixture(fixture.db, "held-protocol");
    const cutover = await beginSelectedTestStoreV2Cutover({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      productId: legacy.product.id,
      legacyPlanId: legacy.approved.id,
      expectedSourceVersion: legacy.product.sourceVersion,
      expectedSourceHash: legacy.product.sourceHash,
      actor: "operator:test",
      idempotencyKey: "cutover:held:protocol",
      now: new Date(BASE.getTime() + 1_000),
    });
    const request = {
      schemaVersion: 2 as const,
      requestId: "held-protocol-request",
      productId: "gid://shopify/Product/12345",
      visitorToken: "held-protocol-visitor",
      sessionId: "held-protocol-session",
      consent: {
        analytics: true as const,
        preferences: true as const,
        policyVersion: "shopify-consent-v1",
      },
      blockVersion: "adaptive-panel-v2",
    };
    const disabled = await resolveV2Decision({
      db: fixture.db,
      shop: legacy.merchant.shop,
      request,
      environment: {
        PAGNETIC_V2_ENABLED: "false",
        ASSIGNMENT_SECRET: "a".repeat(64),
      },
      now: new Date(BASE.getTime() + 2_000),
    });
    assert.equal(disabled.reason, "V2_DISABLED");
    const held = await resolveV2Decision({
      db: fixture.db,
      shop: legacy.merchant.shop,
      request: { ...request, requestId: "held-protocol-enabled" },
      environment: {
        PAGNETIC_V2_ENABLED: "true",
        ASSIGNMENT_SECRET: "a".repeat(64),
      },
      now: new Date(BASE.getTime() + 3_000),
    });
    assert.equal(held.reason, "KILL_SWITCH_ACTIVE");
    assert.equal(held.serving, "ORIGINAL");
    assert.equal(held.assignmentId, null);
    assert.equal(
      (
        await fixture.db.runtimeControl.findUniqueOrThrow({
          where: { merchantId: legacy.merchant.id },
        })
      ).reason,
      cutover.scope.holdReason,
    );
  } finally {
    await fixture.close();
  }
});

test("an abstained receipt can be superseded by one explicit fresh product scope without rewriting history", async () => {
  const fixture = testDatabase();
  try {
    const legacy = await legacyFixture(fixture.db, "reselect");
    await fixture.db.product.update({
      where: { id: legacy.product.id },
      data: {
        sourceVersion: "2026-09-06T10:00:01.000Z",
        sourceHash: "reselect-old-short",
        sourceSnapshot: JSON.stringify({
          title: "Unsupported",
          description: "Too short",
          status: "ACTIVE",
          variants: [{ id: "old-v", availableForSale: true }],
        }),
        syncedAt: BASE,
      },
    });
    const first = await beginSelectedTestStoreV2Cutover({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      productId: legacy.product.id,
      legacyPlanId: legacy.approved.id,
      expectedSourceVersion: "2026-09-06T10:00:01.000Z",
      expectedSourceHash: "reselect-old-short",
      actor: "operator:test",
      idempotencyKey: "cutover:reselect:initial",
      now: new Date(BASE.getTime() + 1_000),
    });
    assert.equal(
      (
        await prepareAutopilotOpportunity({
          db: fixture.db,
          merchantId: legacy.merchant.id,
          actor: "system:v2",
          preferredProductId: legacy.product.id,
          cutoverReceiptId: first.receipt.id,
          now: new Date(BASE.getTime() + 2_000),
        })
      ).status,
      "NO_ELIGIBLE_PRODUCT",
    );
    const sourceText =
      "Synthetic development-store fixture for Pagnetic QA. No real item is offered or fulfilled.A zip closure keeps small items together.Two internal pockets separate cables and adapters.The rectangular pouch measures 20 cm wide and 12 cm high.A fabric wrist loop provides a carrying point.One pouch is included in each test order.";
    const sourceSnapshot = JSON.stringify({
      title: "Synthetic Travel Pouch",
      description: sourceText,
      productType: "Accessories",
      status: "ACTIVE",
      templateSuffix: null,
      variants: [{ id: "new-v", availableForSale: true }],
    });
    const product = await fixture.db.product.create({
      data: {
        merchantId: legacy.merchant.id,
        shopifyProductId: "gid://shopify/Product/reselect-new",
        title: "Synthetic Travel Pouch",
        handle: "synthetic-travel-pouch",
        status: "ACTIVE",
        sourceVersion: "2026-09-06T10:00:02.000Z",
        sourceHash: "reselect-new-supported",
        sourceSnapshot,
        syncedAt: new Date(BASE.getTime() + 2_000),
      },
    });
    const document = await fixture.db.sourceDocument.create({
      data: {
        merchantId: legacy.merchant.id,
        productId: product.id,
        sourceType: "SHOPIFY_PRODUCT",
        sourceId: `${product.shopifyProductId}:product`,
        sourceVersion: product.sourceVersion,
        payloadJson: sourceSnapshot,
        contentHash: "reselect-new-document",
      },
    });
    await fixture.db.evidenceObject.createMany({
      data: [
        {
          merchantId: legacy.merchant.id,
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
          merchantId: legacy.merchant.id,
          productId: product.id,
          sourceDocumentId: document.id,
          sourceType: "SHOPIFY_PRODUCT_FIELD",
          sourceId: `${product.shopifyProductId}:description`,
          sourceVersion: product.sourceVersion,
          verbatimText: sourceText,
          productScope: product.shopifyProductId,
          riskClass: "MEDIUM",
          sourceHash: hashValue(sourceText),
        },
      ],
    });
    const priorDiagnosis = await fixture.db.messageDiagnosis.create({
      data: {
        merchantId: legacy.merchant.id,
        productId: product.id,
        productRef: product.shopifyProductId,
        sourceVersion: product.sourceVersion,
        mode: "CLARITY_REVIEW",
        gapType: "NO_SUPPORTED_OPPORTUNITY",
        rationale: "The prior rules did not find enough distinct source-backed statements.",
        sourceSpansJson: JSON.stringify({
          sourceSpans: [],
          blockedSpanIds: [],
          findings: [{ code: "INSUFFICIENT_DISTINCT_EVIDENCE" }],
          primary: null,
          alternative: null,
          rulesVersion: "message-diagnosis-v2.1",
          adapterVersion: "deterministic-source-composer-v2.1",
        }),
        status: "NO_SUPPORTED_OPPORTUNITY",
        rulesVersion: "message-diagnosis-v2.1",
        publicLookupHash: hashValue(`prior-abstention:${product.id}`),
      },
    });
    const args = {
      db: fixture.db,
      merchantId: legacy.merchant.id,
      priorReceiptId: first.receipt.id,
      productId: product.id,
      expectedSourceVersion: product.sourceVersion,
      expectedSourceHash: product.sourceHash,
      actor: "operator:test",
      idempotencyKey: "cutover:reselect:new-product",
      now: new Date(BASE.getTime() + 3_000),
    };
    const revised = await reviseSelectedTestStoreV2CutoverProduct(args);
    const replay = await reviseSelectedTestStoreV2CutoverProduct(args);
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.id, revised.receipt.id);
    assert.equal(revised.scope.priorReceiptId, first.receipt.id);
    assert.equal(revised.scope.productId, product.id);
    assert.equal(
      (
        await fixture.db.autopilotPlan.findUniqueOrThrow({
          where: { id: legacy.approved.id },
        })
      ).approvalRecordJson,
      legacy.approved.approvalRecordJson,
    );
    await assert.rejects(
      prepareAutopilotOpportunity({
        db: fixture.db,
        merchantId: legacy.merchant.id,
        actor: "system:stale-receipt",
        preferredProductId: legacy.product.id,
        cutoverReceiptId: first.receipt.id,
        now: new Date(BASE.getTime() + 4_000),
      }),
      /V2_CUTOVER_RECEIPT_SUPERSEDED/,
    );
    const exactFailedJob = await fixture.db.job.create({
      data: {
        merchantId: legacy.merchant.id,
        type: "AUTOPILOT_PREPARATION",
        idempotencyKey: "preparation:exact-prior-failure",
        inputHash: "exact-prior-failure",
        payloadSchemaVersion: 1,
        payloadJson: JSON.stringify({
          shop: legacy.merchant.shop,
          endpoint: "https://pagnetic.example/storefront/events",
          preferredProductId: product.id,
          cutoverReceiptId: revised.receipt.id,
        }),
        status: "DEAD_LETTER",
        attempts: 5,
      },
    });
    const unrelatedFailedJob = await fixture.db.job.create({
      data: {
        merchantId: legacy.merchant.id,
        type: "AUTOPILOT_PREPARATION",
        idempotencyKey: "preparation:unrelated-product",
        inputHash: "unrelated-product",
        payloadSchemaVersion: 1,
        payloadJson: JSON.stringify({
          shop: legacy.merchant.shop,
          endpoint: "https://pagnetic.example/storefront/events",
          preferredProductId: legacy.product.id,
          cutoverReceiptId: first.receipt.id,
        }),
        status: "DEAD_LETTER",
        attempts: 5,
      },
    });
    await fixture.db.merchantNotice.createMany({
      data: [
        {
          merchantId: legacy.merchant.id,
          planId: legacy.approved.id,
          dedupeKey: `activation-blocked:${legacy.approved.id}`,
          kind: "ACTIVATION_BLOCKED",
          title: "Old plan activation is blocked",
          detail: "This notice belongs to the invalidated legacy plan.",
        },
        {
          merchantId: legacy.merchant.id,
          dedupeKey: `unsupported-content:${product.id}`,
          kind: "PREPARATION_FAILED",
          title: "Source-grounded content could not be prepared",
          detail: "Prior deterministic rules abstained.",
        },
        {
          merchantId: legacy.merchant.id,
          dedupeKey: `autopilot-preparation:${exactFailedJob.id}`,
          kind: "PREPARATION_FAILED",
          title: "Pagnetic preparation needs a retry",
          detail: "Prior exact job reached its retry limit.",
          metadataJson: JSON.stringify({ jobId: exactFailedJob.id }),
        },
        {
          merchantId: legacy.merchant.id,
          dedupeKey: `unsupported-content:${legacy.product.id}`,
          kind: "PREPARATION_FAILED",
          title: "Other product remains unsupported",
          detail: "This notice belongs to the retained prior product.",
        },
        {
          merchantId: legacy.merchant.id,
          dedupeKey: `autopilot-preparation:${unrelatedFailedJob.id}`,
          kind: "PREPARATION_FAILED",
          title: "Other product preparation failed",
          detail: "This job belongs to another product and receipt.",
          metadataJson: JSON.stringify({
            jobId: unrelatedFailedJob.id,
            errorCode: "V2_CUTOVER_RECEIPT_SUPERSEDED",
          }),
        },
        {
          merchantId: legacy.merchant.id,
          dedupeKey: "unrelated-safety-review",
          kind: "SAFETY_INCIDENT",
          title: "Unrelated safety review",
          detail: "Preparation must not clear this notice.",
        },
      ],
    });
    const prepared = await prepareAutopilotOpportunity({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      actor: "system:v2",
      preferredProductId: product.id,
      cutoverReceiptId: revised.receipt.id,
      now: new Date(BASE.getTime() + 4_000),
    });
    assert.equal(prepared.status, "READY");
    if (prepared.status !== "READY") throw new Error("reselected plan missing");
    assert.equal(prepared.plan.productId, product.id);
    assert.equal(prepared.plan.cutoverReceiptId, revised.receipt.id);
    assert.equal(
      (
        await fixture.db.merchantNotice.findUniqueOrThrow({
          where: {
            merchantId_dedupeKey: {
              merchantId: legacy.merchant.id,
              dedupeKey: `unsupported-content:${product.id}`,
            },
          },
        })
      ).status,
      "RESOLVED",
    );
    assert.equal(
      (
        await fixture.db.merchantNotice.findUniqueOrThrow({
          where: {
            merchantId_dedupeKey: {
              merchantId: legacy.merchant.id,
              dedupeKey: `autopilot-preparation:${exactFailedJob.id}`,
            },
          },
        })
      ).status,
      "OPEN",
      "an uncompleted prior job remains visible until durable success is recorded",
    );
    for (const dedupeKey of [
      `unsupported-content:${legacy.product.id}`,
      `autopilot-preparation:${unrelatedFailedJob.id}`,
      "unrelated-safety-review",
    ])
      assert.equal(
        (
          await fixture.db.merchantNotice.findUniqueOrThrow({
            where: {
              merchantId_dedupeKey: {
                merchantId: legacy.merchant.id,
                dedupeKey,
              },
            },
          })
        ).status,
        "OPEN",
      );
    const approvedV2 = await approveAutopilotPlan({
      db: fixture.db,
      merchantId: legacy.merchant.id,
      planId: prepared.plan.id,
      planHash: prepared.plan.planHash,
      mediumRiskAcknowledged: true,
      actor: "owner:test-v2",
      now: new Date(BASE.getTime() + 5_000),
    });
    assert.equal(approvedV2.state, "WAITING_FOR_THEME");
    await fixture.db.job.update({
      where: { id: exactFailedJob.id },
      data: {
        status: "COMPLETED",
        resultRef: prepared.plan.id,
        attempts: 0,
        lastErrorCode: null,
      },
    });
    const currentView = await loadAutopilotPresentation({
      db: fixture.db,
      merchantId: legacy.merchant.id,
    });
    assert.equal(
      (
        await fixture.db.merchantNotice.findUniqueOrThrow({
          where: {
            merchantId_dedupeKey: {
              merchantId: legacy.merchant.id,
              dedupeKey: `autopilot-preparation:${exactFailedJob.id}`,
            },
          },
        })
      ).status,
      "RESOLVED",
      "a normal governed presentation read repairs a prior completion crash",
    );
    assert.deepEqual(
      currentView.notices.map((notice) => notice.title),
      ["Save the panel in Shopify", "Unrelated safety review"],
      "only the current plan action and a true safety notice remain actionable",
    );
    assert.deepEqual(
      new Set(currentView.noticeHistory.map((notice) => notice.title)),
      new Set([
        "Old plan activation is blocked",
        "No responsible test path yet",
        "Other product preparation failed",
        "Other product remains unsupported",
        "Save the panel in Shopify",
      ]),
      "superseded workflow notices remain accessible as history",
    );
    const diagnoses = await fixture.db.messageDiagnosis.findMany({
      where: { merchantId: legacy.merchant.id, productId: product.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    assert.equal(diagnoses.length, 2);
    assert.equal(diagnoses[0]?.id, priorDiagnosis.id);
    assert.equal(diagnoses[0]?.status, "NO_SUPPORTED_OPPORTUNITY");
    assert.equal(diagnoses[0]?.rulesVersion, "message-diagnosis-v2.1");
    assert.equal(diagnoses[1]?.rulesVersion, "message-diagnosis-v2.2");
    assert.equal(diagnoses[1]?.status, "EXPERIENCE_DRAFTED");
    const preparedExperience = await fixture.db.experienceVersion.findFirstOrThrow({
      where: {
        merchantId: legacy.merchant.id,
        productId: product.id,
        status: "APPROVED_ACTIVE",
      },
      include: {
        claims: {
          include: { evidenceLinks: { include: { evidence: true } } },
        },
      },
    });
    assert.equal(preparedExperience.provider, "LOCAL_DETERMINISTIC");
    assert.equal(preparedExperience.promptVersion, "deterministic-source-composer-v2.2");
    assert.ok(preparedExperience.claims.length >= 3);
    for (const claim of preparedExperience.claims) {
      assert.ok(
        sourceText.includes(claim.claimText),
        `prepared claim was not an exact Shopify source span: ${claim.claimText}`,
      );
      assert.equal(claim.transformationType, "VERBATIM_SOURCE_SPAN");
      assert.equal(claim.evidenceLinks.length, 1);
      assert.equal(
        claim.evidenceLinks[0]?.evidence.sourceId,
        `${product.shopifyProductId}:description`,
      );
      assert.equal(claim.evidenceLinks[0]?.evidence.verbatimText, sourceText);
    }
    assert.equal(
      (
        await fixture.db.runtimeControl.findUniqueOrThrow({
          where: { merchantId: legacy.merchant.id },
        })
      ).reason,
      revised.scope.holdReason,
    );
    await assert.rejects(
      reviseSelectedTestStoreV2CutoverProduct({
        ...args,
        priorReceiptId: revised.receipt.id,
        productId: legacy.product.id,
        expectedSourceVersion: "2026-09-06T10:00:01.000Z",
        expectedSourceHash: "reselect-old-short",
        idempotencyKey: "cutover:reselect:unsafe-after-plan",
        now: new Date(BASE.getTime() + 5_000),
      }),
      /V2_CUTOVER_PRODUCT_RESELECTION_UNSAFE/,
    );
  } finally {
    await fixture.close();
  }
});

test("v2 preparation and approval are bound to the migration receipt; legacy approval is never reused", async () => {
  const fixture = testDatabase();
  try {
    const result = await cutoverAndPrepare(fixture.db, "fresh-approval");
    assert.notEqual(result.approved.id, result.legacyPlan?.id);
    assert.equal(
      result.approved.orchestrationProtocolVersion,
      MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
    );
    assert.equal(result.approved.cutoverReceiptId, result.cutover.receipt.id);
    const approval = JSON.parse(result.approved.approvalRecordJson ?? "{}") as {
      cutoverReceiptId?: string;
    };
    assert.equal(approval.cutoverReceiptId, result.cutover.receipt.id);
    assert.equal(result.legacyPlan.orchestrationProtocolVersion, LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION);
    assert.equal(result.legacyPlan.approvalRecordJson, result.originalApproval);
    assert.equal(classifyAutopilotPlanProtocol(result.approved), "MVP_V2");
    await fixture.db.product.update({
      where: { id: result.product.id },
      data: { sourceHash: "changed-after-receipt" },
    });
    await assert.rejects(
      prepareAutopilotOpportunity({
        db: fixture.db,
        merchantId: result.merchant.id,
        actor: "system:retry",
        preferredProductId: result.product.id,
        cutoverReceiptId: result.cutover.receipt.id,
      }),
      /V2_CUTOVER_SOURCE_CHANGED/,
    );
  } finally {
    await fixture.close();
  }
});

test("theme evidence requires a current product runtime acknowledgement and cutover hold clears only after every scoped QA record", async () => {
  const fixture = testDatabase();
  try {
    const result = await cutoverAndPrepare(fixture.db, "707");
    const evidenceNow = new Date(BASE.getTime() + 10_000);
    const extensions = [
      {
        type: "theme_app_extension",
        activations: [
          {
            handle: "adaptive-panel",
            status: "active",
            activations: [
              {
                themeId: "gid://shopify/OnlineStoreTheme/77",
                target: "product",
              },
            ],
          },
        ],
      },
    ];
    await assert.rejects(
      recordAuthenticatedV2ThemeEvidence({
        db: fixture.db,
        merchantId: result.merchant.id,
        productId: result.product.id,
        actor: "operator:test",
        extensions,
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      }),
      /V2_PRODUCT_RUNTIME_ACK_REQUIRED/,
    );
    await fixture.db.commerceEvent.create({
      data: {
        merchantId: result.merchant.id,
        eventId: "legacy-runtime-ack",
        source: "STOREFRONT_BRIDGE",
        eventType: "adaptive_storefront_decision",
        occurredAt: evidenceNow,
        receivedAt: evidenceNow,
        productId: result.product.shopifyProductId,
        consentState: "ALLOWED",
        payloadJson: JSON.stringify({
          arm: "ORIGINAL",
          assignmentArm: "ORIGINAL",
          reason: "KILL_SWITCH_ACTIVE",
        }),
      },
    });
    await assert.rejects(
      recordAuthenticatedV2ThemeEvidence({
        db: fixture.db,
        merchantId: result.merchant.id,
        productId: result.product.id,
        actor: "operator:test",
        extensions,
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      }),
      /V2_PRODUCT_RUNTIME_ACK_REQUIRED/,
      "legacy or invented generic consent must not qualify v2 runtime evidence",
    );
    const pixelToken = "v2-theme-runtime-token-at-least-32-characters";
    await fixture.db.pixelCredential.create({
      data: {
        merchantId: result.merchant.id,
        tokenHash: hashPixelToken(pixelToken),
        endpoint: "https://pagnetic.example/storefront/events",
        status: "ACTIVE",
      },
    });
    const ingested = await ingestPixelEvent({
      db: fixture.db,
      now: evidenceNow,
      environment: {
        PAGNETIC_V2_ENABLED: "true",
        ASSIGNMENT_SECRET: "a".repeat(64),
      },
      payload: {
        schemaVersion: 2,
        shop: result.merchant.shop,
        token: pixelToken,
        eventId: "runtime-ack",
        eventType: "adaptive_storefront_decision",
        occurredAt: evidenceNow.toISOString(),
        consentState: "analytics_and_preferences_allowed",
        clientId: "shopify-client-runtime-ack",
        productId: result.product.shopifyProductId,
        data: {
          arm: "ORIGINAL",
          assignmentArm: "ORIGINAL",
          reason: "KILL_SWITCH_ACTIVE",
        },
      },
    });
    assert.equal(ingested.accepted, true);
    assert.equal(ingested.duplicate, false);
    const verified = await recordAuthenticatedV2ThemeEvidence({
      db: fixture.db,
      merchantId: result.merchant.id,
      productId: result.product.id,
      actor: "operator:test",
      extensions,
      now: evidenceNow,
      environment: { APP_RELEASE: "cutover-test-r1" },
    });
    assert.equal(verified.theme.verifiedBy, "operator:test");
    assert.deepEqual(
      verified.evidence.map((item) => item.checkKey).sort(),
      ["original_fallback", "placement"],
    );
    const evidenceProgress = await loadAuthenticatedV2QaEvidenceProgress({
      db: fixture.db,
      merchantId: result.merchant.id,
      planId: result.approved.id,
      now: evidenceNow,
      environment: { APP_RELEASE: "cutover-test-r1" },
    });
    assert.deepEqual(evidenceProgress.acceptedChecks, [
      "placement",
      "original_fallback",
    ]);
    assert.deepEqual(
      evidenceProgress.pendingChecks,
      PILOT_QA_KEYS.filter(
        (key) => !["placement", "original_fallback"].includes(key),
      ),
      "presentation and hold release share the exact seven-check remainder",
    );
    await markAutopilotVerifying({
      db: fixture.db,
      merchantId: result.merchant.id,
      planId: result.approved.id,
      actor: "operator:test",
      themeActive: true,
    });
    await assert.rejects(
      releaseSelectedTestStoreV2CutoverHold({
        db: fixture.db,
        merchantId: result.merchant.id,
        planId: result.approved.id,
        actor: "operator:test",
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      }),
      /V2_CUTOVER_EVIDENCE_INCOMPLETE/,
    );
    const missing = PILOT_QA_KEYS.filter(
      (key) => !["original_fallback", "placement"].includes(key),
    );
    await assert.rejects(
      recordOperatorV2QaEvidence({
        db: fixture.db,
        merchantId: result.merchant.id,
        productId: result.product.id,
        checkKey: "mobile",
        applicability: "APPLICABLE",
        artifactRef: artifactReference("mobile-owner-attempt"),
        artifactBytes: Buffer.from("actual mobile browser capture"),
        actor: "owner:test-v2",
        idempotencyKey: "v2-qa:mobile:owner-attempt",
        capturedAt: evidenceNow,
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      }),
      /V2_QA_OWNER_OR_OPERATOR_ROLE_REQUIRED/,
    );
    await fixture.db.pilotRole.create({
      data: {
        merchantId: result.merchant.id,
        actorKey: "owner:test-v2",
        role: "OWNER",
        grantedBy: "fixture:bootstrap",
      },
    });
    const ownerEvidence = await recordOperatorV2QaEvidence({
      db: fixture.db,
      merchantId: result.merchant.id,
      productId: result.product.id,
      checkKey: "mobile",
      applicability: "APPLICABLE",
      artifactRef: artifactReference("owner-reviewed-mobile"),
      artifactBytes: Buffer.from("actual owner-reviewed mobile browser capture"),
      actor: "owner:test-v2",
      idempotencyKey: "v2-qa:mobile:owner-approved",
      capturedAt: evidenceNow,
      now: evidenceNow,
      environment: { APP_RELEASE: "cutover-test-r1" },
    });
    assert.equal(ownerEvidence.evidence.verifiedBy, "owner:test-v2");
    await fixture.db.pilotRole.update({
      where: { merchantId_actorKey: { merchantId: result.merchant.id, actorKey: "owner:test-v2" } },
      data: { active: false },
    });
    await assert.rejects(recordOperatorV2QaEvidence({
      db: fixture.db,
      merchantId: result.merchant.id,
      productId: result.product.id,
      checkKey: "mobile",
      applicability: "APPLICABLE",
      artifactRef: artifactReference("inactive-owner-mobile"),
      artifactBytes: Buffer.from("actual mobile browser capture"),
      actor: "owner:test-v2",
      idempotencyKey: "v2-qa:mobile:inactive-owner",
      capturedAt: evidenceNow,
      now: evidenceNow,
      environment: { APP_RELEASE: "cutover-test-r1" },
    }), /V2_QA_OWNER_OR_OPERATOR_ROLE_REQUIRED/);
    await assert.rejects(
      recordOperatorV2QaEvidence({
        db: fixture.db,
        merchantId: result.merchant.id,
        productId: result.product.id,
        checkKey: "mobile",
        applicability: "NOT_APPLICABLE",
        artifactRef: artifactReference("mobile-invalid-na"),
        artifactBytes: Buffer.from("actual mobile browser capture"),
        actor: "operator:test",
        idempotencyKey: "v2-qa:mobile:invalid-na",
        capturedAt: evidenceNow,
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      }),
      /V2_QA_APPLICABILITY_INVALID/,
    );
    for (const checkKey of missing) {
      const evidence = await recordOperatorV2QaEvidence({
        db: fixture.db,
        merchantId: result.merchant.id,
        productId: result.product.id,
        checkKey,
        applicability:
          checkKey === "shop_pay" ? "NOT_APPLICABLE" : "APPLICABLE",
        artifactRef: artifactReference(`${checkKey}-private-object-v1`),
        artifactBytes: Buffer.from(`actual captured evidence for ${checkKey}`),
        actor: "operator:test",
        idempotencyKey: `v2-qa:${checkKey}:cutover-test-r1`,
        capturedAt: evidenceNow,
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      });
      const replay = await recordOperatorV2QaEvidence({
        db: fixture.db,
        merchantId: result.merchant.id,
        productId: result.product.id,
        checkKey,
        applicability:
          checkKey === "shop_pay" ? "NOT_APPLICABLE" : "APPLICABLE",
        artifactRef: artifactReference(`${checkKey}-private-object-v1`),
        artifactBytes: Buffer.from(`actual captured evidence for ${checkKey}`),
        actor: "operator:test",
        idempotencyKey: `v2-qa:${checkKey}:cutover-test-r1`,
        capturedAt: evidenceNow,
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      });
      assert.equal(replay.receipt.id, evidence.receipt.id);
      assert.equal(replay.replayed, true);
      if (checkKey === "mobile") {
        const stored = JSON.parse(evidence.receipt.responseRef) as {
          artifactSha256?: string;
          artifactRef?: string;
        };
        assert.equal(
          stored.artifactSha256,
          createHash("sha256")
            .update(Buffer.from(`actual captured evidence for ${checkKey}`))
            .digest("hex"),
        );
        assert.equal(
          stored.artifactRef,
          artifactReference("mobile-private-object-v1"),
        );
        assert.equal(
          evidence.receipt.responseRef.includes("actual captured evidence"),
          false,
        );
        await assert.rejects(
          recordOperatorV2QaEvidence({
            db: fixture.db,
            merchantId: result.merchant.id,
            productId: result.product.id,
            checkKey,
            applicability: "APPLICABLE",
            artifactRef: artifactReference("mobile-private-object-v1"),
            artifactBytes: Buffer.from("different captured bytes"),
            actor: "operator:test",
            idempotencyKey: `v2-qa:${checkKey}:cutover-test-r1`,
            capturedAt: evidenceNow,
            now: evidenceNow,
            environment: { APP_RELEASE: "cutover-test-r1" },
          }),
          /idempotency key was already used/i,
        );
      }
    }
    await fixture.db.runtimeControl.update({
      where: { merchantId: result.merchant.id },
      data: { reason: "AUTOMATED_ROLLBACK:TEST" },
    });
    await assert.rejects(
      releaseSelectedTestStoreV2CutoverHold({
        db: fixture.db,
        merchantId: result.merchant.id,
        planId: result.approved.id,
        actor: "owner:test",
        now: evidenceNow,
        environment: { APP_RELEASE: "cutover-test-r1" },
      }),
      /V2_CUTOVER_SAFETY_HOLD_CHANGED/,
    );
    assert.equal(
      (
        await fixture.db.runtimeControl.findUniqueOrThrow({
          where: { merchantId: result.merchant.id },
        })
      ).killSwitch,
      true,
    );
    await fixture.db.runtimeControl.update({
      where: { merchantId: result.merchant.id },
      data: { reason: result.cutover.scope.holdReason },
    });
    const released = await releaseSelectedTestStoreV2CutoverHold({
      db: fixture.db,
      merchantId: result.merchant.id,
      planId: result.approved.id,
      actor: "owner:test",
      now: evidenceNow,
      environment: { APP_RELEASE: "cutover-test-r1" },
    });
    assert.equal(released.replayed, false);
    const replay = await releaseSelectedTestStoreV2CutoverHold({
      db: fixture.db,
      merchantId: result.merchant.id,
      planId: result.approved.id,
      actor: "owner:test",
      now: evidenceNow,
      environment: { APP_RELEASE: "cutover-test-r1" },
    });
    assert.equal(replay.replayed, true);
    assert.equal(
      (
        await fixture.db.runtimeControl.findUniqueOrThrow({
          where: { merchantId: result.merchant.id },
        })
      ).killSwitch,
      false,
    );
  } finally {
    await fixture.close();
  }
});

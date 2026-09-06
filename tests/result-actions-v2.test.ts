import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  approveExperience,
  hashValue,
} from "../app/services/governance.server";
import { diagnoseProductMessage } from "../app/services/message-diagnosis-v2";
import { createDiagnosisDraftV2 } from "../app/services/message-diagnosis-v2.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../app/services/mvp-v2";
import {
  keepV2Message,
  reviseV2Result,
  stopV2Serving,
} from "../app/services/result-actions-v2.server";
import { installV2Deployment } from "../app/services/v2-deployment.server";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-result-actions-v2-"));
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

async function seedResult(db: PrismaClient, suffix: string, resultState = "POSITIVE") {
  const merchant = await db.merchant.create({
    data: { shop: `result-${suffix}.myshopify.com` },
  });
  const source = {
    title: "Trail Runner",
    description:
      "Soft recycled knit keeps the shoe comfortable from the first step. A responsive foam midsole supports steady movement on city streets and light trails. Durable rubber grip is tested for wet and dry surfaces. Removable insoles and easy-care materials are included.",
    vendor: "Pagnetic Fixture",
    productType: "Shoes",
    sourceVersion: "source-v1",
    productRef: `gid://shopify/Product/${suffix}`,
    locale: "en",
  };
  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      shopifyProductId: source.productRef,
      title: source.title,
      handle: `trail-runner-${suffix}`,
      status: "ACTIVE",
      sourceVersion: source.sourceVersion,
      sourceHash: hashValue(source),
      sourceSnapshot: JSON.stringify(source),
    },
  });
  const document = await db.sourceDocument.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      sourceType: "SHOPIFY_PRODUCT",
      sourceId: source.productRef,
      sourceVersion: source.sourceVersion,
      payloadJson: JSON.stringify(source),
      contentHash: hashValue(source),
    },
  });
  await db.acquisitionAngle.create({
    data: {
      merchantId: merchant.id,
      key: "universal",
      label: "Universal",
      description: "Default source-backed message",
    },
  });
  const diagnosis = diagnoseProductMessage({ source });
  for (const span of diagnosis.sourceSpans) {
    await db.evidenceObject.create({
      data: {
        merchantId: merchant.id,
        productId: product.id,
        sourceDocumentId: document.id,
        sourceType: "SHOPIFY_PRODUCT_FIELD",
        sourceId: span.id,
        sourceVersion: source.sourceVersion,
        verbatimText: span.text,
        productScope: source.productRef,
        merchantStatus: "APPROVED",
        sourceHash: hashValue(span.text),
      },
    });
  }
  const drafted = await createDiagnosisDraftV2({
    db,
    merchantId: merchant.id,
    productId: product.id,
    actor: "merchant:owner",
  });
  assert.ok(drafted.experience);
  await approveExperience({
    db,
    merchantId: merchant.id,
    experienceId: drafted.experience.id,
    actor: "merchant:owner",
  });
  const experience = await db.experienceVersion.findUniqueOrThrow({
    where: { id: drafted.experience.id },
    include: { approval: true },
  });
  const experiment = await db.experiment.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      key: `effect-${suffix}`,
      salt: `salt-${suffix}`,
      controlPolicy: "ORIGINAL",
      treatmentPolicy: "UNIVERSAL",
      status: "COMPLETED",
      lifecycleVersion: 2,
      enrollmentStartedAt: new Date("2026-09-01T00:00:00.000Z"),
      enrollmentClosedAt: new Date("2026-09-08T00:00:00.000Z"),
      attributionClosesAt: new Date("2026-09-15T00:00:00.000Z"),
      financialMaturityAt: new Date("2026-09-22T00:00:00.000Z"),
      finalizedAt: new Date("2026-09-22T00:01:00.000Z"),
      registration: {
        create: {
          protocolVersion: MVP_V2_PROTOCOL_VERSION,
          hypothesis: "A source-backed message changes focal revenue.",
          primaryMetric: MVP_V2_PRIMARY_METRIC,
          revenueDefinition: "NET_FOCAL_MERCHANDISE",
          minimumMeaningfulLift: 0.05,
          alpha: 0.05,
          power: 0.8,
          targetSampleSize: 2_000,
          minimumDurationDays: 7,
          maximumDurationDays: 42,
          randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
          eligibilityJson: "{}",
          exclusionsJson: "[]",
          covariatesJson: "[]",
          stoppingRule: "FIXED_COHORT_V2",
          analysisVersion: "visitor-revenue-v2",
          contentVersionsJson: JSON.stringify([{
            id: experience.id,
            contentHash: experience.contentHash,
          }]),
          mappingVersionsJson: "[]",
          guardrailsJson: "{}",
          registrationHash: hashValue({ suffix }),
        },
      },
    },
  });
  const result = await db.experimentResultSnapshot.create({
    data: {
      experimentId: experiment.id,
      analysisVersion: "visitor-revenue-v2",
      resultState,
      dataMaturityAt: new Date("2026-09-22T00:00:00.000Z"),
      dataHash: hashValue({ resultState, suffix }),
      payloadJson: JSON.stringify({ analysis: { resultState } }),
      reportMarkdown: `# Frozen ${resultState}`,
    },
  });
  await db.experiment.update({
    where: { id: experiment.id },
    data: { finalResultSnapshotId: result.id },
  });
  await db.subscriptionState.create({
    data: {
      merchantId: merchant.id,
      externalSubscriptionIdentity: `gid://shopify/AppSubscription/${suffix}`,
      offerVersion: "pagnetic-core-99-v1",
      authoritativeStatus: "ACTIVE",
      providerShop: merchant.shop,
      providerState: "ACTIVE",
      providerUpdatedAt: new Date("2026-09-22T00:00:00.000Z"),
      providerPayloadHash: hashValue({ active: true, suffix }),
      verifiedAt: new Date("2026-09-22T00:00:00.000Z"),
      periodEnd: new Date("2026-10-22T00:00:00.000Z"),
    },
  });
  const deployment = await installV2Deployment({
    db,
    merchantId: merchant.id,
    productId: product.id,
    experimentId: experiment.id,
    contentVersionId: experience.id,
    policy: "UNIVERSAL",
    approvedAuthorityHash: "a".repeat(64),
    expectedRevision: 0,
    idempotencyKey: `experiment-start-${suffix}`,
  });
  return { merchant, product, experience, experiment, result, deployment };
}

test("keep, revise and stop preserve the frozen report and create exact receipts", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedResult(fixture.db, "701");
    const kept = await keepV2Message({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      resultSnapshotId: seeded.result.id,
      contentVersionId: seeded.experience.id,
      expectedRevision: 1,
      idempotencyKey: "keep-result-701",
      now: new Date("2026-09-22T01:00:00.000Z"),
    });
    assert.equal(kept.pointer.revision, 2);
    assert.equal(kept.deployment.policy, "UNIVERSAL");
    assert.equal(kept.deployment.experimentId, null);
    const keepReplay = await keepV2Message({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      resultSnapshotId: seeded.result.id,
      contentVersionId: seeded.experience.id,
      expectedRevision: 1,
      idempotencyKey: "keep-result-701",
      now: new Date("2026-09-22T01:01:00.000Z"),
    });
    assert.equal(keepReplay.replayed, true);
    assert.equal(keepReplay.deployment.id, kept.deployment.id);

    const revised = await reviseV2Result({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      resultSnapshotId: seeded.result.id,
      reason: "Test a second source-backed framing without changing the old report.",
      idempotencyKey: "revise-result-701",
    });
    assert.equal(revised.experience.status, "DRAFT");
    const reviseReplay = await reviseV2Result({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      resultSnapshotId: seeded.result.id,
      reason: "Test a second source-backed framing without changing the old report.",
      idempotencyKey: "revise-result-701",
    });
    assert.equal(reviseReplay.replayed, true);
    assert.equal(reviseReplay.experience.id, revised.experience.id);

    const stopped = await stopV2Serving({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      deploymentId: kept.deployment.id,
      expectedRevision: 2,
      idempotencyKey: "stop-result-701",
    });
    assert.equal(stopped.pointer.revision, 3);
    assert.equal(stopped.deployment.policy, "ORIGINAL");
    assert.equal(stopped.deployment.state, "STOPPED");
    const stopReplay = await stopV2Serving({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      deploymentId: kept.deployment.id,
      expectedRevision: 2,
      idempotencyKey: "stop-result-701",
    });
    assert.equal(stopReplay.replayed, true);
    assert.equal(stopReplay.deployment.id, stopped.deployment.id);

    const frozen = await fixture.db.experimentResultSnapshot.findUniqueOrThrow({
      where: { id: seeded.result.id },
    });
    assert.equal(frozen.reportMarkdown, "# Frozen POSITIVE");
    assert.equal(
      (await fixture.db.experiment.findUniqueOrThrow({ where: { id: seeded.experiment.id } })).finalResultSnapshotId,
      seeded.result.id,
    );
    assert.equal(await fixture.db.actionReceipt.count({
      where: { merchantId: seeded.merchant.id, action: { in: ["KEEP_V2_MESSAGE", "REVISE_V2_RESULT", "STOP_V2_SERVING"] } },
    }), 3);
  } finally {
    await fixture.close();
  }
});

test("nonpositive or unentitled results cannot silently install a winner", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedResult(fixture.db, "702", "INCONCLUSIVE");
    await assert.rejects(keepV2Message({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      resultSnapshotId: seeded.result.id,
      contentVersionId: seeded.experience.id,
      expectedRevision: 1,
      idempotencyKey: "keep-result-702",
      now: new Date("2026-09-22T01:00:00.000Z"),
    }), /RESULT_NOT_ELIGIBLE_TO_KEEP/);
    await fixture.db.experimentResultSnapshot.update({
      where: { id: seeded.result.id },
      data: { resultState: "POSITIVE" },
    });
    await fixture.db.subscriptionState.update({
      where: { merchantId: seeded.merchant.id },
      data: { authoritativeStatus: "FROZEN" },
    });
    await assert.rejects(keepV2Message({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      actor: "merchant:owner",
      resultSnapshotId: seeded.result.id,
      contentVersionId: seeded.experience.id,
      expectedRevision: 1,
      idempotencyKey: "keep-result-702b",
      now: new Date("2026-09-22T01:00:00.000Z"),
    }), /SUBSCRIPTION_AUTHORITY_REQUIRED/);
    assert.equal((await fixture.db.activeDeployment.findUniqueOrThrow({
      where: { productId: seeded.product.id },
    })).revision, 1);
  } finally {
    await fixture.close();
  }
});

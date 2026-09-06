import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { snapshotOriginalBaselineV2 } from "../app/services/original-baseline-v2.server";
import { normalizeShopifyFinancialSnapshotV2 } from "../app/services/financial-v2";
import { reconcileCanonicalFinancialOrderV2 } from "../app/services/financial-ledger-v2.server";
import { canonicalQueuePayload } from "../app/services/job-outbox.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../app/services/mvp-v2";

const start = new Date("2026-09-01Z");
const end = new Date("2026-09-08Z");
const now = new Date("2026-09-22Z");
const dayMs = 86_400_000;
const secret = "synthetic-baseline-signing-secret-at-least-32-characters";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-original-baseline-"));
  const database = join(directory, "fixture.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const merchant = await db.merchant.create({ data: { shop: "baseline-fixture.myshopify.com" } });
  const product = await db.product.create({ data: { merchantId: merchant.id, shopifyProductId: "gid://shopify/Product/1",
    title: "Fixture", handle: "fixture", status: "ACTIVE", sourceVersion: "1", sourceHash: "source", sourceSnapshot: "{}" } });
  const experiment = await db.experiment.create({ data: { merchantId: merchant.id, productId: product.id,
    key: "baseline-aa", salt: "synthetic", lifecycleVersion: 2, startedAt: start, enrollmentStartedAt: start,
    enrollmentClosedAt: end, attributionClosesAt: new Date("2026-09-14Z"), financialMaturityAt: new Date("2026-09-21Z"),
    status: "ENROLLMENT_CLOSED", controlPolicy: "ORIGINAL", treatmentPolicy: "ORIGINAL",
    registration: { create: { protocolVersion: MVP_V2_PROTOCOL_VERSION, primaryMetric: MVP_V2_PRIMARY_METRIC,
      hypothesis: "Original capture validation", revenueDefinition: "Exact focal merchandise net", minimumMeaningfulLift: .05,
      alpha: .05, power: .8, targetSampleSize: 1_000, minimumDurationDays: 7, maximumDurationDays: 14,
      randomizationUnit: "CONSENTED_PERSISTENT_VISITOR", eligibilityJson: "{}", exclusionsJson: "[]", covariatesJson: "[]",
      stoppingRule: "fixed", analysisVersion: "v2", contentVersionsJson: "[]", mappingVersionsJson: "[]",
      guardrailsJson: "{}", registrationHash: "synthetic-registration" } },
  } });
  const deployment = await db.deploymentVersion.create({ data: { merchantId: merchant.id, productId: product.id,
    experimentId: experiment.id, revision: 1, protocolVersion: MVP_V2_PROTOCOL_VERSION, policy: "ORIGINAL", contentSetHash: "none",
    state: "ACTIVE", approvedAuthorityHash: "synthetic", canonicalPayload: "{}" } });
  const assignedAt = (index: number) => new Date(start.getTime()+(index%7)*dayMs);
  for (let offset = 0; offset < 2_100; offset += 300) {
    const indexes = Array.from({ length: 300 }, (_, index) => offset+index);
    await db.assignment.createMany({ data: indexes.map((index) => ({ id: `a${index}`, merchantId: merchant.id,
      experimentId: experiment.id, randomizationUnitId: `hashed-${index}`, randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
      arm: index%2 ? "MATCHED" : "ORIGINAL", bucket: index%2 ? 6000 : 1000, saltVersion: 1,
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED", assignedAt: assignedAt(index), expiresAt: new Date(assignedAt(index).getTime()+7*dayMs) })) });
    await db.decision.createMany({ data: indexes.map((index) => ({ id: `d${index}`, merchantId: merchant.id,
      productId: product.id, experimentId: experiment.id, assignmentId: `a${index}`, deploymentVersionId: deployment.id,
      deploymentRevision: 1, sessionId: `session-${index}`, visitorId: `hashed-${index}`, arm: index%2 ? "MATCHED" : "ORIGINAL",
      policy: "ORIGINAL", reason: "V2_EXPERIMENT_ASSIGNMENT", consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED", occurredAt: assignedAt(index) })) });
    await db.commerceEvent.createMany({ data: indexes.map((index) => ({ merchantId: merchant.id, eventId: `bridge-${index}`,
      source: "SHOPIFY_PIXEL", eventType: "adaptive_storefront_decision", decisionId: `d${index}`, occurredAt: assignedAt(index),
      productId: product.shopifyProductId, consentState: "analytics_and_preferences_allowed" })) });
  }
  // Production canonical normalization and signature verification, not manually
  // populated money/projection rows. One paid TEST order is excluded, and a
  // repeat order for visitor zero cannot inflate purchaser/checkout visitors.
  for (let index = 0; index <= 201; index += 1) {
    const visitorIndex = index === 201 ? 0 : index;
    const body = Buffer.from(canonicalQueuePayload({ merchantId: merchant.id, productId: product.id, deploymentId: deployment.id,
      experimentId: experiment.id, assignmentId: `a${visitorIndex}`, decisionId: `d${visitorIndex}`, issuedAt: assignedAt(visitorIndex).toISOString(),
      expiresAt: new Date(assignedAt(visitorIndex).getTime()+7*dayMs).toISOString() })).toString("base64url");
    const signed = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
    const createdAt = new Date(assignedAt(visitorIndex).getTime()+3_600_000).toISOString();
    const sourceUpdatedAt = new Date(assignedAt(visitorIndex).getTime()+3_660_000).toISOString();
    const money = { amount: "1.00", currencyCode: "USD" };
    await reconcileCanonicalFinancialOrderV2({ db, merchantId: merchant.id, assignmentSecret: secret,
      order: normalizeShopifyFinancialSnapshotV2({ merchantId: merchant.id, orderId: `gid://shopify/Order/${index + 1}`,
        createdAt, sourceUpdatedAt, observedAt: sourceUpdatedAt, test: index === 200, cancelledAt: null, taxesIncluded: false,
        originalTotalPrice: money, completeness: { lines: true, transactions: true, refunds: true, refundChildren: true, graphQlErrors: false },
        lines: [{ lineId: `gid://shopify/LineItem/${index}`, productId: product.shopifyProductId, variantId: null, giftCardProduct: false,
          sellingPlan: false, originalTotal: money, discountAllocations: [], taxLines: [], signedAssignmentReference: signed }],
        transactions: [{ transactionId: `gid://shopify/OrderTransaction/${index}`, parentId: null, kind: "SALE", status: "SUCCESS",
          test: index === 200, processedAt: createdAt, amount: money }], refunds: [] }) });
  }
  const args = { db, merchantId: merchant.id, productId: product.id, experimentId: experiment.id,
    observationStart: start, observationEnd: end, targetEffect: .5, now };
  return { db, args, async close() { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

test("authoritative original baseline assembles mature signed visitor money, rejects gaps and never invents sessions", async () => {
  const f = await fixture();
  try {
    const immature = await snapshotOriginalBaselineV2({ ...f.args, now: new Date("2026-09-14Z") });
    assert.equal(immature.state, "BASELINE_REQUIRED");
    assert.equal(immature.snapshot, null);
    const result = await snapshotOriginalBaselineV2(f.args);
    assert.equal(result.state, "QUALIFIED");
    assert.equal(result.input, null);
    assert.equal(result.snapshot?.eligibleVisitors, 2_100);
    assert.equal(result.snapshot?.eligibleSessions, 2_100);
    assert.equal(result.snapshot?.paidPurchasers, 200);
    assert.ok(Math.abs(Number(result.snapshot!.revenueMeanMinor)*2_100-20_100) < .000001);
    const canonical = JSON.parse(result.snapshot!.canonicalPayload);
    assert.deepEqual(canonical.dailyEligibleVisitors, Array(7).fill(300));
    assert.equal(canonical.dailyObservableCheckoutVisitors.reduce((sum: number, value: number) => sum+value, 0), 200);
    assert.equal(canonical.visitorRevenueMinor, undefined);
    assert.equal((await snapshotOriginalBaselineV2({ ...f.args, now: new Date("2026-09-23Z") })).snapshot?.id, result.snapshot!.id);
    const confounder = await f.db.confounder.create({ data: { merchantId: f.args.merchantId,
      experimentId: f.args.experimentId, eventType: "PRODUCT_SOURCE_CHANGED", materiality: "MATERIAL",
      summary: "Synthetic source drift", occurredAt: end, recordedBy: "fixture" } });
    assert.ok((await snapshotOriginalBaselineV2(f.args)).reasons.includes("BASELINE_INTEGRITY_REVIEW_REQUIRED"));
    await f.db.confounder.delete({ where: { id: confounder.id } });
    await assert.rejects(snapshotOriginalBaselineV2({ ...f.args, merchantId: "other" }));
    await assert.rejects(snapshotOriginalBaselineV2({ ...f.args, observationStart: new Date("2026-08-31Z") }), /OBSERVATION_SCOPE/);
    await f.db.experiment.update({ where: { id: f.args.experimentId }, data: { treatmentPolicy: "UNIVERSAL" } });
    await assert.rejects(snapshotOriginalBaselineV2(f.args), /ORIGINAL_PROTOCOL/);
    await f.db.experiment.update({ where: { id: f.args.experimentId }, data: { treatmentPolicy: "ORIGINAL" } });
    await f.db.decision.update({ where: { id: "d2099" }, data: { sessionId: "" } });
    assert.ok((await snapshotOriginalBaselineV2(f.args)).reasons.includes("BASELINE_VISITOR_SESSION_AUTHORITY_MISSING"));
    await f.db.decision.update({ where: { id: "d2099" }, data: { sessionId: "session-2099" } });
    await f.db.commerceEvent.deleteMany({ where: { merchantId: f.args.merchantId, eventId: { startsWith: "bridge-1" } } });
    const broken = await snapshotOriginalBaselineV2(f.args);
    assert.equal(broken.state, "PREVIEW_ONLY");
    assert.equal(broken.snapshot, null);
    assert.ok(broken.reasons.includes("BASELINE_CAPTURE_INVALID"));
    await f.db.financialOrderRevision.deleteMany({ where: { merchantId: f.args.merchantId, shopifyOrderId: "gid://shopify/Order/1" } });
    assert.ok((await snapshotOriginalBaselineV2(f.args)).reasons.includes("BASELINE_FINANCIAL_RECONCILIATION_INCOMPLETE"));
  } finally { await f.close(); }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  normalizeShopifyFinancialSnapshotV2,
  type ShopifyFinancialSnapshotV2,
} from "../app/services/financial-v2";
import { reconcileCanonicalFinancialOrderV2 } from "../app/services/financial-ledger-v2.server";
import { canonicalQueuePayload } from "../app/services/job-outbox.server";
import { loadFinancialAsOfV2 } from "../app/services/financial-as-of-v2.server";
import { snapshotV2ExperimentReport } from "../app/services/experiment-report-v2.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../app/services/mvp-v2";

const secret = "adversarial-financial-secret-at-least-32-characters";
const money = (amount: string) => ({ amount, currencyCode: "USD" });
function snapshot(): ShopifyFinancialSnapshotV2 {
  return {
    merchantId: "fixture-merchant",
    orderId: "gid://shopify/Order/1",
    createdAt: "2026-09-05T00:00:00.000Z",
    sourceUpdatedAt: "2026-09-05T00:01:00.000Z",
    observedAt: "2026-09-05T00:02:00.000Z",
    test: false,
    cancelledAt: null,
    taxesIncluded: false,
    originalTotalPrice: money("100.00"),
    completeness: {
      lines: true,
      transactions: true,
      refunds: true,
      refundChildren: true,
      graphQlErrors: false,
    },
    lines: [
      {
        lineId: "gid://shopify/LineItem/1",
        productId: "gid://shopify/Product/1",
        variantId: "gid://shopify/ProductVariant/1",
        giftCardProduct: false,
        sellingPlan: false,
        originalTotal: money("100.00"),
        discountAllocations: [],
        taxLines: [],
        signedAssignmentReference: null,
      },
    ],
    transactions: [
      {
        transactionId: "gid://shopify/OrderTransaction/1",
        parentId: null,
        kind: "SALE",
        status: "SUCCESS",
        test: false,
        processedAt: "2026-09-05T00:00:01.000Z",
        amount: money("100.00"),
      },
    ],
    refunds: [],
  };
}

async function fixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "pagnetic-financial-adversarial-"),
  );
  const database = join(directory, "fixture.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort())
    execFileSync("sqlite3", [database], {
      input: readFileSync(
        join("prisma/migrations", migration, "migration.sql"),
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const merchant = await db.merchant.create({
    data: { id: "fixture-merchant", shop: "adversarial-fixture.myshopify.com" },
  });
  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      shopifyProductId: "gid://shopify/Product/1",
      title: "Shoe",
      handle: "shoe",
      status: "ACTIVE",
      sourceVersion: "1",
      sourceHash: "source",
      sourceSnapshot: "{}",
    },
  });
  const experiment = await db.experiment.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      key: "fixture-effect",
      salt: "fixture-salt",
    },
  });
  const assignment = await db.assignment.create({
    data: {
      merchantId: merchant.id,
      experimentId: experiment.id,
      randomizationUnitId: "fixture-visitor",
      randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
      arm: "MATCHED",
      bucket: 6000,
      saltVersion: 1,
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      assignedAt: new Date("2026-09-04T00:00:00Z"),
      expiresAt: new Date("2026-09-11T00:00:00Z"),
    },
  });
  const deployment = await db.deploymentVersion.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      revision: 1,
      protocolVersion: "pagnetic-effect-v2",
      policy: "UNIVERSAL",
      contentSetHash: "content",
      experimentId: experiment.id,
      state: "ACTIVE",
      approvedAuthorityHash: "authority",
      canonicalPayload: "{}",
    },
  });
  const decision = await db.decision.create({
    data: {
      id: "fixture-decision",
      merchantId: merchant.id,
      productId: product.id,
      experimentId: experiment.id,
      assignmentId: assignment.id,
      deploymentVersionId: deployment.id,
      deploymentRevision: 1,
      sessionId: "fixture-session",
      arm: "MATCHED",
      policy: "UNIVERSAL",
      reason: "V2_EXPERIMENT_ASSIGNMENT",
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      occurredAt: new Date("2026-09-04T12:00:00Z"),
    },
  });
  const payload = {
    merchantId: merchant.id,
    productId: product.id,
    experimentId: experiment.id,
    assignmentId: assignment.id,
    deploymentId: deployment.id,
    decisionId: decision.id,
    issuedAt: decision.occurredAt.toISOString(),
    expiresAt: assignment.expiresAt.toISOString(),
  };
  const sign = (values = payload) => {
    const body = Buffer.from(canonicalQueuePayload(values)).toString(
      "base64url",
    );
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  };
  const source = snapshot();
  source.lines[0].signedAssignmentReference = sign();
  const reconcile = (value: ShopifyFinancialSnapshotV2) =>
    reconcileCanonicalFinancialOrderV2({
      db,
      merchantId: merchant.id,
      assignmentSecret: secret,
      order: normalizeShopifyFinancialSnapshotV2(value),
    });
  return {
    db,
    source,
    reconcile,
    payload,
    sign,
    decision,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("same Shopify source fetched later remains idempotent and retains attributed revenue", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const later = structuredClone(f.source);
    later.observedAt = "2026-09-06T00:00:00.000Z";
    const replay = await f.reconcile(later);
    assert.equal(replay.replayed, true);
    assert.equal(replay.order.reconciliationState, "RECONCILED");
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "10000",
    );
  } finally {
    await f.close();
  }
});

test("immutable financial history keeps stale source facts without changing the latest ledger", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const initial = await f.db.financialOrderRevision.findFirstOrThrow();
    const later = structuredClone(f.source);
    later.sourceUpdatedAt = "2026-09-22T00:00:00Z";
    later.lines[0]!.discountAllocations = [money("20")];
    await f.reconcile(later);
    await f.reconcile({ ...later, observedAt: "2026-09-25T00:00:00Z" });
    assert.equal(await f.db.financialOrderRevision.count(), 2);
    const stale = structuredClone(f.source);
    stale.sourceUpdatedAt = "2026-09-10T00:00:00Z";
    stale.lines[0]!.discountAllocations = [money("10")];
    assert.equal((await f.reconcile(stale)).stale, true);
    assert.equal(await f.db.financialOrderRevision.count(), 3);
    assert.equal((await f.db.financialOrderRevision.findUniqueOrThrow({ where: { id: initial.id } })).canonicalPayload, initial.canonicalPayload);
    const asOf = await loadFinancialAsOfV2({ db: f.db, merchantId: f.payload.merchantId,
      experimentId: f.payload.experimentId, cutoff: new Date("2026-09-20Z") });
    assert.equal(asOf.complete, true);
    assert.equal(asOf.outcomes[0]!.netFocalRevenueMinor, "9000");
    assert.equal((await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor, "8000");
  } finally { await f.close(); }
});

test("a finalized report pins its financial facts and audits later revisions without rewriting", async () => {
  const f = await fixture();
  try {
    await f.db.experiment.update({ where: { id: f.payload.experimentId }, data: {
      lifecycleVersion: 2, controlPolicy: "ORIGINAL", treatmentPolicy: "MATCHED",
      startedAt: new Date("2026-09-01Z"), enrollmentStartedAt: new Date("2026-09-01Z"),
      enrollmentClosedAt: new Date("2026-09-13Z"), attributionClosesAt: new Date("2026-09-13Z"),
      financialMaturityAt: new Date("2026-09-20Z"),
      registration: { create: {
        protocolVersion: MVP_V2_PROTOCOL_VERSION, hypothesis: "Synthetic immutable result",
        primaryMetric: MVP_V2_PRIMARY_METRIC, revenueDefinition: "NET_FOCAL_MERCHANDISE",
        minimumMeaningfulLift: .2, alpha: .05, power: .8, targetSampleSize: 1,
        minimumDurationDays: 14, maximumDurationDays: 42, randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
        eligibilityJson: "{}", exclusionsJson: "[]", covariatesJson: "[]", stoppingRule: "FIXED_COHORT_V2",
        analysisVersion: "welch-assigned-visitor-v2.1", contentVersionsJson: "[]", mappingVersionsJson: "[]",
        guardrailsJson: "{}", dataMaturityLagDays: 7, registrationHash: "frozen-report-fixture",
      } },
    } });
    await f.reconcile(f.source);
    const args = { db: f.db, merchantId: f.payload.merchantId, experimentId: f.payload.experimentId,
      healthState: "READY" as const, now: new Date("2026-09-21Z") };
    const first = await snapshotV2ExperimentReport(args);
    assert.equal(JSON.parse(first.payloadJson).analysis.treatment.netRevenueMinor, "10000");
    const later = structuredClone(f.source);
    later.sourceUpdatedAt = "2026-09-22T00:00:00Z";
    later.lines[0]!.discountAllocations = [money("20")];
    await f.reconcile(later);
    const replay = await snapshotV2ExperimentReport({ ...args, now: new Date("2026-09-23Z") });
    assert.equal(replay.id, first.id);
    assert.equal(replay.payloadJson, first.payloadJson);
    assert.equal(replay.reportMarkdown, first.reportMarkdown);
    assert.equal((await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor, "8000");
    assert.equal(await f.db.auditLog.count({ where: { action: "V2_FINANCIAL_REVISION_AFTER_FINALIZATION" } }), 1);
    await assert.rejects(snapshotV2ExperimentReport({ ...args, merchantId: "other-merchant" }));
  } finally { await f.close(); }
});

test("foreign line currency cannot be relabeled as shop-currency revenue", () => {
  const source = snapshot();
  source.lines[0].originalTotal.currencyCode = "EUR";
  assert.throws(
    () => normalizeShopifyFinancialSnapshotV2(source),
    /CURRENCY_MISMATCH/,
  );
});

test("changed duplicate transaction identities cannot silently select the first amount", () => {
  const source = snapshot();
  source.transactions.push({
    ...source.transactions[0],
    amount: money("50.00"),
  });
  assert.throws(
    () => normalizeShopifyFinancialSnapshotV2(source),
    /CONTRADICTORY_TRANSACTION/,
  );
});

test("gift-card reclassification cannot retain an old active focal attribution", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const changed = structuredClone(f.source);
    changed.sourceUpdatedAt = "2026-09-06T00:00:00.000Z";
    changed.lines[0].giftCardProduct = true;
    await f.reconcile(changed);
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "0",
    );
    assert.notEqual(
      (await f.db.attributionV2.findFirstOrThrow()).status,
      "ACTIVE",
    );
  } finally {
    await f.close();
  }
});

test("a changed product without its signed reference cannot inherit the previous product's attribution", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const changed = structuredClone(f.source);
    changed.sourceUpdatedAt = "2026-09-06T00:00:00.000Z";
    changed.lines[0].productId = "gid://shopify/Product/OTHER";
    changed.lines[0].signedAssignmentReference = null;
    await f.reconcile(changed);
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "0",
    );
    assert.notEqual(
      (await f.db.attributionV2.findFirstOrThrow()).status,
      "ACTIVE",
    );
  } finally {
    await f.close();
  }
});

test("a signed decision issued after purchase cannot attribute that earlier order", async () => {
  const f = await fixture();
  try {
    const issuedAt = "2026-09-05T12:00:00.000Z";
    await f.db.decision.update({
      where: { id: f.decision.id },
      data: { occurredAt: new Date(issuedAt) },
    });
    f.source.lines[0].signedAssignmentReference = f.sign({
      ...f.payload,
      issuedAt,
    });
    const result = await f.reconcile(f.source);
    assert.equal(result.order.reconciliationState, "ATTRIBUTION_CONFLICT");
    assert.equal(
      await f.db.attributionV2.count({ where: { status: "ACTIVE" } }),
      0,
    );
  } finally {
    await f.close();
  }
});

test("a complete retry at the same Shopify watermark repairs an incomplete read", async () => {
  const f = await fixture();
  try {
    const partial = structuredClone(f.source);
    partial.completeness.transactions = false;
    partial.transactions = [];
    assert.equal(
      (await f.reconcile(partial)).order.reconciliationState,
      "PENDING",
    );
    assert.equal(
      (await f.reconcile(f.source)).order.reconciliationState,
      "RECONCILED",
    );
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "10000",
    );
  } finally {
    await f.close();
  }
});

test("a later incomplete read cannot erase previously verified financial evidence", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const partial = structuredClone(f.source);
    partial.completeness.transactions = false;
    partial.transactions = [];
    await f.reconcile(partial);
    assert.equal(
      (await f.db.orderLedger.findFirstOrThrow()).reconciliationState,
      "RECONCILED",
    );
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "10000",
    );
  } finally {
    await f.close();
  }
});

test("a genuinely newer incomplete revision blocks money until its complete retry", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const partial = structuredClone(f.source);
    partial.sourceUpdatedAt = "2026-09-06T00:00:00.000Z";
    partial.completeness.transactions = false;
    partial.transactions = [];
    assert.equal(
      (await f.reconcile(partial)).order.reconciliationState,
      "PENDING",
    );
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "0",
    );
    const full = structuredClone(f.source);
    full.sourceUpdatedAt = partial.sourceUpdatedAt;
    assert.equal(
      (await f.reconcile(full)).order.reconciliationState,
      "RECONCILED",
    );
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "10000",
    );
  } finally {
    await f.close();
  }
});

test("conflicting complete facts stay quarantined until a newer authoritative revision", async () => {
  const f = await fixture();
  try {
    await f.reconcile(f.source);
    const contradictory = structuredClone(f.source);
    contradictory.lines[0].originalTotal = money("80.00");
    contradictory.originalTotalPrice = money("80.00");
    contradictory.transactions[0].amount = money("80.00");
    assert.equal(
      (await f.reconcile(contradictory)).order.reconciliationState,
      "SOURCE_CONFLICT",
    );
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "0",
    );
    assert.equal(
      (await f.reconcile(f.source)).order.reconciliationState,
      "SOURCE_CONFLICT",
    );
    contradictory.sourceUpdatedAt = "2026-09-06T00:00:00.000Z";
    assert.equal(
      (await f.reconcile(contradictory)).order.reconciliationState,
      "RECONCILED",
    );
    assert.equal(
      (await f.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "8000",
    );
  } finally {
    await f.close();
  }
});

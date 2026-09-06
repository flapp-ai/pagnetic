import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  netFocalMerchandiseV2,
  normalizeShopifyFinancialSnapshotV2,
  parseShopMoneyV2,
  type ShopifyFinancialSnapshotV2,
} from "../app/services/financial-v2";
import { acceptFinancialWebhookV2, processFinancialWebhookInboxV2 } from "../app/services/webhook-inbox-v2.server";
import { reconcileCanonicalFinancialOrderV2 } from "../app/services/financial-ledger-v2.server";
import { canonicalQueuePayload } from "../app/services/job-outbox.server";
import { processPrivacyWebhook, privacySecret } from "../app/services/privacy.server";
import { claimCustomerPrivacyRequest } from "../app/services/customer-privacy-queue.server";
import { stagePrivacyOrderSuppression, PrivacyOrderSuppressedError } from "../app/services/order-privacy-guard.server";
import { ingestOrderWebhook } from "../app/services/measurement.server";

const money = (amount: string) => ({ amount, currencyCode: "USD" });

function snapshot(
  overrides: Partial<ShopifyFinancialSnapshotV2> = {},
): ShopifyFinancialSnapshotV2 {
  return {
    merchantId: "merchant_financial_1",
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
        processedAt: "2026-09-05T00:00:30.000Z",
        amount: money("100.00"),
      },
    ],
    refunds: [],
    ...overrides,
  };
}

function refund(
  status = "SUCCESS",
  amounts = ["25.00"],
): ShopifyFinancialSnapshotV2["refunds"][number] {
  return {
    refundId: "gid://shopify/Refund/1",
    sourceUpdatedAt: "2026-09-06T00:00:00.000Z",
    hasUnresolvedAdjustment: false,
    transactions: amounts.map((amount, index) => ({
      transactionId: `gid://shopify/OrderTransaction/refund-${index}`,
      kind: "REFUND",
      status,
      amount: money(amount),
    })),
    lines: [
      {
        refundLineKey: "refund-line-1",
        lineId: "gid://shopify/LineItem/1",
        merchandise: money("25.00"),
        tax: money("0.00"),
      },
    ],
  };
}

test("minor money parsing is exact and rejects unsupported precision", () => {
  assert.deepEqual(parseShopMoneyV2(money("12.30")), {
    minor: "1230",
    currency: "USD",
  });
  assert.throws(() => parseShopMoneyV2(money("1e2")), /INVALID_MONEY_DECIMAL/);
  assert.throws(() => parseShopMoneyV2(money("1.001")), /INVALID_MONEY_DECIMAL/);
  assert.throws(
    () => parseShopMoneyV2({ amount: "1.00", currencyCode: "BTC" }),
    /UNSUPPORTED_CURRENCY/,
  );
});

test("basic paid and allocated-discount focal merchandise are exact", () => {
  const basic = normalizeShopifyFinancialSnapshotV2(snapshot());
  assert.equal(basic.paymentState, "CAPTURED");
  assert.equal(basic.reconciliationState, "RECONCILED");
  assert.equal(
    netFocalMerchandiseV2(basic, "gid://shopify/Product/1")?.minor,
    "10000",
  );
  const discounted = normalizeShopifyFinancialSnapshotV2(
    snapshot({
      originalTotalPrice: money("85.00"),
      transactions: [{ ...snapshot().transactions[0], amount: money("85.00") }],
      lines: [{
        ...snapshot().lines[0],
        discountAllocations: [money("10.00"), money("5.00")],
      }],
    }),
  );
  assert.equal(
    netFocalMerchandiseV2(discounted, "gid://shopify/Product/1")?.minor,
    "8500",
  );
});

test("authorization, partial capture and test orders never become live revenue", () => {
  const authorization = normalizeShopifyFinancialSnapshotV2(snapshot({
    transactions: [{ ...snapshot().transactions[0], kind: "AUTHORIZATION" }],
  }));
  assert.equal(authorization.paymentState, "UNPAID");
  assert.equal(netFocalMerchandiseV2(authorization, "gid://shopify/Product/1"), null);
  const partial = normalizeShopifyFinancialSnapshotV2(snapshot({
    transactions: [{ ...snapshot().transactions[0], amount: money("40.00") }],
  }));
  assert.equal(partial.paymentState, "PARTIAL");
  assert.ok(partial.unresolvedReasons.includes("PARTIAL_PAYMENT"));
  const qa = normalizeShopifyFinancialSnapshotV2(snapshot({ test: true }));
  assert.equal(qa.reconciliationState, "TEST_ONLY");
  assert.equal(netFocalMerchandiseV2(qa, "gid://shopify/Product/1"), null);
  const cancelledPaid = normalizeShopifyFinancialSnapshotV2(snapshot({
    cancelledAt: "2026-09-05T00:01:30.000Z",
  }));
  assert.equal(cancelledPaid.reconciliationState, "PENDING");
  assert.ok(cancelledPaid.unresolvedReasons.includes(
    "CANCELLED_CAPTURE_PENDING_RECONCILIATION",
  ));
  const cancelledRefunded = normalizeShopifyFinancialSnapshotV2(snapshot({
    cancelledAt: "2026-09-05T00:01:30.000Z",
    refunds: [refund()],
  }));
  assert.equal(cancelledRefunded.reconciliationState, "RECONCILED");
});

test("settled refunds deduct merchandise once while pending and split coverage stay explicit", () => {
  const settled = normalizeShopifyFinancialSnapshotV2(snapshot({ refunds: [refund()] }));
  assert.equal(
    netFocalMerchandiseV2(settled, "gid://shopify/Product/1")?.minor,
    "7500",
  );
  const pending = normalizeShopifyFinancialSnapshotV2(
    snapshot({ refunds: [refund("PENDING")] }),
  );
  assert.equal(pending.reconciliationState, "PENDING");
  assert.ok(pending.unresolvedReasons.includes("REFUND_PENDING"));
  const split = normalizeShopifyFinancialSnapshotV2(
    snapshot({ refunds: [refund("SUCCESS", ["10.00", "15.00"])] }),
  );
  assert.equal(
    netFocalMerchandiseV2(split, "gid://shopify/Product/1")?.minor,
    "7500",
  );
});

test("mixed cart, gift-card product and incomplete reads cannot inflate focal revenue", () => {
  const mixed = normalizeShopifyFinancialSnapshotV2(snapshot({
    originalTotalPrice: money("170.00"),
    transactions: [{ ...snapshot().transactions[0], amount: money("170.00") }],
    lines: [
      snapshot().lines[0],
      { ...snapshot().lines[0], lineId: "gid://shopify/LineItem/2", productId: "gid://shopify/Product/2", originalTotal: money("50.00") },
      { ...snapshot().lines[0], lineId: "gid://shopify/LineItem/3", giftCardProduct: true, originalTotal: money("20.00") },
    ],
  }));
  assert.equal(
    netFocalMerchandiseV2(mixed, "gid://shopify/Product/1")?.minor,
    "10000",
  );
  const incomplete = normalizeShopifyFinancialSnapshotV2(snapshot({
    completeness: { ...snapshot().completeness, refundChildren: false },
  }));
  assert.equal(incomplete.reconciliationState, "PENDING");
  assert.ok(incomplete.unresolvedReasons.includes("SOURCE_INCOMPLETE"));
});

test("tax-inclusive refunds remain blocked until the Shopify basis is verified", () => {
  const source = snapshot({
    taxesIncluded: true,
    originalTotalPrice: money("120.00"),
    transactions: [{ ...snapshot().transactions[0], amount: money("120.00") }],
    lines: [{ ...snapshot().lines[0], originalTotal: money("120.00"), taxLines: [money("20.00")] }],
    refunds: [{
      ...refund("SUCCESS", ["60.00"]),
      lines: [{ ...refund().lines[0], merchandise: money("50.00"), tax: money("10.00") }],
    }],
  });
  const blocked = normalizeShopifyFinancialSnapshotV2(source);
  assert.ok(blocked.unresolvedReasons.includes("TAX_BASIS_UNVERIFIED"));
  const verified = normalizeShopifyFinancialSnapshotV2({
    ...source,
    taxInclusiveRefundBasisVerified: true,
  });
  assert.equal(
    netFocalMerchandiseV2(verified, "gid://shopify/Product/1")?.minor,
    "5000",
  );
});

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-inbox-v2-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return { db, async close() { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

test("privacy suppression blocks delayed canonical fetch, replay and legacy writes without touching another store", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({ data: { shop: "suppression.myshopify.com" } });
    const other = await fixture.db.merchant.create({ data: { shop: "suppression-other.myshopify.com" } });
    const scopeSecret = "synthetic-field-key-at-least-32-bytes";
    const assignmentSecret = "synthetic-assignment-key-at-least-32-bytes";
    const accepted = await acceptFinancialWebhookV2({ db: fixture.db, shop: merchant.shop,
      topic: "ORDERS_CREATE", shopifyEventId: "delayed-order", payload: { id: 123 } });
    const now = new Date();
    let releaseFetch!: (value: ShopifyFinancialSnapshotV2) => void;
    let fetchStarted!: () => void;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    const fetched = new Promise<ShopifyFinancialSnapshotV2>((resolve) => { releaseFetch = resolve; });
    const processing = processFinancialWebhookInboxV2({ db: fixture.db, merchantId: merchant.id,
      inboxId: accepted.inbox.id, assignmentSecret, now,
      fetchOrder: async () => { fetchStarted(); return fetched; } });
    await started;
    await processPrivacyWebhook({ db: fixture.db, shop: merchant.shop, type: "CUSTOMERS_REDACT",
      payload: { orders_to_redact: [123] }, secret: privacySecret(), scopeSecret, now });
    const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(lease);
    assert.deepEqual(await stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret: privacySecret(), now }),
      { staged: 1, nextOffset: 1, allScopeStaged: true });
    releaseFetch(snapshot({ merchantId: merchant.id, orderId: "gid://shopify/Order/123" }));
    const result = await processing;
    assert.ok("suppressed" in result && result.suppressed);
    assert.equal(await fixture.db.financialOrderRevision.count(), 0);
    assert.equal(await fixture.db.orderLedger.count(), 0);
    assert.equal((await fixture.db.webhookInbox.findUniqueOrThrow({ where: { id: accepted.inbox.id } })).payloadJson, "{}");
    for (const eventId of ["delayed-order", "replayed-new-id"]) await assert.rejects(
      acceptFinancialWebhookV2({ db: fixture.db, shop: merchant.shop, topic: "ORDERS_CREATE",
        shopifyEventId: eventId, payload: { id: 123 } }), PrivacyOrderSuppressedError);
    assert.equal(await ingestOrderWebhook({ db: fixture.db, shop: merchant.shop, topic: "ORDERS_CREATE",
      webhookId: "legacy-replay", payload: { id: 123, total_price: "10", currency: "USD" } }), null);
    assert.equal(await fixture.db.storeOrder.count(), 0);
    const unaffected = await acceptFinancialWebhookV2({ db: fixture.db, shop: other.shop,
      topic: "ORDERS_CREATE", shopifyEventId: "other-store", payload: { id: 123 } });
    assert.equal(unaffected.inbox.merchantId, other.id);
    await fixture.db.merchant.delete({ where: { id: merchant.id } });
    const reinstalled = await fixture.db.merchant.create({ data: { shop: merchant.shop } });
    assert.notEqual(reinstalled.id, merchant.id);
    assert.equal(await fixture.db.privacyOrderSuppression.count(), 1);
    await assert.rejects(acceptFinancialWebhookV2({ db: fixture.db, shop: reinstalled.shop,
      topic: "ORDERS_CREATE", shopifyEventId: "reinstall-replay", payload: { id: 123 } }), PrivacyOrderSuppressedError);
  } finally { await fixture.close(); }
});

test("authenticated financial webhook acceptance is durable, sanitized and idempotent", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({ data: { shop: "inbox-v2.myshopify.com" } });
    const payload = {
      id: 123,
      admin_graphql_api_id: "gid://shopify/Order/123",
      updated_at: "2026-09-05T00:00:00.000Z",
      email: "must-not-persist@example.com",
      shipping_address: { name: "Must not persist" },
    };
    const first = await acceptFinancialWebhookV2({
      db: fixture.db,
      shop: merchant.shop,
      topic: "orders/create",
      shopifyEventId: "webhook-event-1",
      payload,
    });
    const replay = await acceptFinancialWebhookV2({
      db: fixture.db,
      shop: merchant.shop,
      topic: "orders/create",
      shopifyEventId: "webhook-event-1",
      payload,
    });
    assert.equal(first.duplicate, false);
    assert.equal(replay.duplicate, true);
    assert.equal(await fixture.db.webhookInbox.count(), 1);
    assert.equal(await fixture.db.job.count(), 1);
    const stored = await fixture.db.webhookInbox.findFirstOrThrow();
    assert.doesNotMatch(stored.payloadJson, /email|shipping|Must not persist/);
    assert.match(stored.payloadJson, /gid:\/\/shopify\/Order\/123/);
  } finally { await fixture.close(); }
});

test("inbox processing fetches the parent durably and exposes failures for retry", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({ data: { shop: "process-inbox-v2.myshopify.com" } });
    const accepted = await acceptFinancialWebhookV2({
      db: fixture.db,
      shop: merchant.shop,
      topic: "refunds/create",
      shopifyEventId: "refund-webhook-1",
      payload: {
        id: 44,
        order_id: 123,
        processed_at: "2026-09-05T00:00:00.000Z",
        note: "must not persist",
      },
    });
    const source = snapshot({
      merchantId: merchant.id,
      orderId: "gid://shopify/Order/123",
      refunds: [refund()],
    });
    const processed = await processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: "inbox-processing-secret-that-is-at-least-32-characters",
      fetchOrder: async () => source,
      now: new Date("2099-01-01T00:00:00.000Z"),
    });
    assert.equal(processed.duplicate, false);
    assert.equal((await fixture.db.webhookInbox.findFirstOrThrow()).processingState, "PROCESSED");
    assert.equal(await fixture.db.orderLedger.count(), 1);
    assert.equal(await fixture.db.refundLedger.count(), 1);

    const failed = await acceptFinancialWebhookV2({
      db: fixture.db,
      shop: merchant.shop,
      topic: "orders/updated",
      shopifyEventId: "order-webhook-failure",
      payload: { id: 999, updated_at: "2026-09-05T00:00:00.000Z" },
    });
    await assert.rejects(processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: failed.inbox.id,
      assignmentSecret: "inbox-processing-secret-that-is-at-least-32-characters",
      fetchOrder: async () => { throw new Error("SHOPIFY_FETCH_FAILED"); },
      now: new Date("2099-01-01T00:00:00.000Z"),
    }), /SHOPIFY_FETCH_FAILED/);
    const retry = await fixture.db.webhookInbox.findUniqueOrThrow({ where: { id: failed.inbox.id } });
    assert.equal(retry.processingState, "RETRY");
    assert.equal(retry.lastErrorCode, "SHOPIFY_FETCH_FAILED");
  } finally { await fixture.close(); }
});

test("v2 money survives a real database roundtrip above PostgreSQL INTEGER32", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "large-money-v2.myshopify.com" },
    });
    const large = normalizeShopifyFinancialSnapshotV2(snapshot({
      merchantId: merchant.id,
      originalTotalPrice: money("30000000.00"),
      lines: [{ ...snapshot().lines[0], originalTotal: money("30000000.00") }],
      transactions: [{ ...snapshot().transactions[0], amount: money("30000000.00") }],
    }));
    assert.equal(large.originalObligation.minor, "3000000000");
    await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: large,
      assignmentSecret: "large-money-secret-that-is-at-least-32-characters",
    });
    const stored = await fixture.db.orderLedger.findFirstOrThrow({
      include: { lines: true },
    });
    assert.equal(stored.originalObligationMinor, "3000000000");
    assert.equal(stored.lines[0]?.merchandiseAfterDiscountMinor, "3000000000");
  } finally { await fixture.close(); }
});

function signReference(payload: Record<string, string>, secret: string) {
  const body = Buffer.from(canonicalQueuePayload(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

test("canonical ledger attributes only a signed focal line and rebuilds refunds idempotently", async () => {
  const fixture = testDatabase();
  const secret = "financial-test-secret-that-is-longer-than-32-characters";
  try {
    const merchant = await fixture.db.merchant.create({ data: { shop: "ledger-v2.myshopify.com" } });
    const product = await fixture.db.product.create({ data: {
      merchantId: merchant.id,
      shopifyProductId: "gid://shopify/Product/1",
      title: "Focal product",
      handle: "focal-product",
      status: "ACTIVE",
      sourceVersion: "source-v1",
      sourceHash: "source-hash",
      sourceSnapshot: "{}",
    } });
    const experiment = await fixture.db.experiment.create({ data: {
      merchantId: merchant.id,
      productId: product.id,
      key: "financial-effect",
      salt: "financial-salt",
      enrollmentStartedAt: new Date("2026-09-01T00:00:00.000Z"),
    } });
    const assignment = await fixture.db.assignment.create({ data: {
      merchantId: merchant.id,
      experimentId: experiment.id,
      randomizationUnitId: "visitor-hash",
      randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
      visitorHash: "visitor-hash",
      arm: "MATCHED",
      bucket: 9000,
      saltVersion: 1,
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      assignedAt: new Date("2026-09-01T00:00:00.000Z"),
      expiresAt: new Date("2026-09-08T00:00:00.000Z"),
    } });
    const deployment = await fixture.db.deploymentVersion.create({ data: {
      merchantId: merchant.id,
      productId: product.id,
      revision: 1,
      protocolVersion: "pagnetic-effect-v2",
      policy: "UNIVERSAL",
      contentSetHash: "content-hash",
      experimentId: experiment.id,
      state: "ACTIVE",
      approvedAuthorityHash: "authority-hash",
      canonicalPayload: "{}",
    } });
    const decision = await fixture.db.decision.create({ data: {
      id: "decision-financial-1",
      merchantId: merchant.id,
      experimentId: experiment.id,
      assignmentId: assignment.id,
      productId: product.id,
      sessionId: "session-hash",
      visitorId: "visitor-hash",
      arm: "MATCHED",
      policy: "UNIVERSAL",
      reason: "V2_EXPERIMENT_ASSIGNMENT",
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      deploymentVersionId: deployment.id,
      deploymentRevision: 1,
    } });
    const reference = signReference({
      merchantId: merchant.id,
      productId: product.id,
      deploymentId: deployment.id,
      experimentId: experiment.id,
      assignmentId: assignment.id,
      decisionId: decision.id,
      issuedAt: decision.occurredAt.toISOString(),
      expiresAt: assignment.expiresAt.toISOString(),
    }, secret);
    const paidSource = snapshot({
      merchantId: merchant.id,
      lines: [
        { ...snapshot().lines[0], signedAssignmentReference: reference },
        { ...snapshot().lines[0], lineId: "gid://shopify/LineItem/other", productId: "gid://shopify/Product/2", originalTotal: money("50.00"), signedAssignmentReference: null },
      ],
      originalTotalPrice: money("150.00"),
      transactions: [{ ...snapshot().transactions[0], amount: money("150.00") }],
    });
    const paid = normalizeShopifyFinancialSnapshotV2(paidSource);
    const first = await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: paid,
      assignmentSecret: secret,
    });
    const replay = await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: paid,
      assignmentSecret: secret,
    });
    assert.equal(first.conflicts.length, 0);
    assert.equal(replay.replayed, true);
    assert.equal(await fixture.db.orderLedger.count(), 1);
    assert.equal(await fixture.db.orderLedgerLine.count(), 2);
    assert.equal(await fixture.db.attributionV2.count(), 1);
    assert.equal((await fixture.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor, "10000");

    const refunded = normalizeShopifyFinancialSnapshotV2({
      ...paidSource,
      sourceUpdatedAt: "2026-09-06T00:00:00.000Z",
      observedAt: "2026-09-06T00:01:00.000Z",
      refunds: [refund()],
    });
    await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: refunded,
      assignmentSecret: secret,
    });
    assert.equal(await fixture.db.refundLedger.count(), 1);
    assert.equal((await fixture.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor, "7500");

    const corrected = normalizeShopifyFinancialSnapshotV2({
      ...paidSource,
      sourceUpdatedAt: "2026-09-07T00:00:00.000Z",
      observedAt: "2026-09-07T00:01:00.000Z",
      refunds: [],
    });
    await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: corrected,
      assignmentSecret: secret,
    });
    assert.equal(
      (await fixture.db.refundLedger.findFirstOrThrow()).allocationState,
      "SUPERSEDED",
    );
    assert.equal(
      (await fixture.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "10000",
    );

    const lateReceipt = normalizeShopifyFinancialSnapshotV2(snapshot({
      merchantId: merchant.id,
      orderId: "gid://shopify/Order/9001",
      createdAt: "2026-09-07T23:59:59.999Z",
      sourceUpdatedAt: "2026-09-09T00:00:00.000Z",
      observedAt: "2026-09-09T00:01:00.000Z",
      lines: [{ ...snapshot().lines[0], signedAssignmentReference: reference }],
    }));
    await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: lateReceipt,
      assignmentSecret: secret,
    });
    assert.equal(await fixture.db.attributionV2.count(), 2);
    assert.equal(
      (await fixture.db.visitorOutcome.findFirstOrThrow()).netFocalRevenueMinor,
      "20000",
    );

    const expiredPurchase = normalizeShopifyFinancialSnapshotV2(snapshot({
      merchantId: merchant.id,
      orderId: "gid://shopify/Order/9002",
      createdAt: assignment.expiresAt.toISOString(),
      sourceUpdatedAt: "2026-09-08T00:01:00.000Z",
      observedAt: "2026-09-09T00:00:00.000Z",
      lines: [{ ...snapshot().lines[0], signedAssignmentReference: reference }],
    }));
    const expiredResult = await reconcileCanonicalFinancialOrderV2({
      db: fixture.db,
      merchantId: merchant.id,
      order: expiredPurchase,
      assignmentSecret: secret,
    });
    assert.deepEqual(expiredResult.conflicts, [
      "INVALID_REFERENCE:gid://shopify/LineItem/1",
    ]);
    assert.equal(expiredResult.order.reconciliationState, "ATTRIBUTION_CONFLICT");
    assert.equal(await fixture.db.attributionV2.count(), 2);
  } finally { await fixture.close(); }
});

test("expired, cross-tenant and tampered line references never create attribution", async () => {
  const fixture = testDatabase();
  const secret = "financial-test-secret-that-is-longer-than-32-characters";
  try {
    const merchant = await fixture.db.merchant.create({ data: { shop: "invalid-ref-v2.myshopify.com" } });
    for (const [index, reference] of ["tampered.reference", signReference({
      merchantId: "another-merchant",
      productId: "another-product",
      deploymentId: "another-deployment",
      experimentId: "another-experiment",
      assignmentId: "another-assignment",
      decisionId: "another-decision",
      issuedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-08T00:00:00.000Z",
    }, secret)].entries()) {
      const order = normalizeShopifyFinancialSnapshotV2(snapshot({
        merchantId: merchant.id,
        orderId: `gid://shopify/Order/${9100 + index}`,
        lines: [{ ...snapshot().lines[0], signedAssignmentReference: reference }],
      }));
      await reconcileCanonicalFinancialOrderV2({
        db: fixture.db,
        merchantId: merchant.id,
        order,
        assignmentSecret: secret,
      });
    }
    assert.equal(await fixture.db.attributionV2.count(), 0);
    assert.equal(await fixture.db.visitorOutcome.count(), 0);
    assert.equal(await fixture.db.orderLedger.count({
      where: { reconciliationState: "ATTRIBUTION_CONFLICT" },
    }), 2);
    assert.equal(await fixture.db.auditLog.count({
      where: { action: "V2_ATTRIBUTION_CONFLICT" },
    }), 2);
  } finally { await fixture.close(); }
});

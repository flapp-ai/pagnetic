import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { collectCustomerPrivacyExport } from "../app/services/customer-privacy-export.server";

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-export-"));
  const database = join(directory, "test.sqlite");
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
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const at = new Date("2026-09-05T12:00:00.000Z");
const orderGid = (id: number) => `gid://shopify/Order/${id}`;

async function productAndExperiment(
  db: PrismaClient,
  merchantId: string,
  suffix: string,
) {
  const product = await db.product.create({
    data: {
      merchantId,
      shopifyProductId: `gid://shopify/Product/${suffix}`,
      title: `Product ${suffix}`,
      handle: `product-${suffix}`,
      status: "ACTIVE",
      sourceVersion: "1",
      sourceHash: `source-${suffix}`,
      sourceSnapshot: "{}",
    },
  });
  const experiment = await db.experiment.create({
    data: {
      merchantId,
      productId: product.id,
      key: `experiment-${suffix}`,
      salt: `salt-${suffix}`,
      lifecycleVersion: 2,
    },
  });
  return { product, experiment };
}

test("collector returns exact multi-order tenant data without following a shared assignment to another order", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "privacy-export.myshopify.com" },
    });
    const otherMerchant = await fixture.db.merchant.create({
      data: { shop: "privacy-export-other.myshopify.com" },
    });
    const { product, experiment } = await productAndExperiment(
      fixture.db,
      merchant.id,
      "101",
    );
    const otherProduct = await productAndExperiment(
      fixture.db,
      otherMerchant.id,
      "201",
    );
    const assignment = await fixture.db.assignment.create({
      data: {
        merchantId: merchant.id,
        experimentId: experiment.id,
        randomizationUnitId: "customer-opaque-unit",
        randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
        arm: "MATCHED",
        bucket: 7000,
        saltVersion: 1,
        consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
        assignedAt: at,
        expiresAt: new Date(at.getTime() + 86_400_000),
        visitorHash: "customer-visitor-hash",
      },
    });
    const decision = await fixture.db.decision.create({
      data: {
        id: "decision-exact-order",
        merchantId: merchant.id,
        experimentId: experiment.id,
        assignmentId: assignment.id,
        productId: product.id,
        sessionId: "customer-session-hash",
        visitorId: "customer-visitor-hash",
        arm: "MATCHED",
        policy: "UNIVERSAL",
        reason: "V2_EXPERIMENT_ASSIGNMENT",
        consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
        occurredAt: at,
      },
    });
    const legacyOne = await fixture.db.storeOrder.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderGid(1),
        orderNumber: "1001",
        currencyCode: "USD",
        grossAmount: "10.00",
        netAmount: "8.00",
        financialStatus: "paid",
        occurredAt: at,
        payloadJson: JSON.stringify({
          topic: "ORDERS_CREATE",
          test: false,
          webhookId: "must-not-export-webhook-secret",
        }),
      },
    });
    const legacyTwo = await fixture.db.storeOrder.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderGid(2),
        orderNumber: "1002",
        currencyCode: "USD",
        grossAmount: "20.00",
        netAmount: "20.00",
        financialStatus: "paid",
        occurredAt: at,
      },
    });
    const unrelated = await fixture.db.storeOrder.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderGid(3),
        orderNumber: "private-unrelated-order",
        currencyCode: "USD",
        grossAmount: "7777.77",
        netAmount: "7777.77",
        financialStatus: "paid",
        occurredAt: at,
      },
    });
    await fixture.db.storeOrder.create({
      data: {
        merchantId: otherMerchant.id,
        shopifyOrderId: orderGid(1),
        orderNumber: "cross-tenant-private-order",
        currencyCode: "USD",
        grossAmount: "9999.99",
        netAmount: "9999.99",
        financialStatus: "paid",
        occurredAt: at,
      },
    });
    await fixture.db.storeRefund.create({
      data: {
        merchantId: merchant.id,
        orderId: legacyOne.id,
        shopifyRefundId: "gid://shopify/Refund/1",
        amount: "2.00",
        currencyCode: "USD",
        occurredAt: at,
        payloadJson: JSON.stringify({
          transactionCount: 1,
          webhookId: "refund-webhook-secret",
        }),
      },
    });
    await fixture.db.orderAttribution.create({
      data: {
        merchantId: merchant.id,
        orderId: legacyOne.id,
        experimentId: experiment.id,
        assignmentId: assignment.id,
        decisionId: decision.id,
        joinMethod: "LINE_ITEM_PROPERTY",
      },
    });
    await fixture.db.orderAttribution.create({
      data: {
        merchantId: merchant.id,
        orderId: unrelated.id,
        experimentId: experiment.id,
        assignmentId: assignment.id,
        decisionId: decision.id,
        joinMethod: "LINE_ITEM_PROPERTY",
      },
    });
    await fixture.db.visitorOutcome.create({
      data: {
        merchantId: merchant.id,
        experimentId: experiment.id,
        assignmentId: assignment.id,
        eligibleSessionCount: 99,
        netFocalRevenueMinor: "777777",
        paidOrders: 2,
        sourceWatermark: "unrelated-financial-watermark",
        projectionVersion: "v2.1",
      },
    });
    await fixture.db.renderEvent.create({
      data: {
        merchantId: merchant.id,
        eventId: "render-exact",
        decisionId: decision.id,
        status: "RENDERED",
        occurredAt: at,
      },
    });
    await fixture.db.commerceEvent.createMany({
      data: [
        {
          merchantId: merchant.id,
          eventId: "checkout-exact",
          source: "SHOPIFY_PIXEL",
          eventType: "checkout_completed",
          occurredAt: at,
          decisionId: decision.id,
          shopifyOrderId: orderGid(1),
          consentState: "analytics_and_preferences_allowed",
          checkoutToken: "customer-checkout-token",
          payloadJson: JSON.stringify({ amount: 1000, currencyCode: "USD" }),
        },
        {
          merchantId: merchant.id,
          eventId: "view-linked",
          source: "SHOPIFY_PIXEL",
          eventType: "product_viewed",
          occurredAt: at,
          decisionId: decision.id,
          shopifyOrderId: null,
          consentState: "analytics_and_preferences_allowed",
        },
        {
          merchantId: merchant.id,
          eventId: "checkout-unrelated",
          source: "SHOPIFY_PIXEL",
          eventType: "checkout_completed",
          occurredAt: at,
          decisionId: decision.id,
          shopifyOrderId: orderGid(3),
          consentState: "analytics_and_preferences_allowed",
          payloadJson: JSON.stringify({ amount: 777777, currencyCode: "USD" }),
        },
        {
          merchantId: merchant.id,
          eventId: "checkout-unbound",
          source: "SHOPIFY_PIXEL",
          eventType: "checkout_completed",
          occurredAt: at,
          decisionId: decision.id,
          shopifyOrderId: null,
          consentState: "analytics_and_preferences_allowed",
          payloadJson: JSON.stringify({ amount: 666666, currencyCode: "USD" }),
        },
      ],
    });

    const ledger = await fixture.db.orderLedger.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderGid(1),
        shopifyCreatedAt: at,
        sourceUpdatedAt: at,
        shopCurrency: "USD",
        originalObligationMinor: "1000",
        paymentState: "CAPTURED",
        reconciliationState: "RECONCILED",
        sourceHash: "internal-source-hash",
        completenessJson: JSON.stringify({
          lines: true,
          transactions: true,
          refunds: true,
          refundChildren: true,
          graphQlErrors: false,
        }),
      },
    });
    const line = await fixture.db.orderLedgerLine.create({
      data: {
        orderId: ledger.id,
        shopifyLineItemId: "gid://shopify/LineItem/1",
        shopifyProductId: product.shopifyProductId,
        merchandiseAfterDiscountMinor: "1000",
        currencyCode: "USD",
      },
    });
    await fixture.db.attributionV2.create({
      data: {
        merchantId: merchant.id,
        orderLineId: line.id,
        assignmentId: assignment.id,
        experimentId: experiment.id,
        joinMethod: "SIGNED_LINE_REFERENCE_V2",
        signedRefHash: "must-not-export-signed-reference-hash",
        validAt: at,
        reason: "VERIFIED_IN_WINDOW",
        status: "ACTIVE",
      },
    });
    await fixture.db.refundLedger.create({
      data: {
        merchantId: merchant.id,
        orderId: ledger.id,
        shopifyOrderId: orderGid(1),
        shopifyRefundId: "gid://shopify/Refund/v2-1",
        shopifyTransactionId: "gid://shopify/OrderTransaction/refund-1",
        shopifyLineItemId: line.shopifyLineItemId,
        sourceKey: "refund-v2-1",
        amountMinor: "200",
        currencyCode: "USD",
        sourceOccurredAt: at,
        allocationState: "SETTLED",
      },
    });
    const revision = await fixture.db.financialOrderRevision.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderGid(1),
        sourceUpdatedAt: at,
        firstObservedAt: at,
        sourceHash: "must-not-export-source-hash",
        revisionHash: "safe-revision-identity",
        canonicalPayload: JSON.stringify({
          schemaVersion: 2,
          apiVersion: "2026-07",
          policyVersion: "pagnetic-financial-v2.1",
          merchantId: merchant.id,
          orderId: orderGid(1),
          createdAt: at.toISOString(),
          sourceUpdatedAt: at.toISOString(),
          observedAt: at.toISOString(),
          test: false,
          cancelledAt: null,
          currency: "USD",
          originalObligation: { minor: "1000", currency: "USD" },
          completeness: {
            lines: true,
            transactions: true,
            refunds: true,
            refundChildren: true,
            graphQlErrors: false,
          },
          sourceHash: "must-not-export-canonical-source-hash",
          paymentState: "CAPTURED",
          reconciliationState: "RECONCILED",
          lines: [
            {
              lineId: line.shopifyLineItemId,
              productId: product.shopifyProductId,
              variantId: null,
              giftCardProduct: false,
              sellingPlan: false,
              merchandiseBeforeRefunds: { minor: "1000", currency: "USD" },
              signedAssignmentReference: "must-not-export-signed-capability",
            },
          ],
          transactions: [
            {
              transactionId: "gid://shopify/OrderTransaction/1",
              parentId: null,
              kind: "SALE",
              status: "SUCCESS",
              test: false,
              processedAt: at.toISOString(),
              amount: { minor: "1000", currency: "USD" },
            },
          ],
          refunds: [],
          unresolvedReasons: [],
          privateInternalReference: "must-not-export-canonical-payload",
        }),
      },
    });
    await fixture.db.financialRevisionLink.create({
      data: {
        revisionId: revision.id,
        merchantId: merchant.id,
        experimentId: experiment.id,
        assignmentId: assignment.id,
        shopifyLineId: line.shopifyLineItemId,
        signedRefHash: "must-not-export-revision-signature-hash",
      },
    });
    await fixture.db.pixelCredential.create({
      data: {
        merchantId: merchant.id,
        tokenHash: "must-not-export-app-token",
        endpoint: "https://private.internal/events",
      },
    });
    await fixture.db.assignment.create({
      data: {
        merchantId: otherMerchant.id,
        experimentId: otherProduct.experiment.id,
        randomizationUnitId: "cross-tenant-unit",
        randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
        arm: "MATCHED",
        bucket: 7000,
        saltVersion: 1,
        consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
        assignedAt: at,
        expiresAt: new Date(at.getTime() + 86_400_000),
      },
    });

    const result = await fixture.db.$transaction((tx) =>
      collectCustomerPrivacyExport({
        tx,
        merchantId: merchant.id,
        orderIds: [2, orderGid(1)],
      }),
    );
    assert.deepEqual(result.requestedOrderIds, [orderGid(1), orderGid(2)]);
    assert.deepEqual(result.missingOrderIds, []);
    assert.equal(result.records.length, 2);
    const first = result.records.find(
      (record) => record.shopifyOrderId === orderGid(1),
    );
    const second = result.records.find(
      (record) => record.shopifyOrderId === orderGid(2),
    );
    assert.ok(first && second);
    assert.equal(first.legacy.refunds.length, 1);
    assert.equal(first.v2.lines.length, 1);
    assert.equal(first.v2.refunds.length, 1);
    assert.equal(first.v2.attributions.length, 1);
    assert.equal(first.immutableFinancialRevisions.length, 1);
    assert.equal(
      first.immutableFinancialRevisions[0]?.financialSnapshot
        ?.originalObligation?.minor,
      "1000",
    );
    assert.equal(
      first.immutableFinancialRevisions[0]?.financialSnapshot?.lines[0]?.lineId,
      line.shopifyLineItemId,
    );
    assert.equal(first.measurement.decisions.length, 1);
    assert.equal(first.measurement.assignments.length, 1);
    assert.equal(
      first.measurement.visitorOutcomes[0]?.aggregateMetricsOmitted,
      true,
    );
    assert.deepEqual(
      first.measurement.commerceEvents.map((event) => event.eventId).sort(),
      ["checkout-exact", "view-linked"],
    );
    assert.equal(second.legacy.orders[0]?.orderNumber, legacyTwo.orderNumber);
    assert.equal(second.measurement.assignments.length, 0);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "private-unrelated-order",
      "cross-tenant-private-order",
      "7777.77",
      "9999.99",
      "777777",
      "666666",
      "must-not-export-webhook-secret",
      "refund-webhook-secret",
      "must-not-export-canonical-payload",
      "must-not-export-source-hash",
      "must-not-export-canonical-source-hash",
      "must-not-export-signed-capability",
      "must-not-export-signed-reference-hash",
      "must-not-export-revision-signature-hash",
      "must-not-export-app-token",
      "private.internal",
    ])
      assert.doesNotMatch(
        serialized,
        new RegExp(forbidden.replaceAll(".", "\\.")),
      );
  } finally {
    await fixture.close();
  }
});

test("collector paginates exact-order events, reports missing IDs and enforces the batch bound", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "privacy-export-pages.myshopify.com" },
    });
    await fixture.db.commerceEvent.createMany({
      data: Array.from({ length: 501 }, (_, index) => ({
        merchantId: merchant.id,
        eventId: `event-${String(index).padStart(3, "0")}`,
        source: "SHOPIFY_PIXEL",
        eventType: "checkout_completed",
        occurredAt: new Date(at.getTime() + index),
        shopifyOrderId: orderGid(10),
        consentState: "analytics_and_preferences_allowed",
        payloadJson: JSON.stringify({ amount: index, currencyCode: "USD" }),
      })),
    });
    const result = await fixture.db.$transaction((tx) =>
      collectCustomerPrivacyExport({
        tx,
        merchantId: merchant.id,
        orderIds: [10, 11],
      }),
    );
    assert.deepEqual(result.missingOrderIds, [orderGid(11)]);
    assert.equal(result.records[0]?.measurement.commerceEvents.length, 501);
    assert.equal(result.records[1]?.found, false);
    assert.equal(result.limits.maximumRowsPerRead, 500);
    assert.equal(result.limits.maximumSourceRowsPerCall, 2_000);
    assert.equal(result.limits.maximumSourceBytesPerCall, 4 * 1024 * 1024);
    assert.equal(result.limits.maximumCanonicalPayloadBytes, 1024 * 1024);
    assert.doesNotThrow(() => JSON.stringify(result));
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        collectCustomerPrivacyExport({
          tx,
          merchantId: merchant.id,
          orderIds: Array.from({ length: 101 }, (_, index) => index + 1),
        }),
      ),
      /ORDER_LIMIT_EXCEEDED/,
    );
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        collectCustomerPrivacyExport({
          tx,
          merchantId: merchant.id,
          orderIds: ["not-an-order"],
        }),
      ),
      /PRIVACY_ORDER_ID_INVALID/,
    );
  } finally {
    await fixture.close();
  }
});

test("collector rejects over-budget exact orders for review without returning a truncated export", async () => {
  const fixture = testDatabase();
  try {
    const rowMerchant = await fixture.db.merchant.create({
      data: { shop: "privacy-export-row-cap.myshopify.com" },
    });
    const rowEvents = Array.from({ length: 2_001 }, (_, index) => ({
      merchantId: rowMerchant.id,
      eventId: `row-cap-${String(index).padStart(4, "0")}`,
      source: "SHOPIFY_PIXEL",
      eventType: "checkout_completed",
      occurredAt: new Date(at.getTime() + index),
      shopifyOrderId: orderGid(20),
      consentState: "analytics_and_preferences_allowed",
      payloadJson: "{}",
    }));
    for (let index = 0; index < rowEvents.length; index += 250)
      await fixture.db.commerceEvent.createMany({
        data: rowEvents.slice(index, index + 250),
      });

    await assert.rejects(
      fixture.db.$transaction((tx) =>
        collectCustomerPrivacyExport({
          tx,
          merchantId: rowMerchant.id,
          orderIds: [20],
        }),
      ),
      /PRIVACY_EXPORT_ORDER_TOO_LARGE/,
    );

    const byteMerchant = await fixture.db.merchant.create({
      data: { shop: "privacy-export-byte-cap.myshopify.com" },
    });
    await fixture.db.commerceEvent.create({
      data: {
        merchantId: byteMerchant.id,
        eventId: "byte-cap-event",
        source: "SHOPIFY_PIXEL",
        eventType: "checkout_completed",
        occurredAt: at,
        shopifyOrderId: orderGid(21),
        consentState: "analytics_and_preferences_allowed",
        payloadJson: JSON.stringify({ value: "x".repeat(4 * 1024 * 1024) }),
      },
    });
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        collectCustomerPrivacyExport({
          tx,
          merchantId: byteMerchant.id,
          orderIds: [21],
        }),
      ),
      /PRIVACY_EXPORT_ORDER_TOO_LARGE/,
    );

    const canonicalMerchant = await fixture.db.merchant.create({
      data: { shop: "privacy-export-canonical-cap.myshopify.com" },
    });
    await fixture.db.financialOrderRevision.create({
      data: {
        merchantId: canonicalMerchant.id,
        shopifyOrderId: orderGid(22),
        sourceUpdatedAt: at,
        firstObservedAt: at,
        sourceHash: "canonical-cap-source",
        revisionHash: "canonical-cap-revision",
        canonicalPayload: "x".repeat(1024 * 1024 + 1),
      },
    });
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        collectCustomerPrivacyExport({
          tx,
          merchantId: canonicalMerchant.id,
          orderIds: [22],
        }),
      ),
      /PRIVACY_EXPORT_ORDER_TOO_LARGE/,
    );
  } finally {
    await fixture.close();
  }
});

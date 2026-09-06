import assert from "node:assert/strict";
import test from "node:test";

import { normalizeShopifyFinancialSnapshotV2 } from "../app/services/financial-v2";
import {
  fetchShopifyFinancialOrderV2,
  SHOPIFY_FINANCIAL_ORDER_QUERY_V2,
  SHOPIFY_FINANCIAL_REFUND_QUERY_V2,
} from "../app/services/shopify-financial-v2.server";

const moneyBag = (amount: string) => ({
  shopMoney: { amount, currencyCode: "USD" },
});
const pageInfo = (endCursor: string | null = null) => ({
  hasNextPage: Boolean(endCursor),
  endCursor,
});

function line(id: string, reference: string | null = null) {
  return {
    id,
    product: { id: "gid://shopify/Product/1" },
    variant: { id: `gid://shopify/ProductVariant/${id.split("/").at(-1)}` },
    isGiftCard: false,
    sellingPlan: null,
    originalTotalSet: moneyBag("50.00"),
    discountAllocations: [],
    taxLines: [],
    customAttributes: reference
      ? [
          { key: "private-note", value: "must-not-persist" },
          { key: "_pagnetic_ref", value: reference },
        ]
      : [],
  };
}

function orderPage(
  lineNodes: ReturnType<typeof line>[],
  cursor: string | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "gid://shopify/Order/1",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:01:00.000Z",
    cancelledAt: null,
    test: false,
    taxesIncluded: false,
    originalTotalPriceSet: moneyBag("100.00"),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{
      id: "gid://shopify/OrderTransaction/1",
      kind: "SALE",
      status: "SUCCESS",
      test: false,
      processedAt: "2026-09-05T00:00:30.000Z",
      amountSet: moneyBag("100.00"),
      parentTransaction: null,
    }],
    lineItems: { nodes: lineNodes, pageInfo: pageInfo(cursor) },
    refunds: [{
      id: "gid://shopify/Refund/1",
      updatedAt: "2026-09-06T00:00:00.000Z",
    }],
    ...overrides,
  };
}

function refundPage(cursor: string | null = null) {
  return {
    id: "gid://shopify/Refund/1",
    updatedAt: "2026-09-06T00:00:00.000Z",
    order: {
      id: "gid://shopify/Order/1",
      updatedAt: "2026-09-05T00:01:00.000Z",
    },
    refundLineItems: {
      nodes: [{
        id: "gid://shopify/RefundLineItem/1",
        lineItem: { id: "gid://shopify/LineItem/1" },
        subtotalSet: moneyBag("12.50"),
        totalTaxSet: moneyBag("0.00"),
      }],
      pageInfo: pageInfo(cursor),
    },
    transactions: {
      nodes: [{
        id: "gid://shopify/OrderTransaction/refund-1",
        kind: "REFUND",
        status: "SUCCESS",
        amountSet: moneyBag("25.00"),
      }],
      pageInfo: pageInfo(),
    },
    orderAdjustments: { nodes: [], pageInfo: pageInfo() },
  };
}

function response(data: unknown, errors?: Array<{ message: string }>) {
  return new Response(JSON.stringify({ data, errors }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("financial adapter paginates order lines and every refund child connection", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const graphql = async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => {
    const variables = options?.variables ?? {};
    calls.push({ query, variables });
    if (query === SHOPIFY_FINANCIAL_ORDER_QUERY_V2) {
      return response({
        order: variables.lineAfter
          ? orderPage([line("gid://shopify/LineItem/2")], null)
          : orderPage([line("gid://shopify/LineItem/1", "signed-reference")], "line-page-2"),
      });
    }
    assert.equal(query, SHOPIFY_FINANCIAL_REFUND_QUERY_V2);
    return response({
      refund: variables.lineAfter
        ? {
            ...refundPage(),
            refundLineItems: {
              nodes: [{
                id: "gid://shopify/RefundLineItem/2",
                lineItem: { id: "gid://shopify/LineItem/2" },
                subtotalSet: moneyBag("12.50"),
                totalTaxSet: moneyBag("0.00"),
              }],
              pageInfo: pageInfo(),
            },
          }
        : refundPage("refund-line-page-2"),
    });
  };
  const source = await fetchShopifyFinancialOrderV2({
    merchantId: "merchant_adapter_1",
    orderId: "gid://shopify/Order/1",
    graphql,
    observedAt: new Date("2026-09-07T00:00:00.000Z"),
  });
  assert.deepEqual(source.completeness, {
    lines: true,
    transactions: true,
    refunds: true,
    refundChildren: true,
    graphQlErrors: false,
  });
  assert.equal(source.lines.length, 2);
  assert.equal(source.lines[0]?.signedAssignmentReference, "signed-reference");
  assert.deepEqual(source.refunds[0]?.lines.map((item) => item.refundLineKey), [
    "gid://shopify/RefundLineItem/1",
    "gid://shopify/RefundLineItem/2",
  ]);
  assert.equal(source.refunds[0]?.transactions.length, 1);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1]?.variables, {
    id: "gid://shopify/Order/1",
    lineAfter: "line-page-2",
  });
  assert.deepEqual(calls[2]?.variables, {
    id: "gid://shopify/Refund/1",
    lineAfter: null,
    transactionAfter: null,
    adjustmentAfter: null,
  });
  assert.deepEqual(calls[3]?.variables, {
    id: "gid://shopify/Refund/1",
    lineAfter: "refund-line-page-2",
    transactionAfter: null,
    adjustmentAfter: null,
  });
  assert.equal(normalizeShopifyFinancialSnapshotV2(source).reconciliationState, "RECONCILED");
});

test("financial adapter marks GraphQL errors and inexact transaction counts incomplete", async () => {
  const graphql = async (query: string) => {
    assert.equal(query, SHOPIFY_FINANCIAL_ORDER_QUERY_V2);
    return response({
      order: orderPage([line("gid://shopify/LineItem/1")], null, {
        transactionsCount: { count: 1, precision: "AT_LEAST" },
        refunds: [],
      }),
    }, [{ message: "partial response" }]);
  };
  const source = await fetchShopifyFinancialOrderV2({
    merchantId: "merchant_adapter_1",
    orderId: "gid://shopify/Order/1",
    graphql,
  });
  assert.equal(source.completeness.transactions, false);
  assert.equal(source.completeness.graphQlErrors, true);
  const order = normalizeShopifyFinancialSnapshotV2(source);
  assert.equal(order.reconciliationState, "PENDING");
  assert.ok(order.unresolvedReasons.includes("SOURCE_INCOMPLETE"));
});

test("financial adapter preserves a complete Shopify test-gateway order as TEST_ONLY", async () => {
  const graphql = async (query: string) => {
    assert.equal(query, SHOPIFY_FINANCIAL_ORDER_QUERY_V2);
    return response({
      order: orderPage([line("gid://shopify/LineItem/1")], null, {
        test: true,
        refunds: [],
        transactions: [
          {
            id: "gid://shopify/OrderTransaction/test-gateway-sale",
            kind: "SALE",
            status: "SUCCESS",
            test: true,
            processedAt: "2026-09-05T00:00:30.000Z",
            amountSet: moneyBag("100.00"),
            parentTransaction: null,
          },
        ],
      }),
    });
  };
  const source = await fetchShopifyFinancialOrderV2({
    merchantId: "merchant_adapter_test_gateway",
    orderId: "gid://shopify/Order/1",
    graphql,
  });
  assert.equal(source.test, true);
  assert.deepEqual(source.completeness, {
    lines: true,
    transactions: true,
    refunds: true,
    refundChildren: true,
    graphQlErrors: false,
  });
  const normalized = normalizeShopifyFinancialSnapshotV2(source);
  assert.equal(normalized.paymentState, "TEST_ONLY");
  assert.equal(normalized.reconciliationState, "TEST_ONLY");
  assert.deepEqual(normalized.unresolvedReasons, []);
});

test("financial adapter rejects an order watermark change during pagination", async () => {
  let call = 0;
  const graphql = async () => {
    call += 1;
    return response({
      order: call === 1
        ? orderPage([line("gid://shopify/LineItem/1")], "line-page-2")
        : orderPage([line("gid://shopify/LineItem/2")], null, {
            updatedAt: "2026-09-05T00:02:00.000Z",
          }),
    });
  };
  await assert.rejects(fetchShopifyFinancialOrderV2({
    merchantId: "merchant_adapter_1",
    orderId: "gid://shopify/Order/1",
    graphql,
  }), /SOURCE_WATERMARK_CHANGED/);
});

import type { AdminGraphql } from "./measurement-reliability.server";
import {
  PAGNETIC_FINANCIAL_API_VERSION,
  type ShopifyFinancialSnapshotV2,
  type ShopifyMoneyV2,
} from "./financial-v2";

const PAGE_SIZE = 100;
const TRANSACTION_LIMIT = 250;
const MAX_PAGES = 100;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };
type MoneyBag = { shopMoney: ShopifyMoneyV2 };
type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type OrderLineNode = {
  id: string;
  product: { id: string } | null;
  variant: { id: string } | null;
  isGiftCard: boolean;
  sellingPlan: { name: string } | null;
  originalTotalSet: MoneyBag;
  discountAllocations: Array<{ allocatedAmountSet: MoneyBag }>;
  taxLines: Array<{ priceSet: MoneyBag }>;
  customAttributes: Array<{ key: string; value: string }>;
};

type OrderTransactionNode = {
  id: string;
  kind: string;
  status: string;
  test: boolean;
  processedAt: string | null;
  amountSet: MoneyBag;
  parentTransaction: { id: string } | null;
};

type OrderPage = {
  id: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  taxesIncluded: boolean;
  originalTotalPriceSet: MoneyBag;
  transactionsCount: { count: number; precision: string } | null;
  transactions: OrderTransactionNode[];
  lineItems: { nodes: OrderLineNode[]; pageInfo: PageInfo };
  refunds: Array<{ id: string; updatedAt: string }>;
};

type RefundPage = {
  id: string;
  updatedAt: string;
  order: { id: string; updatedAt: string };
  refundLineItems: {
    nodes: Array<{
      id: string;
      lineItem: { id: string };
      subtotalSet: MoneyBag;
      totalTaxSet: MoneyBag;
    }>;
    pageInfo: PageInfo;
  };
  transactions: {
    nodes: Array<{
      id: string;
      kind: string;
      status: string;
      processedAt?: string | null;
      amountSet: MoneyBag;
    }>;
    pageInfo: PageInfo;
  };
  orderAdjustments: {
    nodes: Array<{ id: string }>;
    pageInfo: PageInfo;
  };
};

export const SHOPIFY_FINANCIAL_ORDER_QUERY_V2 = `#graphql
  query PagneticFinancialOrderV2($id: ID!, $lineAfter: String) {
    order(id: $id) {
      id
      createdAt
      updatedAt
      cancelledAt
      test
      taxesIncluded
      originalTotalPriceSet { shopMoney { amount currencyCode } }
      transactionsCount { count precision }
      transactions(first: ${TRANSACTION_LIMIT}) {
        id kind status test processedAt
        amountSet { shopMoney { amount currencyCode } }
        parentTransaction { id }
      }
      lineItems(first: ${PAGE_SIZE}, after: $lineAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          product { id }
          variant { id }
          isGiftCard
          sellingPlan { name }
          originalTotalSet { shopMoney { amount currencyCode } }
          discountAllocations {
            allocatedAmountSet { shopMoney { amount currencyCode } }
          }
          taxLines { priceSet { shopMoney { amount currencyCode } } }
          customAttributes { key value }
        }
      }
      refunds { id updatedAt }
    }
  }`;

export const SHOPIFY_FINANCIAL_REFUND_QUERY_V2 = `#graphql
  query PagneticFinancialRefundV2(
    $id: ID!
    $lineAfter: String
    $transactionAfter: String
    $adjustmentAfter: String
  ) {
    refund(id: $id) {
      id
      updatedAt
      order { id updatedAt }
      refundLineItems(first: ${PAGE_SIZE}, after: $lineAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          lineItem { id }
          subtotalSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
        }
      }
      transactions(first: ${PAGE_SIZE}, after: $transactionAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id kind status processedAt
          amountSet { shopMoney { amount currencyCode } }
        }
      }
      orderAdjustments(first: ${PAGE_SIZE}, after: $adjustmentAfter) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }`;

function nextCursor(connection: { pageInfo: PageInfo }, label: string) {
  if (!connection.pageInfo.hasNextPage) return null;
  if (!connection.pageInfo.endCursor)
    throw new Error(`${label}_CURSOR_MISSING`);
  return connection.pageInfo.endCursor;
}

async function graphqlJson<T>(
  graphql: AdminGraphql,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await graphql(query, { variables });
  const body = (await response.json()) as GraphqlEnvelope<T>;
  return {
    body,
    graphQlErrors: body.errors?.length ? true : false,
    ok: response.ok,
  };
}

function uniqueCount(values: Array<{ id: string }>) {
  return new Set(values.map((value) => value.id)).size;
}

function pagneticReference(attributes: OrderLineNode["customAttributes"]) {
  const references = attributes
    .filter((attribute) => attribute.key === "_pagnetic_ref")
    .map((attribute) => attribute.value)
    .filter(Boolean);
  return references.length === 1 ? references[0] : null;
}

export async function fetchShopifyFinancialOrderV2(args: {
  merchantId: string;
  orderId: string;
  graphql: AdminGraphql;
  observedAt?: Date;
}) : Promise<ShopifyFinancialSnapshotV2> {
  let lineAfter: string | null = null;
  let order: OrderPage | null = null;
  let graphQlErrors = false;
  let linesComplete = true;
  const lines: OrderLineNode[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await graphqlJson<{ order: OrderPage | null }>(
      args.graphql,
      SHOPIFY_FINANCIAL_ORDER_QUERY_V2,
      { id: args.orderId, lineAfter },
    );
    graphQlErrors ||= result.graphQlErrors;
    const current = result.body.data?.order;
    if (!result.ok || !current)
      throw new Error("SHOPIFY_FINANCIAL_ORDER_FETCH_FAILED");
    if (current.id !== args.orderId)
      throw new Error("SHOPIFY_FINANCIAL_ORDER_SCOPE_MISMATCH");
    if (order && order.updatedAt !== current.updatedAt)
      throw new Error("SHOPIFY_FINANCIAL_SOURCE_WATERMARK_CHANGED");
    order ??= current;
    lines.push(...current.lineItems.nodes);
    lineAfter = nextCursor(current.lineItems, "SHOPIFY_FINANCIAL_LINES");
    if (!lineAfter) break;
    if (page === MAX_PAGES - 1) linesComplete = false;
  }
  if (!order) throw new Error("SHOPIFY_FINANCIAL_ORDER_FETCH_FAILED");

  const refunds: ShopifyFinancialSnapshotV2["refunds"] = [];
  let refundChildrenComplete = true;
  for (const refundHead of order.refunds) {
    let refundLineAfter: string | null = null;
    let transactionAfter: string | null = null;
    let adjustmentAfter: string | null = null;
    let refundUpdatedAt: string | null = null;
    const refundLines: RefundPage["refundLineItems"]["nodes"] = [];
    const transactions: RefundPage["transactions"]["nodes"] = [];
    let hasAdjustment = false;
    let fetchRefundLines = true;
    let fetchTransactions = true;
    let fetchAdjustments = true;
    let completed = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await graphqlJson<{ refund: RefundPage | null }>(
        args.graphql,
        SHOPIFY_FINANCIAL_REFUND_QUERY_V2,
        {
          id: refundHead.id,
          lineAfter: refundLineAfter,
          transactionAfter,
          adjustmentAfter,
        },
      );
      graphQlErrors ||= result.graphQlErrors;
      const current = result.body.data?.refund;
      if (!result.ok || !current)
        throw new Error("SHOPIFY_FINANCIAL_REFUND_FETCH_FAILED");
      if (current.id !== refundHead.id || current.order.id !== args.orderId)
        throw new Error("SHOPIFY_FINANCIAL_REFUND_SCOPE_MISMATCH");
      if (current.order.updatedAt !== order.updatedAt)
        throw new Error("SHOPIFY_FINANCIAL_SOURCE_WATERMARK_CHANGED");
      if (current.updatedAt !== refundHead.updatedAt)
        throw new Error("SHOPIFY_FINANCIAL_REFUND_WATERMARK_CHANGED");
      if (refundUpdatedAt && refundUpdatedAt !== current.updatedAt)
        throw new Error("SHOPIFY_FINANCIAL_REFUND_WATERMARK_CHANGED");
      refundUpdatedAt ??= current.updatedAt;
      if (fetchRefundLines) {
        refundLines.push(...current.refundLineItems.nodes);
        refundLineAfter = nextCursor(current.refundLineItems, "SHOPIFY_FINANCIAL_REFUND_LINES");
        fetchRefundLines = Boolean(refundLineAfter);
      }
      if (fetchTransactions) {
        transactions.push(...current.transactions.nodes);
        transactionAfter = nextCursor(current.transactions, "SHOPIFY_FINANCIAL_REFUND_TRANSACTIONS");
        fetchTransactions = Boolean(transactionAfter);
      }
      if (fetchAdjustments) {
        hasAdjustment ||= current.orderAdjustments.nodes.length > 0;
        adjustmentAfter = nextCursor(current.orderAdjustments, "SHOPIFY_FINANCIAL_REFUND_ADJUSTMENTS");
        fetchAdjustments = Boolean(adjustmentAfter);
      }
      if (!fetchRefundLines && !fetchTransactions && !fetchAdjustments) {
        completed = true;
        break;
      }
    }
    refundChildrenComplete &&= completed;
    refunds.push({
      refundId: refundHead.id,
      sourceUpdatedAt: refundUpdatedAt ?? refundHead.updatedAt,
      hasUnresolvedAdjustment: hasAdjustment,
      transactions: transactions.map((transaction) => ({
        transactionId: transaction.id,
        kind: transaction.kind,
        status: transaction.status,
        processedAt: transaction.processedAt ?? null,
        amount: transaction.amountSet.shopMoney,
      })),
      lines: refundLines.map((line) => ({
        refundLineKey: line.id,
        lineId: line.lineItem.id,
        merchandise: line.subtotalSet.shopMoney,
        tax: line.totalTaxSet.shopMoney,
      })),
    });
  }

  const transactionCountExact = order.transactionsCount?.precision === "EXACT";
  const transactionsComplete = Boolean(
    transactionCountExact &&
      order.transactionsCount &&
      order.transactionsCount.count === uniqueCount(order.transactions),
  );
  return {
    merchantId: args.merchantId,
    orderId: order.id,
    createdAt: order.createdAt,
    sourceUpdatedAt: order.updatedAt,
    observedAt: (args.observedAt ?? new Date()).toISOString(),
    test: order.test,
    cancelledAt: order.cancelledAt,
    taxesIncluded: order.taxesIncluded,
    originalTotalPrice: order.originalTotalPriceSet.shopMoney,
    completeness: {
      lines: linesComplete && !lineAfter,
      transactions: transactionsComplete,
      refunds: true,
      refundChildren: refundChildrenComplete,
      graphQlErrors,
    },
    lines: lines.map((line) => ({
      lineId: line.id,
      productId: line.product?.id ?? null,
      variantId: line.variant?.id ?? null,
      giftCardProduct: line.isGiftCard,
      sellingPlan: Boolean(line.sellingPlan),
      originalTotal: line.originalTotalSet.shopMoney,
      discountAllocations: line.discountAllocations.map(
        (allocation) => allocation.allocatedAmountSet.shopMoney,
      ),
      taxLines: line.taxLines.map((taxLine) => taxLine.priceSet.shopMoney),
      signedAssignmentReference: pagneticReference(line.customAttributes),
    })),
    transactions: order.transactions.map((transaction) => ({
      transactionId: transaction.id,
      parentId: transaction.parentTransaction?.id ?? null,
      kind: transaction.kind,
      status: transaction.status,
      test: transaction.test,
      processedAt: transaction.processedAt,
      amount: transaction.amountSet.shopMoney,
    })),
    refunds,
  };
}

export function shopifyFinancialAdapterVersionV2() {
  return {
    apiVersion: PAGNETIC_FINANCIAL_API_VERSION,
    pageSize: PAGE_SIZE,
    transactionLimit: TRANSACTION_LIMIT,
  };
}

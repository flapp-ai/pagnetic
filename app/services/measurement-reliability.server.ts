import type { Prisma, PrismaClient } from "@prisma/client";

import { activateWebPixel, ingestOrderWebhook } from "./measurement.server";

export type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

type RecoveredOrderNode = {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  currencyCode: string;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: {
    nodes: Array<{ customAttributes: Array<{ key: string; value: string }> }>;
  };
};

const RECOVERY_QUERY = `#graphql
  query RecoverAdaptiveOrders($first: Int!, $after: String, $query: String!) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        legacyResourceId
        name
        createdAt
        updatedAt
        cancelledAt
        test
        displayFinancialStatus
        currencyCode
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 50) { nodes { customAttributes { key value } } }
      }
    }
  }`;

function orderPayload(order: RecoveredOrderNode) {
  return {
    id: order.legacyResourceId,
    admin_graphql_api_id: order.id,
    order_number: order.name.replace(/^#/, ""),
    currency:
      order.currencyCode || order.currentTotalPriceSet.shopMoney.currencyCode,
    total_price: order.totalPriceSet.shopMoney.amount,
    current_total_price: order.currentTotalPriceSet.shopMoney.amount,
    financial_status: order.displayFinancialStatus?.toLowerCase() ?? null,
    cancelled_at: order.cancelledAt,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    test: order.test,
    line_items: order.lineItems.nodes.map((lineItem) => ({
      properties: lineItem.customAttributes.map((attribute) => ({
        name: attribute.key,
        value: attribute.value,
      })),
    })),
  };
}

export async function recoverRecentOrders(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  graphql: AdminGraphql;
  lookbackDays?: number;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const state = await args.db.measurementSyncState.upsert({
    where: { merchantId: args.merchantId },
    create: { merchantId: args.merchantId, status: "RUNNING" },
    update: { status: "RUNNING", lastError: null },
  });
  const fallback = new Date(
    now.getTime() - (args.lookbackDays ?? 30) * 86_400_000,
  );
  const overlap = state.lastSuccessfulAt
    ? new Date(state.lastSuccessfulAt.getTime() - 24 * 60 * 60 * 1000)
    : fallback;
  const since = overlap > fallback ? overlap : fallback;
  let after: string | null = null;
  let recovered = 0;
  let pages = 0;

  try {
    do {
      const response = await args.graphql(RECOVERY_QUERY, {
        variables: {
          first: 100,
          after,
          query: `created_at:>=${since.toISOString()}`,
        },
      });
      const json = (await response.json()) as {
        data?: {
          orders?: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: RecoveredOrderNode[];
          };
        };
        errors?: Array<{ message: string }> | string;
      };
      const connection = json.data?.orders;
      if (!response.ok || !connection) {
        const message = Array.isArray(json.errors)
          ? json.errors[0]?.message
          : json.errors;
        throw new Error(
          message || `Shopify order recovery failed with ${response.status}.`,
        );
      }
      for (const order of connection.nodes) {
        await ingestOrderWebhook({
          db: args.db,
          shop: args.shop,
          topic: "ORDERS_RECOVERED",
          webhookId: `recovery:${order.id}:${order.updatedAt}`,
          payload: orderPayload(order),
        });
        recovered += 1;
      }
      after = connection.pageInfo.hasNextPage
        ? connection.pageInfo.endCursor
        : null;
      pages += 1;
    } while (after && pages < 10);

    return await args.db.measurementSyncState.update({
      where: { merchantId: args.merchantId },
      data: {
        status: after ? "PARTIAL" : "CURRENT",
        lastOrderSyncAt: now,
        lastSuccessfulAt: now,
        lastCursor: after,
        recoveredOrderCount: { increment: recovered },
        lastError: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown order recovery error.";
    await args.db.measurementSyncState.update({
      where: { merchantId: args.merchantId },
      data: {
        status: "ERROR",
        lastOrderSyncAt: now,
        lastError: message.slice(0, 500),
      },
    });
    throw error;
  }
}

export async function ensureCurrentPixelEndpoint(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  endpoint: string;
  graphql: AdminGraphql;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  await args.assertActive?.(args.db);
  const current = await args.db.pixelCredential.findUnique({
    where: { merchantId: args.merchantId },
  });
  if (current?.status === "ACTIVE" && current.endpoint === args.endpoint) {
    await args.assertActive?.(args.db);
    return { changed: false, credential: current };
  }
  const credential = await activateWebPixel(args);
  return { changed: true, credential };
}

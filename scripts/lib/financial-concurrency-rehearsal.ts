import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  normalizeShopifyFinancialSnapshotV2,
  type ShopifyFinancialSnapshotV2,
} from "../../app/services/financial-v2";
import { reconcileCanonicalFinancialOrderV2 } from "../../app/services/financial-ledger-v2.server";

export async function rehearseFinancialConcurrency(
  db: PrismaClient,
  other: PrismaClient,
) {
  const money = (amount: string) => ({ amount, currencyCode: "USD" });
  const merchantId = "merchant-a";
  const orderId = "gid://shopify/Order/99001";
  function source(
    updatedAt: string,
    amount: string,
  ): ShopifyFinancialSnapshotV2 {
    return {
      merchantId,
      orderId,
      createdAt: "2026-09-05T00:00:00Z",
      sourceUpdatedAt: updatedAt,
      observedAt: updatedAt,
      test: false,
      cancelledAt: null,
      taxesIncluded: false,
      originalTotalPrice: money(amount),
      completeness: {
        lines: true,
        transactions: true,
        refunds: true,
        refundChildren: true,
        graphQlErrors: false,
      },
      lines: [
        {
          lineId: "gid://shopify/LineItem/concurrency",
          productId: "gid://shopify/Product/123",
          variantId: null,
          giftCardProduct: false,
          sellingPlan: false,
          originalTotal: money(amount),
          discountAllocations: [],
          taxLines: [],
          signedAssignmentReference: null,
        },
      ],
      transactions: [
        {
          transactionId: "gid://shopify/OrderTransaction/concurrency",
          parentId: null,
          kind: "SALE",
          status: "SUCCESS",
          test: false,
          processedAt: "2026-09-05T00:00:01Z",
          amount: money(amount),
        },
      ],
      refunds: [],
    };
  }
  const reconcile = (client: PrismaClient, order: ShopifyFinancialSnapshotV2) =>
    reconcileCanonicalFinancialOrderV2({
      db: client,
      merchantId,
      order: normalizeShopifyFinancialSnapshotV2(order),
      assignmentSecret: "synthetic-concurrency-secret-at-least-32-characters",
    });
  await reconcile(db, source("2026-09-06T00:00:00Z", "100.00"));
  let signalRead!: () => void;
  let releaseRead!: () => void;
  const read = new Promise<void>((resolve) => {
    signalRead = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let intercepted = false;
  const delayed = db.$extends({
    query: {
      runtimeControl: {
        async upsert({ args, query }) {
          if (!intercepted) {
            intercepted = true;
            signalRead();
            await release;
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
  const old = reconcile(delayed, source("2026-09-07T00:00:00Z", "80.00"));
  const oldOutcome = old.then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error }),
  );
  try {
    await read;
    await reconcile(other, source("2026-09-08T00:00:00Z", "50.00"));
  } finally {
    releaseRead();
  }
  const outcome = await oldOutcome;
  const current = await db.orderLedger.findUniqueOrThrow({
    where: {
      merchantId_shopifyOrderId: { merchantId, shopifyOrderId: orderId },
    },
  });
  assert.equal(
    current.sourceUpdatedAt.toISOString(),
    "2026-09-08T00:00:00.000Z",
    "An old worker must not overwrite a committed newer source",
  );
  assert.equal(current.originalObligationMinor, "5000");
  assert.ok(
    outcome.error || outcome.value?.stale,
    "Stale worker must retry or explicitly skip",
  );
  return {
    interleavedWorkers: 2,
    interleavingBoundary: "BEFORE_SHARED_PRIVACY_RUNTIME_LOCK",
    newerSourcePreserved: true,
    exactMinorValue: "5000",
  };
}

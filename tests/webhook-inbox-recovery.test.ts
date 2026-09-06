import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import type { ShopifyFinancialSnapshotV2 } from "../app/services/financial-v2";
import {
  acceptFinancialWebhookV2,
  markFinancialWebhookProcessedV2,
  processFinancialWebhookInboxV2,
  runFinancialReconciliationJobsV2,
} from "../app/services/webhook-inbox-v2.server";

const SECRET = "inbox-recovery-secret-that-is-at-least-32-characters";
const money = (amount: string) => ({ amount, currencyCode: "USD" });

function snapshot(args: {
  merchantId: string;
  orderId: string;
  pending?: boolean;
  test?: boolean;
}): ShopifyFinancialSnapshotV2 {
  return {
    merchantId: args.merchantId,
    orderId: args.orderId,
    createdAt: "2026-09-05T00:00:00.000Z",
    sourceUpdatedAt: "2026-09-05T00:01:00.000Z",
    observedAt: "2026-09-05T00:02:00.000Z",
    test: args.test ?? false,
    cancelledAt: null,
    taxesIncluded: false,
    originalTotalPrice: money("100.00"),
    completeness: {
      lines: true,
      transactions: true,
      refunds: true,
      refundChildren: !args.pending,
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
        test: args.test ?? false,
        processedAt: "2026-09-05T00:00:30.000Z",
        amount: money("100.00"),
      },
    ],
    refunds: [],
  };
}

function testDatabase() {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pagnetic-inbox-recovery-"),
  );
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

async function acceptedEvent(
  db: PrismaClient,
  shop: string,
  eventId: string,
  order = "123",
) {
  return acceptFinancialWebhookV2({
    db,
    shop,
    topic: "orders/updated",
    shopifyEventId: eventId,
    payload: {
      id: Number(order),
      admin_graphql_api_id: `gid://shopify/Order/${order}`,
      updated_at: "2026-09-05T00:01:00.000Z",
    },
  });
}

test("an expired inbox lease is reclaimed and the stale worker cannot acknowledge it", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-crash.myshopify.com" },
    });
    const accepted = await acceptedEvent(
      fixture.db,
      merchant.shop,
      "event-crash",
    );
    await fixture.db.webhookInbox.update({
      where: { id: accepted.inbox.id },
      data: {
        processingState: "PROCESSING",
        attempts: 1,
        processingLeaseToken: "crashed-worker:old",
        processingLeaseUntil: new Date("2026-09-05T00:00:10.000Z"),
      },
    });
    const now = new Date("2099-09-05T00:01:00.000Z");
    const processed = await processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: SECRET,
      fetchOrder: async (orderId) =>
        snapshot({ merchantId: merchant.id, orderId }),
      workerId: "replacement",
      now,
    });
    assert.equal(processed.duplicate, false);
    assert.equal(processed.retryScheduled, false);
    const stored = await fixture.db.webhookInbox.findUniqueOrThrow({
      where: { id: accepted.inbox.id },
    });
    assert.equal(stored.processingState, "PROCESSED");
    assert.equal(stored.attempts, 2);
    await assert.rejects(
      markFinancialWebhookProcessedV2({
        db: fixture.db,
        merchantId: merchant.id,
        inboxId: accepted.inbox.id,
        leaseToken: "crashed-worker:old",
        processedAt: now,
      }),
      /STALE_WEBHOOK_INBOX_LEASE/,
    );
  } finally {
    await fixture.close();
  }
});

test("an incomplete canonical read remains retryable and queues a bounded follow-up", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-pending.myshopify.com" },
    });
    const accepted = await acceptedEvent(
      fixture.db,
      merchant.shop,
      "event-pending",
    );
    const now = new Date("2099-09-05T00:01:00.000Z");
    const result = await processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: SECRET,
      fetchOrder: async (orderId) =>
        snapshot({ merchantId: merchant.id, orderId, pending: true }),
      workerId: "pending-worker",
      now,
    });
    assert.equal(result.duplicate, false);
    assert.equal(result.retryScheduled, true);
    const stored = await fixture.db.webhookInbox.findUniqueOrThrow({
      where: { id: accepted.inbox.id },
    });
    assert.equal(stored.processingState, "RETRY");
    assert.equal(stored.lastErrorCode, "FINANCIAL_RECONCILIATION_PENDING");
    assert.equal(stored.processedAt, null);
    assert.equal(stored.processingLeaseToken, null);
    const retryJob = await fixture.db.job.findFirstOrThrow({
      where: { idempotencyKey: `inbox-retry:${stored.id}:1` },
    });
    assert.equal(retryJob.status, "PENDING");
    assert.equal(
      retryJob.nextRunAt.toISOString(),
      result.retryAt.toISOString(),
    );
  } finally {
    await fixture.close();
  }
});

test("a complete Shopify test-gateway order is terminal but remains excluded", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-test-gateway.myshopify.com" },
    });
    const accepted = await acceptedEvent(
      fixture.db,
      merchant.shop,
      "event-test-gateway",
      "9140328169778",
    );
    const now = new Date("2099-09-05T00:01:00.000Z");
    const result = await processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: SECRET,
      fetchOrder: async (orderId) =>
        snapshot({ merchantId: merchant.id, orderId, test: true }),
      workerId: "test-gateway-worker",
      now,
    });
    assert.equal(result.duplicate, false);
    const canonicalResult = result.result;
    if (!canonicalResult) throw new Error("test order result missing");
    assert.equal(result.retryScheduled, false);
    assert.equal(canonicalResult.order.reconciliationState, "TEST_ONLY");
    assert.equal(canonicalResult.order.paymentState, "TEST_ONLY");
    assert.deepEqual(JSON.parse(canonicalResult.order.completenessJson), {
      lines: true,
      transactions: true,
      refunds: true,
      refundChildren: true,
      graphQlErrors: false,
    });
    const stored = await fixture.db.webhookInbox.findUniqueOrThrow({
      where: { id: accepted.inbox.id },
    });
    assert.equal(stored.processingState, "PROCESSED");
    assert.equal(stored.lastErrorCode, null);
    assert.equal(
      await fixture.db.job.count({
        where: { idempotencyKey: { startsWith: `inbox-retry:${stored.id}:` } },
      }),
      0,
    );
    assert.equal(
      (await fixture.db.orderLedger.findFirstOrThrow()).reconciliationState,
      "TEST_ONLY",
    );
    assert.equal(await fixture.db.attributionV2.count(), 0);
  } finally {
    await fixture.close();
  }
});

test("a deferred stale fetch cannot reconcile after a replacement lease wins", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-race.myshopify.com" },
    });
    const accepted = await acceptedEvent(
      fixture.db,
      merchant.shop,
      "event-race",
    );
    let releaseOld!: (value: ShopifyFinancialSnapshotV2) => void;
    let oldFetchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      oldFetchStarted = resolve;
    });
    const deferred = new Promise<ShopifyFinancialSnapshotV2>((resolve) => {
      releaseOld = resolve;
    });
    const first = processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: SECRET,
      fetchOrder: async () => {
        oldFetchStarted();
        return deferred;
      },
      workerId: "old-worker",
      leaseMs: 1_000,
      now: new Date("2099-09-05T00:00:00.000Z"),
    });
    await started;
    const replacement = await processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: SECRET,
      fetchOrder: async (orderId) =>
        snapshot({ merchantId: merchant.id, orderId }),
      workerId: "replacement-worker",
      now: new Date("2099-09-05T00:00:02.000Z"),
    });
    assert.equal(replacement.duplicate, false);
    releaseOld(
      snapshot({ merchantId: merchant.id, orderId: "gid://shopify/Order/123" }),
    );
    await assert.rejects(first, /STALE_WEBHOOK_INBOX_LEASE/);
    assert.equal(await fixture.db.orderLedger.count(), 1);
    assert.equal(
      (
        await fixture.db.webhookInbox.findUniqueOrThrow({
          where: { id: accepted.inbox.id },
        })
      ).processingState,
      "PROCESSED",
    );
  } finally {
    await fixture.close();
  }
});

test("canonical work that crosses its inbox lease rolls back before a replacement reclaims", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-mid-reconcile-race.myshopify.com" },
    });
    const accepted = await acceptedEvent(
      fixture.db,
      merchant.shop,
      "event-mid-reconcile-race",
    );
    const claimedAt = new Date("2099-09-05T00:00:00.000Z");
    const expiredAt = new Date(claimedAt.getTime() + 2_000);
    let leaseChecks = 0;

    await assert.rejects(
      processFinancialWebhookInboxV2({
        db: fixture.db,
        merchantId: merchant.id,
        inboxId: accepted.inbox.id,
        assignmentSecret: SECRET,
        fetchOrder: async (orderId) =>
          snapshot({ merchantId: merchant.id, orderId }),
        workerId: "expired-during-reconcile",
        leaseMs: 1_000,
        now: claimedAt,
        leaseClock: () => (++leaseChecks < 3 ? claimedAt : expiredAt),
      }),
      /STALE_WEBHOOK_INBOX_LEASE/,
    );
    assert.equal(leaseChecks >= 3, true);
    assert.equal(await fixture.db.financialOrderRevision.count(), 0);
    assert.equal(await fixture.db.orderLedger.count(), 0);

    const replacement = await processFinancialWebhookInboxV2({
      db: fixture.db,
      merchantId: merchant.id,
      inboxId: accepted.inbox.id,
      assignmentSecret: SECRET,
      fetchOrder: async (orderId) =>
        snapshot({ merchantId: merchant.id, orderId }),
      workerId: "replacement-after-rollback",
      now: expiredAt,
    });
    assert.equal(replacement.duplicate, false);
    assert.equal(replacement.retryScheduled, false);
    assert.equal(await fixture.db.financialOrderRevision.count(), 1);
    assert.equal(await fixture.db.orderLedger.count(), 1);
    assert.equal(
      (
        await fixture.db.webhookInbox.findUniqueOrThrow({
          where: { id: accepted.inbox.id },
        })
      ).processingState,
      "PROCESSED",
    );
  } finally {
    await fixture.close();
  }
});

test("the financial worker claims only its tenant and completes through the inbox lease", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-worker.myshopify.com" },
    });
    const other = await fixture.db.merchant.create({
      data: { shop: "inbox-other.myshopify.com" },
    });
    await acceptedEvent(fixture.db, merchant.shop, "event-owned", "123");
    await acceptedEvent(fixture.db, other.shop, "event-other", "456");
    await fixture.db.job.create({
      data: {
        merchantId: merchant.id,
        type: "UNRELATED_JOB",
        idempotencyKey: "unrelated",
        inputHash: "unrelated",
        payloadSchemaVersion: 1,
        payloadJson: "{}",
      },
    });
    const now = new Date("2099-09-05T00:01:00.000Z");
    const outcomes = await runFinancialReconciliationJobsV2({
      db: fixture.db,
      merchantId: merchant.id,
      workerId: "financial-worker",
      assignmentSecret: SECRET,
      fetchOrder: async (orderId) =>
        snapshot({ merchantId: merchant.id, orderId }),
      now,
    });
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.resultRef, "PROCESSED");
    assert.equal(
      (
        await fixture.db.webhookInbox.findFirstOrThrow({
          where: { merchantId: merchant.id },
        })
      ).processingState,
      "PROCESSED",
    );
    assert.equal(
      (
        await fixture.db.job.findFirstOrThrow({
          where: { merchantId: other.id },
        })
      ).status,
      "PENDING",
    );
    assert.equal(
      (
        await fixture.db.job.findFirstOrThrow({
          where: { type: "UNRELATED_JOB" },
        })
      ).status,
      "PENDING",
    );
  } finally {
    await fixture.close();
  }
});

test("exhausted crashed inbox work dead-letters once and opens an operator incident", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inbox-exhausted.myshopify.com" },
    });
    const accepted = await acceptedEvent(
      fixture.db,
      merchant.shop,
      "event-exhausted",
    );
    await fixture.db.webhookInbox.update({
      where: { id: accepted.inbox.id },
      data: {
        processingState: "PROCESSING",
        attempts: 2,
        processingLeaseToken: "crashed:lease",
        processingLeaseUntil: new Date("2026-09-05T00:00:00.000Z"),
      },
    });
    const run = () =>
      processFinancialWebhookInboxV2({
        db: fixture.db,
        merchantId: merchant.id,
        inboxId: accepted.inbox.id,
        assignmentSecret: SECRET,
        fetchOrder: async (orderId) =>
          snapshot({ merchantId: merchant.id, orderId }),
        workerId: "third-worker",
        maxAttempts: 2,
        now: new Date("2099-09-05T00:01:00.000Z"),
      });
    await assert.rejects(run(), /WEBHOOK_INBOX_ATTEMPTS_EXHAUSTED/);
    await assert.rejects(
      run(),
      /WEBHOOK_INBOX_ATTEMPTS_EXHAUSTED|WEBHOOK_INBOX_NOT_CLAIMABLE/,
    );
    const stored = await fixture.db.webhookInbox.findUniqueOrThrow({
      where: { id: accepted.inbox.id },
    });
    assert.equal(stored.processingState, "DEAD_LETTER");
    assert.equal(stored.lastErrorCode, "ATTEMPTS_EXHAUSTED");
    assert.equal(
      await fixture.db.incident.count({
        where: {
          merchantId: merchant.id,
          category: "FINANCIAL_RECONCILIATION_DEAD_LETTER",
        },
      }),
      1,
    );
  } finally {
    await fixture.close();
  }
});

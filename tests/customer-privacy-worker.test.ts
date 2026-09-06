import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { processPrivacyWebhook } from "../app/services/privacy.server";
import { runCustomerPrivacyExportWorker } from "../app/services/customer-privacy-worker.server";

const lookupSecret = "global-worker-lookup-key-at-least-32-characters";
const fieldSecret = "global-worker-field-key-at-least-32-characters";
const environment = {
  NODE_ENV: "production",
  PRIVACY_LOOKUP_KEY: lookupSecret,
  PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]",
  FIELD_ENCRYPTION_KEY: fieldSecret,
};

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-worker-"));
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

async function receive(args: {
  db: PrismaClient;
  shop: string;
  type: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT";
  requestId: number;
  orderId: number;
  now: Date;
}) {
  return processPrivacyWebhook({
    db: args.db,
    shop: args.shop,
    type: args.type,
    payload: {
      data_request: { id: args.requestId },
      customer: { id: 71 },
      [args.type === "CUSTOMERS_DATA_REQUEST"
        ? "orders_requested"
        : "orders_to_redact"]: [args.orderId],
    },
    secret: lookupSecret,
    scopeSecret: fieldSecret,
    now: args.now,
  });
}

test("missing privacy key or encryption configuration fails before claiming a request", async () => {
  const fixture = testDatabase();
  const current = new Date();
  try {
    const request = await receive({
      db: fixture.db,
      shop: "worker-config.myshopify.com",
      type: "CUSTOMERS_DATA_REQUEST",
      requestId: 2001,
      orderId: 101,
      now: current,
    });
    const result = await runCustomerPrivacyExportWorker({
      db: fixture.db,
      environment: {
        NODE_ENV: "production",
        PRIVACY_LOOKUP_KEY: lookupSecret,
        PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]",
      },
    });
    assert.deepEqual(
      {
        ok: result.ok,
        processed: result.processed,
        failures: result.failures,
        configurationError: result.configurationError,
      },
      { ok: false, processed: 0, failures: 0, configurationError: true },
    );
    const saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.status, "PENDING_ORDER_SCOPE");
    assert.equal(saved.attempts, 0);
    assert.equal(saved.leaseToken, null);
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 0);

    const missingLookup = await runCustomerPrivacyExportWorker({
      db: fixture.db,
      environment: {
        NODE_ENV: "production",
        FIELD_ENCRYPTION_KEY: fieldSecret,
      },
    });
    assert.equal(missingLookup.configurationError, true);
    assert.equal(
      (
        await fixture.db.privacyRequest.findUniqueOrThrow({
          where: { id: request.id },
        })
      ).attempts,
      0,
    );
  } finally {
    await fixture.close();
  }
});

test("global worker progresses an uninstalled data copy and redaction without false completion", async () => {
  const fixture = testDatabase();
  const current = new Date();
  try {
    const dataShop = "worker-absent-data.myshopify.com";
    const redactionShop = "worker-pending-redaction.myshopify.com";
    const dataRequest = await receive({
      db: fixture.db,
      shop: dataShop,
      type: "CUSTOMERS_DATA_REQUEST",
      requestId: 2002,
      orderId: 202,
      now: current,
    });
    const redaction = await receive({
      db: fixture.db,
      shop: redactionShop,
      type: "CUSTOMERS_REDACT",
      requestId: 2003,
      orderId: 303,
      now: current,
    });
    assert.equal(await fixture.db.merchant.count(), 0);

    const result = await runCustomerPrivacyExportWorker({
      db: fixture.db,
      environment,
    });
    assert.equal(result.ok, false); // Owner delivery and pending erasure need persistent attention.
    assert.ok(result.processed >= 2);
    assert.equal(result.failures, 0);
    assert.equal(result.readyForOwnerReview, 1);
    assert.equal(result.erasureWorkerImplemented, true);
    assert.equal(result.deliveryVerified, false);
    assert.equal(await fixture.db.merchant.count(), 0);
    assert.equal(
      (
        await fixture.db.privacyRequest.findUniqueOrThrow({
          where: { id: dataRequest.id },
        })
      ).status,
      "EXPORT_READY_OWNER_DELIVERY",
    );
    const redactionState = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: redaction.id },
    });
    assert.ok(["ACTIVE_DATA_ERASED_BACKUP_REVIEW", "PENDING_ORDER_SCOPE"].includes(redactionState.status));
    assert.equal(redactionState.completedAt, null);
    assert.equal(redactionState.attempts, 0);
    assert.ok(await fixture.db.privacyArtifactChunk.count() >= 1);

    const summary = JSON.stringify(result);
    for (const secret of [
      dataShop,
      redactionShop,
      dataRequest.id,
      redaction.id,
      "202",
      "303",
      lookupSecret,
      fieldSecret,
    ])
      assert.equal(summary.includes(secret), false);
    assert.deepEqual(Object.keys(result).sort(), [
      "configurationError",
      "deliveryVerified",
      "erasureWorkerImplemented",
      "failures",
      "ok",
      "overdueEscalated",
      "processed",
      "purged",
      "readyForOwnerReview",
      "reviewRequired",
    ]);
  } finally {
    await fixture.close();
  }
});

test("overdue customer requests escalate without being claimed or falsely completed", async () => {
  const fixture = testDatabase();
  const requestedAt = new Date(Date.now() - 31 * 86_400_000);
  try {
    const request = await receive({
      db: fixture.db,
      shop: "worker-overdue.myshopify.com",
      type: "CUSTOMERS_DATA_REQUEST",
      requestId: 2004,
      orderId: 404,
      now: requestedAt,
    });
    const result = await runCustomerPrivacyExportWorker({
      db: fixture.db,
      environment,
    });
    assert.equal(result.ok, false);
    assert.equal(result.overdueEscalated, 1);
    assert.equal(result.processed, 0);
    assert.equal(result.readyForOwnerReview, 0);
    assert.equal(result.reviewRequired, 1);
    const saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.status, "REVIEW_REQUIRED_DEADLINE");
    assert.equal(saved.lastErrorCode, "PRIVACY_DEADLINE_REACHED");
    assert.equal(saved.attempts, 0);
    assert.equal(saved.leaseToken, null);
    assert.equal(saved.completedAt, null);
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 0);
  } finally {
    await fixture.close();
  }
});

test("ready and review requests retain key checks and never turn healthy while attention persists", async () => {
  const fixture = testDatabase();
  try {
    const request = await receive({ db: fixture.db, shop: "worker-ready-keys.myshopify.com",
      type: "CUSTOMERS_DATA_REQUEST", requestId: 2010, orderId: 410, now: new Date() });
    await runCustomerPrivacyExportWorker({ db: fixture.db, environment });
    const healthyKeys = await runCustomerPrivacyExportWorker({ db: fixture.db, environment });
    assert.equal(healthyKeys.configurationError, false);
    assert.equal(healthyKeys.ok, false);
    for (const changed of [{ ...environment, PRIVACY_LOOKUP_KEY: undefined },
      { ...environment, FIELD_ENCRYPTION_KEY: undefined },
      { ...environment, FIELD_ENCRYPTION_KEY: "different-active-field-key-at-least-32-characters" }]) {
      const result = await runCustomerPrivacyExportWorker({ db: fixture.db, environment: changed });
      assert.equal(result.configurationError, true);
      assert.equal(result.ok, false);
      assert.equal(result.processed, 0);
    }
    const rotated = await runCustomerPrivacyExportWorker({ db: fixture.db, environment: {
      ...environment, FIELD_ENCRYPTION_KEY: "different-active-field-key-at-least-32-characters",
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify([fieldSecret]),
    } });
    assert.equal(rotated.configurationError, false);
    await fixture.db.privacyRequest.update({ where: { id: request.id },
      data: { status: "REVIEW_REQUIRED_DEADLINE", dueAt: new Date(Date.now() - 1000) } });
    for (let tick = 0; tick < 2; tick++) {
      const result = await runCustomerPrivacyExportWorker({ db: fixture.db, environment });
      assert.equal(result.overdueEscalated, 0);
      assert.equal(result.ok, false);
      assert.equal(result.reviewRequired, 1);
    }
  } finally { await fixture.close(); }
});

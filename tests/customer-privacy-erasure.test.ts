import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

import { processCustomerPrivacyErasureStep } from "../app/services/customer-privacy-erasure.server";
import { claimCustomerPrivacyRequest } from "../app/services/customer-privacy-queue.server";
import { processPrivacyWebhook } from "../app/services/privacy.server";
import { assertOrderNotSuppressed, PrivacyOrderSuppressedError } from "../app/services/order-privacy-guard.server";

const now = new Date("2026-09-05T12:00:00.000Z");
const lookup = "erasure-test-lookup-key-at-least-32-characters";
const field = "erasure-test-field-key-at-least-32-characters";
const environment = { NODE_ENV: "production", PRIVACY_LOOKUP_KEY: lookup,
  PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]", FIELD_ENCRYPTION_KEY: field,
  SHOPIFY_API_SECRET: "erasure-test-independent-api-secret-32-characters" };
const shop = "privacy-erasure-test.myshopify.com";
const order = (id: number) => `gid://shopify/Order/${id}`;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-erasure-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  return { db, async close() { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

async function requestAndClaim(db: PrismaClient, id: number, orderIds: number[]) {
  const request = await processPrivacyWebhook({ db, shop, type: "CUSTOMERS_REDACT", secret: lookup,
    scopeSecret: field, now, payload: { data_request: { id }, customer: { id: 42 }, orders_to_redact: orderIds } });
  const lease = await claimCustomerPrivacyRequest({ db, requestTypes: ["CUSTOMERS_REDACT"], now });
  assert.ok(lease);
  assert.equal(lease.request.id, request.id);
  return lease;
}

test("redaction worker erases exact financial scope, preserves other orders and leaves explicit backup review", async () => {
  const f = fixture();
  try {
    const merchant = await f.db.merchant.create({ data: { shop } });
    await f.db.storeOrder.createMany({ data: [
      { merchantId: merchant.id, shopifyOrderId: order(9001), orderNumber: "9001", currencyCode: "USD", grossAmount: "10.00", netAmount: "10.00", financialStatus: "paid", occurredAt: now },
      { merchantId: merchant.id, shopifyOrderId: order(9002), orderNumber: "9002", currencyCode: "USD", grossAmount: "12.00", netAmount: "12.00", financialStatus: "paid", occurredAt: now },
    ] });
    let lease = await requestAndClaim(f.db, 9001, [9001]);
    let terminal: Awaited<ReturnType<typeof processCustomerPrivacyErasureStep>> | null = null;
    for (let step = 0; step < 10; step++) {
      terminal = await processCustomerPrivacyErasureStep({ db: f.db, lease, environment, now });
      const saved = await f.db.privacyRequest.findUniqueOrThrow({ where: { id: lease.request.id } });
      if (saved.status === "ACTIVE_DATA_ERASED_BACKUP_REVIEW") break;
      lease = (await claimCustomerPrivacyRequest({ db: f.db, requestTypes: ["CUSTOMERS_REDACT"], now }))!;
    }
    assert.ok(terminal?.activeGraphErasureVerified);
    const saved = await f.db.privacyRequest.findUniqueOrThrow({ where: { id: lease.request.id } });
    assert.equal(saved.status, "ACTIVE_DATA_ERASED_BACKUP_REVIEW");
    assert.equal(saved.completedAt, null);
    assert.equal((await f.db.storeOrder.count({ where: { merchantId: merchant.id, shopifyOrderId: order(9001) } })), 0);
    assert.equal((await f.db.storeOrder.count({ where: { merchantId: merchant.id, shopifyOrderId: order(9002) } })), 1);
    assert.equal((await f.db.privacyOrderSuppression.count()), 1);
    assert.ok((await f.db.privacyArtifactChunk.count({ where: { kind: "ERASURE_GRAPH" } })) >= 1);
    await assert.rejects(f.db.$transaction((tx) => assertOrderNotSuppressed({ tx, merchantId: merchant.id, orderId: order(9001), environment })), PrivacyOrderSuppressedError);
    await f.db.$transaction((tx) => assertOrderNotSuppressed({ tx, merchantId: merchant.id, orderId: order(9002), environment }));
    const details = JSON.parse(saved.detailsJson) as Record<string, unknown>;
    assert.equal(details.activeDataErasureVerified, false);
    assert.equal(details.backupErasureVerified, false);
    assert.equal((details.erasure as Record<string, unknown>).activeGraphErasureVerified, true);
  } finally { await f.close(); }
});

test("stale erasure lease cannot stage suppression, graph or deletion", async () => {
  const f = fixture();
  try {
    const merchant = await f.db.merchant.create({ data: { shop: "privacy-erasure-stale.myshopify.com" } });
    const request = await processPrivacyWebhook({ db: f.db, shop: merchant.shop, type: "CUSTOMERS_REDACT", secret: lookup,
      scopeSecret: field, now, payload: { data_request: { id: 9002 }, customer: { id: 42 }, orders_to_redact: [9901] } });
    const lease = (await claimCustomerPrivacyRequest({ db: f.db, requestTypes: ["CUSTOMERS_REDACT"], now }))!;
    await f.db.privacyRequest.update({ where: { id: request.id }, data: { leaseUntil: new Date(now.getTime() - 1) } });
    await assert.rejects(processCustomerPrivacyErasureStep({ db: f.db, lease, environment, now }), /STALE_PRIVACY_LEASE|PRIVACY_LEASE_LOST/);
    assert.equal(await f.db.privacyOrderSuppression.count(), 0);
    assert.equal(await f.db.privacyArtifactChunk.count(), 0);
    assert.equal((await f.db.privacyRequest.findUniqueOrThrow({ where: { id: request.id } })).completedAt, null);
  } finally { await f.close(); }
});

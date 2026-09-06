import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { processPrivacyWebhook } from "../app/services/privacy.server";
import { privacyOrderIds } from "../app/services/customer-privacy-scope.server";
import { decryptField, encryptField } from "../app/services/field-encryption.server";
import { stagePrivacyOrderSuppression } from "../app/services/order-privacy-guard.server";
import {
  claimCustomerPrivacyRequest, readCustomerPrivacyScope, releaseCustomerPrivacyFailure,
  renewCustomerPrivacyLease,
  customerPrivacyRequestSummary,
} from "../app/services/customer-privacy-queue.server";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-privacy-v2-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
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

test("order suppression staging is bounded, exact, replay-safe and lease guarded", async () => {
  const fixture = testDatabase();
  const scopeSecret = "synthetic-field-encryption-key-32-bytes";
  const secret = "privacy-secret";
  const now = new Date();
  try {
    const orderIds = Array.from({ length: 105 }, (_, index) => index + 1);
    await processPrivacyWebhook({ db: fixture.db, shop: "batch-scope.myshopify.com", type: "CUSTOMERS_REDACT",
      payload: { orders_to_redact: orderIds }, secret, scopeSecret, now });
    const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(lease);
    await assert.rejects(stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret, now, offset: 100 }), /BATCH_GAP/);
    const first = await stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret, now });
    assert.deepEqual(first, { staged: 100, nextOffset: 100, allScopeStaged: false });
    await stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret, now });
    assert.equal(await fixture.db.privacyOrderSuppression.count(), 100);
    assert.deepEqual(await stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret, now, offset: 100 }),
      { staged: 5, nextOffset: 105, allScopeStaged: true });
    assert.deepEqual(await stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret, now, offset: 105 }),
      { staged: 0, nextOffset: 105, allScopeStaged: true });
    const rows = await fixture.db.privacyOrderSuppression.findMany();
    assert.equal(rows.length, 105);
    const evidence = JSON.parse((await fixture.db.privacyRequest.findUniqueOrThrow({ where: { id: lease.request.id } })).detailsJson).suppression;
    assert.equal(evidence.nextOffset, 105);
    assert.equal(evidence.state, "SCOPE_STAGED");
    assert.equal(evidence.backupJournalVerified, false);
    const repeatedRequest = await processPrivacyWebhook({ db: fixture.db, shop: "batch-scope.myshopify.com",
      type: "CUSTOMERS_REDACT", payload: { customer: { id: 2 }, orders_to_redact: orderIds }, secret, scopeSecret, now });
    const secondLease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(secondLease);
    assert.equal(secondLease.request.id, repeatedRequest.id);
    await stagePrivacyOrderSuppression({ db: fixture.db, lease: secondLease, scopeSecret, secret, now, offset: 105 });
    assert.equal(await fixture.db.privacyOrderSuppression.count(), 105);
    assert.equal(JSON.parse((await fixture.db.privacyRequest.findUniqueOrThrow({ where: { id: repeatedRequest.id } })).detailsJson).suppression.state, "SCOPE_STAGED");
    assert.doesNotMatch(JSON.stringify(rows), /myshopify|gid:\/\/|orderIds/);
    await assert.rejects(stagePrivacyOrderSuppression({ db: fixture.db, lease, scopeSecret, secret,
      now: new Date(now.getTime() + 60_000) }), /STALE_PRIVACY_LEASE/);
    assert.equal((await fixture.db.privacyRequest.findUniqueOrThrow({ where: { id: lease.request.id } })).completedAt, null);
  } finally { await fixture.close(); }
});

test("customer privacy queue survives uninstall and rejects expired or superseded authority", async () => {
  const fixture = testDatabase();
  const now = new Date("2026-09-05T12:00:00Z");
  try {
    const request = await processPrivacyWebhook({ db: fixture.db, shop: "absent-merchant.myshopify.com",
      type: "CUSTOMERS_REDACT", payload: { orders_to_redact: [123] }, secret: "privacy-secret",
      scopeSecret: "synthetic-field-encryption-key-32-bytes", now });
    assert.equal(await fixture.db.merchant.count(), 0);
    const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(lease);
    assert.equal(lease.request.id, request.id);
    assert.equal(lease.request.attempts, 1);
    assert.equal(await claimCustomerPrivacyRequest({ db: fixture.db, now }), null);
    const expiredAt = new Date(now.getTime() + 60_000);
    assert.equal(await renewCustomerPrivacyLease({ db: fixture.db, lease, now: expiredAt }), false);
    assert.equal(await releaseCustomerPrivacyFailure({ db: fixture.db, lease, now: expiredAt,
      code: "PRIVACY_STORAGE_UNAVAILABLE" }), false);
    const replacement = await claimCustomerPrivacyRequest({ db: fixture.db, now: expiredAt });
    assert.ok(replacement);
    assert.notEqual(replacement.token, lease.token);
    assert.equal(replacement.request.attempts, 2);
    assert.equal(await releaseCustomerPrivacyFailure({ db: fixture.db, lease, now: expiredAt,
      code: "PRIVACY_SCOPE_INVALID" }), false);
    assert.equal(await renewCustomerPrivacyLease({ db: fixture.db, lease: replacement, now: expiredAt }), true);
    assert.equal(await releaseCustomerPrivacyFailure({ db: fixture.db, lease: replacement, now: expiredAt,
      code: "PRIVACY_STORAGE_UNAVAILABLE" }), true);
    const pending = await fixture.db.privacyRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(pending.status, "PENDING_ORDER_SCOPE");
    assert.equal(pending.completedAt, null);
    assert.equal(pending.nextRunAt?.getTime(), expiredAt.getTime() + 60_000);
    assert.equal(pending.leaseToken, null);
    assert.equal(await claimCustomerPrivacyRequest({ db: fixture.db, now: expiredAt }), null);
  } finally { await fixture.close(); }
});

test("privacy scope requires authenticated exact tenant ciphertext, never plaintext or empty fallback", async () => {
  const fixture = testDatabase();
  const scopeSecret = "synthetic-field-encryption-key-32-bytes";
  const privacySecret = "privacy-secret";
  try {
    const request = await processPrivacyWebhook({ db: fixture.db, shop: "scope-check.myshopify.com",
      type: "CUSTOMERS_DATA_REQUEST", payload: { orders_requested: [123, 124] },
      secret: privacySecret, scopeSecret });
    const scope = { version: 2, shop: "scope-check.myshopify.com", orderIds: ["gid://shopify/Order/123", "gid://shopify/Order/124"],
      installationGenerationHash: null };
    const summary = customerPrivacyRequestSummary(request);
    assert.deepEqual(Object.keys(summary).sort(), ["id", "requestType", "status", "requestedAt", "completedAt", "dueAt"].sort());
    assert.doesNotMatch(JSON.stringify(summary), /scopeCiphertext|subjectHash|shopHash|leaseToken|idempotencyKey|orderIds|enc:v1/);
    assert.deepEqual(readCustomerPrivacyScope({ request, scopeSecret, privacySecret }), scope);
    assert.throws(() => readCustomerPrivacyScope({ request, scopeSecret: "wrong-key-that-is-at-least-32-bytes", privacySecret }), /PRIVACY_SCOPE_INVALID/);
    assert.throws(() => readCustomerPrivacyScope({ request, scopeSecret, privacySecret: "another-tenant-key" }), /TENANT_MISMATCH/);
    assert.throws(() => readCustomerPrivacyScope({ request: { ...request, scopeCiphertext: JSON.stringify(scope) }, scopeSecret, privacySecret }), /UNREADABLE/);
    for (const bad of [ { ...scope, orderIds: [] }, { ...scope, orderIds: [123] },
      { ...scope, orderIds: [...scope.orderIds].reverse() }, { ...scope, version: 3 },
      { ...scope, shop: "https://scope-check.myshopify.com" } ]) {
      assert.throws(() => readCustomerPrivacyScope({ request: { ...request, scopeCiphertext: encryptField(bad, scopeSecret) }, scopeSecret, privacySecret }), /PRIVACY_/);
    }
    assert.throws(() => readCustomerPrivacyScope({ request: { ...request, scopeCiphertext: encryptField({ ...scope, shop: "different.myshopify.com" }, scopeSecret) }, scopeSecret, privacySecret }), /TENANT_MISMATCH/);
  } finally { await fixture.close(); }
});

test("privacy queue escalates scope failures, deadlines and retry limits without false completion", async () => {
  const fixture = testDatabase();
  const now = new Date("2026-09-05T12:00:00Z");
  try {
    for (const [index, scenario] of ["scope", "retries", "deadline", "deadline-backoff"].entries()) {
      const request = await processPrivacyWebhook({ db: fixture.db, shop: "review.myshopify.com",
        type: "CUSTOMERS_REDACT", payload: { orders_to_redact: [index + 1] },
        secret: "privacy-secret", scopeSecret: "synthetic-field-encryption-key-32-bytes", now });
      if (scenario === "retries") await fixture.db.privacyRequest.update({ where: { id: request.id }, data: { attempts: 10 } });
      if (scenario.startsWith("deadline")) await fixture.db.privacyRequest.update({ where: { id: request.id },
        data: { dueAt: new Date(now.getTime() + (scenario === "deadline" ? 0 : 10_000)) } });
      const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
      if (scenario === "scope" || scenario === "deadline-backoff") {
        assert.ok(lease);
        assert.equal(await releaseCustomerPrivacyFailure({ db: fixture.db, lease, now,
          code: scenario === "scope" ? "PRIVACY_SCOPE_UNREADABLE" : "PRIVACY_STORAGE_UNAVAILABLE" }), true);
      } else assert.equal(lease, null);
      const current = await fixture.db.privacyRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(current.status, scenario === "scope" ? "REVIEW_REQUIRED_SCOPE" :
        scenario === "retries" ? "REVIEW_REQUIRED_RETRIES" : "REVIEW_REQUIRED_DEADLINE");
      assert.equal(current.completedAt, null);
      assert.equal(current.nextRunAt, null);
      assert.equal(current.leaseToken, null);
    }
  } finally { await fixture.close(); }
});

test("shop redaction cascades immutable financial revisions and links", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "privacy-v2.myshopify.com" },
    });
    const revision = await fixture.db.financialOrderRevision.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: "gid://shopify/Order/1",
        sourceUpdatedAt: new Date("2026-09-05T00:00:00.000Z"),
        firstObservedAt: new Date("2026-09-05T00:01:00.000Z"),
        sourceHash: "source-hash",
        revisionHash: "revision-hash",
        canonicalPayload: JSON.stringify({
          orderId: "gid://shopify/Order/1",
          customer: "must-never-appear",
        }),
        links: {
          create: {
            merchantId: merchant.id,
            experimentId: "experiment-1",
            assignmentId: "assignment-1",
            shopifyLineId: "gid://shopify/LineItem/1",
            signedRefHash: "signed-reference-hash",
          },
        },
      },
    });
    await fixture.db.evaluationConsumption.create({
      data: {
        merchantId: merchant.id,
        allowanceKey: "MESSAGE_TEST_V1",
        experimentId: "experiment-1",
        offerVersion: "founding-beta-v1",
        inputHash: "evaluation-input-hash",
      },
    });
    assert.ok(revision.id);
    await fixture.db.$executeRawUnsafe(`CREATE TRIGGER privacy_receipt_failure BEFORE INSERT ON "PrivacyRequest"
      BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END`);
    await assert.rejects(processPrivacyWebhook({ db: fixture.db, shop: merchant.shop,
      type: "SHOP_REDACT", payload: { shop_id: 1 }, secret: "privacy-secret" }));
    assert.equal(await fixture.db.merchant.count(), 1);
    assert.equal(await fixture.db.financialOrderRevision.count(), 1);
    assert.equal(await fixture.db.financialRevisionLink.count(), 1);
    await fixture.db.$executeRawUnsafe("DROP TRIGGER privacy_receipt_failure");
    const request = await processPrivacyWebhook({
      db: fixture.db,
      shop: merchant.shop,
      type: "SHOP_REDACT",
      payload: { shop_id: 1 },
      secret: "privacy-secret",
    });
    assert.equal(await fixture.db.merchant.count(), 0);
    assert.equal(await fixture.db.financialOrderRevision.count(), 0);
    assert.equal(await fixture.db.financialRevisionLink.count(), 0);
    assert.equal(await fixture.db.evaluationConsumption.count(), 0);
    assert.equal(request.status, "ACTIVE_DATA_DELETED_BACKUP_REVIEW");
    assert.equal(request.completedAt, null);
    assert.doesNotMatch(request.detailsJson, /must-never-appear/);
    assert.deepEqual(JSON.parse(request.detailsJson), {
      directCustomerProfileDataStored: false,
      pseudonymousTelemetryStored: true,
      customerIdentityJoinAvailable: false,
      telemetryUsesOpaqueVisitorIdentifiers: true,
      merchantDeleted: true,
      activeMerchantDataDeleted: true,
      retainedPrivacyWorkflowRecords: true,
      backupErasureVerified: false,
      financialOrderRevisionsDeleted: 1,
      financialRevisionLinksDeleted: 1,
      evaluationConsumptionsDeleted: 1,
    });
  } finally {
    await fixture.close();
  }
});

test("customer redaction without order scope requires review rather than claiming no personal data", async () => {
  const fixture = testDatabase();
  try {
    await fixture.db.merchant.create({
      data: { shop: "privacy-customer-v2.myshopify.com" },
    });
    const request = await processPrivacyWebhook({
      db: fixture.db,
      shop: "privacy-customer-v2.myshopify.com",
      type: "CUSTOMERS_REDACT",
      payload: { customer: { id: 123 } },
      secret: "privacy-secret",
    });
    const details = JSON.parse(request.detailsJson) as Record<string, unknown>;
    assert.equal(request.status, "REVIEW_REQUIRED_NO_ORDER_SCOPE");
    assert.equal(request.completedAt, null);
    assert.equal(details.customerIdentityJoinAvailable, false);
    assert.equal(details.orderIdentifiersProvided, 0);
    assert.equal(details.activeDataErasureVerified, false);
    assert.equal(await fixture.db.merchant.count(), 1);
  } finally {
    await fixture.close();
  }
});

test("customer order privacy intake encrypts exact scope, dedupes replay and never claims delivery or erasure", async () => {
  const fixture = testDatabase();
  const scopeSecret = "synthetic-field-encryption-key-32-bytes";
  const now = new Date("2026-09-05T12:00:00Z");
  try {
    const shop = "privacy-orders.myshopify.com";
    await fixture.db.merchant.create({ data: { shop } });
    const args = { db: fixture.db, shop, type: "CUSTOMERS_REDACT" as const,
      secret: "synthetic-privacy-lookup-key", scopeSecret, now,
      payload: { customer: { id: 123, email: "private-fixture@example.test", phone: "never-store-this" },
        orders_to_redact: [299938, "gid://shopify/Order/280263", "299938"] } };
    await assert.rejects(processPrivacyWebhook({ ...args, scopeSecret: "too-short" }), /ENCRYPTION_REQUIRED/);
    assert.equal(await fixture.db.privacyRequest.count(), 0);
    await assert.rejects(processPrivacyWebhook({ ...args, type: "CUSTOMERS_DATA_REQUEST",
      payload: { orders_requested: [1], data_request: { id: Number.MAX_SAFE_INTEGER + 1 } } }), /REQUEST_ID_INVALID/);
    const received = await processPrivacyWebhook(args);
    assert.equal(received.status, "PENDING_ORDER_SCOPE");
    assert.equal(received.completedAt, null);
    assert.equal(received.dueAt!.toISOString(), "2026-10-05T12:00:00.000Z");
    assert.match(received.scopeCiphertext!, /^enc:v1:/);
    assert.doesNotMatch(JSON.stringify(received), /299938|280263|private-fixture|never-store-this/);
    const encryptedScope = decryptField<{ version: number; shop: string; orderIds: string[]; installationGenerationHash: string }>(received.scopeCiphertext, scopeSecret)!;
    assert.deepEqual({ version: encryptedScope.version, shop: encryptedScope.shop, orderIds: encryptedScope.orderIds }, {
      version: 2, shop, orderIds: ["gid://shopify/Order/280263", "gid://shopify/Order/299938"],
    });
    assert.match(encryptedScope.installationGenerationHash, /^[a-f0-9]{64}$/);
    assert.equal(decryptField(received.scopeCiphertext, "different-synthetic-encryption-key"), null);
    assert.equal((await processPrivacyWebhook({ ...args, now: new Date(now.getTime() + 1000) })).id, received.id);
    assert.equal(await fixture.db.privacyRequest.count(), 1);
    assert.equal(await fixture.db.merchantNotice.count(), 1);
    await fixture.db.privacyRequest.update({ where: { id: received.id }, data: { status: "PROCESSING", attempts: 2 } });
    assert.equal((await processPrivacyWebhook(args)).status, "PROCESSING");
    assert.equal((await processPrivacyWebhook(args)).attempts, 2);
    const dataRequest = await processPrivacyWebhook({ ...args, type: "CUSTOMERS_DATA_REQUEST",
      payload: { customer: { id: 123 }, orders_requested: [299938], data_request: { id: 9999 } } });
    assert.notEqual(dataRequest.id, received.id);
    assert.equal(JSON.parse(dataRequest.detailsJson).deliveryConfirmed, false);
    const other = await processPrivacyWebhook({ ...args, shop: "uninstalled-other.myshopify.com" });
    assert.notEqual(other.id, received.id);
    assert.notEqual(other.shopHash, received.shopHash);
    assert.equal(await fixture.db.merchant.count(), 1, "privacy intake must not recreate an uninstalled merchant");
  } finally { await fixture.close(); }
});

test("privacy order scope rejects malformed or lossy identifiers without silently dropping work", () => {
  assert.deepEqual(privacyOrderIds([1, "1", "gid://shopify/Order/2"]), ["gid://shopify/Order/1", "gid://shopify/Order/2"]);
  for (const value of [[Number.MAX_SAFE_INTEGER + 1], ["gid://shopify/Customer/1"], [-1], ["1x"], [null], "1", Array(10_001).fill(1)])
    assert.throws(() => privacyOrderIds(value), /PRIVACY_ORDER_/);
});

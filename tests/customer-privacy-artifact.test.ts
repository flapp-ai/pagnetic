import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  processCustomerPrivacyExportStep,
  purgeExpiredCustomerPrivacyArtifacts,
} from "../app/services/customer-privacy-artifact.server";
import { claimCustomerPrivacyRequest } from "../app/services/customer-privacy-queue.server";
import { decryptField } from "../app/services/field-encryption.server";
import { processPrivacyWebhook } from "../app/services/privacy.server";

const scopeSecret = "privacy-artifact-field-key-at-least-32-characters";
const lookupSecret = "privacy-artifact-lookup-key-at-least-32-characters";
const now = new Date("2026-09-05T12:00:00.000Z");
const orderId = (id: number) => `gid://shopify/Order/${id}`;

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-artifact-"));
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

async function receiveDataRequest(args: {
  db: PrismaClient;
  shop: string;
  orders: number[];
  requestId: number;
}) {
  return processPrivacyWebhook({
    db: args.db,
    shop: args.shop,
    type: "CUSTOMERS_DATA_REQUEST",
    payload: {
      data_request: { id: args.requestId },
      customer: { id: 44 },
      orders_requested: args.orders,
    },
    secret: lookupSecret,
    scopeSecret,
    now,
  });
}

test("one exact-order export commits only an encrypted tenant-scoped artifact and remains undelivered", async () => {
  const fixture = testDatabase();
  try {
    const shop = "artifact-export.myshopify.com";
    const merchant = await fixture.db.merchant.create({ data: { shop } });
    const other = await fixture.db.merchant.create({
      data: { shop: "artifact-export-other.myshopify.com" },
    });
    await fixture.db.storeOrder.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderId(1),
        orderNumber: "requested-order-number",
        currencyCode: "USD",
        grossAmount: "12.34",
        netAmount: "12.34",
        financialStatus: "paid",
        occurredAt: now,
      },
    });
    await fixture.db.storeOrder.create({
      data: {
        merchantId: other.id,
        shopifyOrderId: orderId(1),
        orderNumber: "cross-tenant-private-number",
        currencyCode: "USD",
        grossAmount: "9876.54",
        netAmount: "9876.54",
        financialStatus: "paid",
        occurredAt: now,
      },
    });
    await fixture.db.pixelCredential.create({
      data: {
        merchantId: merchant.id,
        tokenHash: "must-not-enter-customer-artifact",
        endpoint: "https://private.internal/events",
      },
    });
    const request = await receiveDataRequest({
      db: fixture.db,
      shop,
      orders: [1],
      requestId: 1001,
    });
    const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(lease && lease.request.id === request.id);
    const result = await processCustomerPrivacyExportStep({
      db: fixture.db,
      lease,
      scopeSecret,
      privacySecret: lookupSecret,
      now,
    });
    assert.deepEqual(result, {
      processedOrderCount: 1,
      totalOrders: 1,
      readyForDelivery: true,
    });

    const artifact = await fixture.db.privacyArtifactChunk.findUniqueOrThrow({
      where: {
        requestId_kind_ordinal: {
          requestId: request.id,
          kind: "CUSTOMER_DATA_COPY",
          ordinal: 0,
        },
      },
    });
    assert.match(artifact.payloadCiphertext, /^enc:v1:/);
    assert.equal(
      artifact.ciphertextHash,
      createHash("sha256").update(artifact.payloadCiphertext).digest("hex"),
    );
    for (const plaintext of [
      shop,
      orderId(1),
      "requested-order-number",
      "cross-tenant-private-number",
      "9876.54",
      "must-not-enter-customer-artifact",
      "private.internal",
    ])
      assert.doesNotMatch(
        artifact.payloadCiphertext,
        new RegExp(plaintext.replaceAll(".", "\\.")),
      );

    const envelope = decryptField<Record<string, unknown>>(
      artifact.payloadCiphertext,
      scopeSecret,
    );
    assert.ok(envelope);
    assert.equal(envelope.requestId, request.id);
    assert.equal(envelope.orderOrdinal, 0);
    assert.equal(envelope.orderId, orderId(1));
    assert.equal(envelope.deliveryConfirmed, false);
    assert.equal(envelope.merchantAbsentAtCollection, false);
    const serializedEnvelope = JSON.stringify(envelope);
    assert.match(serializedEnvelope, /requested-order-number/);
    assert.doesNotMatch(
      serializedEnvelope,
      /cross-tenant-private-number|9876\.54/,
    );
    assert.doesNotMatch(
      serializedEnvelope,
      /must-not-enter-customer-artifact|private\.internal/,
    );

    const saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.status, "EXPORT_READY_OWNER_DELIVERY");
    assert.equal(saved.completedAt, null);
    assert.equal(saved.attempts, 0);
    assert.equal(saved.leaseToken, null);
    assert.equal(JSON.parse(saved.detailsJson).deliveryConfirmed, false);
    assert.equal(JSON.parse(saved.detailsJson).export.nextOffset, 1);
    assert.equal(
      JSON.parse(saved.detailsJson).export.state,
      "ACTIVE_DATA_COLLECTED_DELIVERY_AND_SCOPE_REVIEW_REQUIRED",
    );
  } finally {
    await fixture.close();
  }
});

test("more than ten absent-merchant orders progress one encrypted chunk per tick without retry exhaustion or merchant recreation", async () => {
  const fixture = testDatabase();
  try {
    const shop = "artifact-uninstalled.myshopify.com";
    const orders = Array.from({ length: 12 }, (_, index) => index + 1);
    const request = await receiveDataRequest({
      db: fixture.db,
      shop,
      orders,
      requestId: 1002,
    });
    for (let index = 0; index < orders.length; index += 1) {
      const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
      assert.ok(lease && lease.request.id === request.id);
      assert.equal(lease.request.attempts, 1);
      const result = await processCustomerPrivacyExportStep({
        db: fixture.db,
        lease,
        scopeSecret,
        privacySecret: lookupSecret,
        now,
      });
      assert.equal(result.processedOrderCount, index + 1);
      assert.equal(result.totalOrders, orders.length);
      assert.equal(result.readyForDelivery, index + 1 === orders.length);
    }
    assert.equal(await fixture.db.merchant.count(), 0);
    const artifacts = await fixture.db.privacyArtifactChunk.findMany({
      where: { requestId: request.id },
      orderBy: { ordinal: "asc" },
    });
    assert.deepEqual(
      artifacts.map((artifact) => artifact.ordinal),
      orders.map((_, index) => index),
    );
    assert.equal(artifacts.length, 12);
    const first = decryptField<Record<string, unknown>>(
      artifacts[0].payloadCiphertext,
      scopeSecret,
    );
    assert.ok(first);
    assert.equal(first.export, null);
    assert.equal(first.merchantAbsentAtCollection, true);
    assert.equal(first.backupSearchVerified, false);
    const saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.status, "EXPORT_READY_OWNER_DELIVERY");
    assert.equal(saved.attempts, 0);
    assert.equal(saved.completedAt, null);
    assert.equal(JSON.parse(saved.detailsJson).export.nextOffset, 12);
  } finally {
    await fixture.close();
  }
});

test("expired, superseded or scope-mutated leases roll back artifact and cursor writes", async () => {
  const fixture = testDatabase();
  try {
    const request = await receiveDataRequest({
      db: fixture.db,
      shop: "artifact-lease.myshopify.com",
      orders: [1],
      requestId: 1003,
    });
    const stale = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(stale && stale.request.id === request.id);
    const afterExpiry = new Date(now.getTime() + 60_000);
    const replacement = await claimCustomerPrivacyRequest({
      db: fixture.db,
      now: afterExpiry,
    });
    assert.ok(replacement && replacement.request.id === request.id);
    await assert.rejects(
      processCustomerPrivacyExportStep({
        db: fixture.db,
        lease: stale,
        scopeSecret,
        privacySecret: lookupSecret,
        now: afterExpiry,
      }),
      /PRIVACY_LEASE_LOST/,
    );
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 0);
    assert.equal(
      JSON.parse(
        (
          await fixture.db.privacyRequest.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).detailsJson,
      ).export,
      undefined,
    );

    await fixture.db.privacyRequest.update({
      where: { id: request.id },
      data: {
        scopeCiphertext: `${replacement.request.scopeCiphertext}tampered`,
      },
    });
    await assert.rejects(
      processCustomerPrivacyExportStep({
        db: fixture.db,
        lease: replacement,
        scopeSecret,
        privacySecret: lookupSecret,
        now: afterExpiry,
      }),
      /PRIVACY_LEASE_LOST/,
    );
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 0);
  } finally {
    await fixture.close();
  }
});

test("redaction requests are rejected without artifact or request mutation", async () => {
  const fixture = testDatabase();
  try {
    const request = await processPrivacyWebhook({
      db: fixture.db,
      shop: "artifact-redaction.myshopify.com",
      type: "CUSTOMERS_REDACT",
      payload: {
        data_request: { id: 1004 },
        customer: { id: 44 },
        orders_to_redact: [1],
      },
      secret: lookupSecret,
      scopeSecret,
      now,
    });
    const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(lease && lease.request.id === request.id);
    const before = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    await assert.rejects(
      processCustomerPrivacyExportStep({
        db: fixture.db,
        lease,
        scopeSecret,
        privacySecret: lookupSecret,
        now,
      }),
      /PRIVACY_EXPORT_REQUEST_TYPE_INVALID/,
    );
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 0);
    assert.deepEqual(
      await fixture.db.privacyRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
      before,
    );
  } finally {
    await fixture.close();
  }
});

test("expired undelivered artifacts are purged while the request remains incomplete and review-required", async () => {
  const fixture = testDatabase();
  try {
    const request = await receiveDataRequest({
      db: fixture.db,
      shop: "artifact-expiry.myshopify.com",
      orders: [1],
      requestId: 1005,
    });
    const lease = await claimCustomerPrivacyRequest({ db: fixture.db, now });
    assert.ok(lease && lease.request.id === request.id);
    const collected = await processCustomerPrivacyExportStep({
      db: fixture.db,
      lease,
      scopeSecret,
      privacySecret: lookupSecret,
      now,
    });
    assert.equal(collected.readyForDelivery, true);
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 1);
    const purged = await purgeExpiredCustomerPrivacyArtifacts({
      db: fixture.db,
      now: new Date(now.getTime() + 8 * 86_400_000),
    });
    assert.equal(purged, 1);
    assert.equal(await fixture.db.privacyArtifactChunk.count(), 0);
    const saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.status, "REVIEW_REQUIRED_EXPORT_EXPIRED");
    assert.equal(saved.lastErrorCode, "PRIVACY_EXPORT_EXPIRED");
    assert.equal(saved.completedAt, null);
    assert.equal(saved.nextRunAt, null);
    assert.equal(
      await purgeExpiredCustomerPrivacyArtifacts({
        db: fixture.db,
        now: new Date(now.getTime() + 9 * 86_400_000),
      }),
      0,
    );
  } finally {
    await fixture.close();
  }
});

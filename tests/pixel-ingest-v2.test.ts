import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

import { hashPixelToken, ingestPixelEvent } from "../app/services/measurement.server";
import { loadExperimentHealthV2 } from "../app/services/experiment-health-v2.server";
import { privacyHash, privacySecret } from "../app/services/privacy.server";
import { privacyOrderHash } from "../app/services/order-privacy-guard.server";
import { privacyLookupKeyId } from "../app/services/privacy-lookup-keys.server";

const now = new Date("2026-09-05T12:00:00Z");
const token = "synthetic-pixel-token-at-least-32-characters";
const environment = { ASSIGNMENT_SECRET: "synthetic-assignment-secret-at-least-32-characters" };
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-pixel-ingest-"));
  const database = join(directory, "fixture.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const merchant = await db.merchant.create({ data: { shop: "pixel-ingest.myshopify.com" } });
  await db.pixelCredential.create({ data: { merchantId: merchant.id, tokenHash: hashPixelToken(token), endpoint: "https://fixture.invalid/events", status: "ACTIVE" } });
  const product = await db.product.create({ data: { merchantId: merchant.id, shopifyProductId: "gid://shopify/Product/1",
    title: "Fixture", handle: "fixture", status: "ACTIVE", sourceVersion: "1", sourceHash: "source", sourceSnapshot: "{}" } });
  const experiment = await db.experiment.create({ data: { merchantId: merchant.id, productId: product.id,
    key: "pixel-v2", salt: "synthetic", lifecycleVersion: 2, startedAt: new Date(now.getTime()-120_000) } });
  const assignment = await db.assignment.create({ data: { merchantId: merchant.id, experimentId: experiment.id,
    randomizationUnitId: "hashed-visitor", randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR", arm: "MATCHED",
    bucket: 6000, saltVersion: 1, consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
    assignedAt: new Date(now.getTime()-60_000), expiresAt: new Date(now.getTime()+60_000) } });
  const decision = await db.decision.create({ data: { id: "decision", merchantId: merchant.id, productId: product.id,
    experimentId: experiment.id, assignmentId: assignment.id, sessionId: "server-session-hash", visitorId: "server-visitor-hash",
    arm: "MATCHED", policy: "UNIVERSAL", reason: "V2_EXPERIMENT_ASSIGNMENT", consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
    occurredAt: new Date(now.getTime()-30_000) } });
  const payload = { schemaVersion: 2, shop: merchant.shop, token, eventId: "event", eventType: "adaptive_storefront_decision",
    occurredAt: now.toISOString(), consentState: "analytics_and_preferences_allowed", clientId: "shopify-client",
    visitorId: "untrusted-browser-visitor", sessionId: "untrusted-browser-session", decisionId: decision.id,
    experimentId: experiment.id, productId: product.shopifyProductId, data: {} };
  return { db, merchant, payload, ingest: (patch: Record<string, unknown> = {}, at = now) => ingestPixelEvent({ db, environment, now: at, payload: { ...payload, ...patch } }),
    async close() { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

test("denied, unknown and analytics-only v2 events persist no identity or event", async () => {
  const f = await fixture();
  try {
    for (const consentState of ["analytics_denied", "unknown", "analytics_allowed"])
      assert.equal((await f.ingest({ consentState })).reason, "consent_not_allowed");
    assert.equal(await f.db.commerceEvent.count(), 0);
  } finally { await f.close(); }
});

test("pixel checkout cannot recreate a privacy-suppressed order event", async () => {
  const f = await fixture();
  try {
    await f.db.privacyOrderSuppression.create({ data: {
      shopHash: privacyHash(privacySecret(), f.merchant.shop),
      orderHash: privacyOrderHash(privacySecret(), "gid://shopify/Order/1"), requestId: "synthetic-reviewed-request",
      lookupKeyId: privacyLookupKeyId(privacySecret()),
    } });
    const result = await f.ingest({ eventType: "checkout_completed", shopifyOrderId: "gid://shopify/Order/1" });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, "privacy_scope_suppressed");
    assert.equal(await f.db.commerceEvent.count(), 0);
    assert.equal((await f.ingest({ eventId: "unaffected", eventType: "checkout_completed", shopifyOrderId: "gid://shopify/Order/2" })).accepted, true);
  } finally { await f.close(); }
});

test("freshness and server context bind browser events, with safe idempotent replay", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.ingest({}, new Date(now.getTime()+300001))).reason, "event_outside_receipt_window");
    assert.equal((await f.ingest({ productId: "gid://shopify/Product/2" })).reason, "decision_scope_or_window_invalid");
    assert.equal((await f.ingest({ experimentId: "other" })).reason, "decision_scope_or_window_invalid");
    assert.equal((await f.ingest({ decisionId: "foreign" })).reason, "decision_authority_unavailable");
    assert.equal((await f.ingest()).accepted, true);
    const event = await f.db.commerceEvent.findFirstOrThrow();
    assert.equal(event.sessionId, "server-session-hash");
    assert.equal(event.visitorId, "server-visitor-hash");
    assert.match(event.clientId!, /^[a-f0-9]{64}$/);
    assert.equal((await f.ingest({}, new Date(now.getTime()+86400000))).duplicate, true);
    assert.equal(await f.db.commerceEvent.count(), 1);
  } finally { await f.close(); }
});

test("render result is atomic and contradictory final reports cannot increase coverage", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.ingest({ eventType: "adaptive_storefront_render", data: { status: "rendered" } })).accepted, true);
    assert.equal((await f.ingest({ eventId: "second", eventType: "adaptive_storefront_render", data: { status: "failed" } })).reason, "contradictory_final_render");
    assert.equal(await f.db.commerceEvent.count(), 1);
    assert.equal(await f.db.renderEvent.count(), 1);
    assert.equal((await f.ingest({ eventId: "duplicate-final", eventType: "adaptive_storefront_render", data: { status: "rendered" } })).accepted, true);
    assert.equal(await f.db.renderEvent.count(), 1);
  } finally { await f.close(); }
});

test("data and envelope allowlists reject nonfinite or free-text identity smuggling", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.ingest({ data: { reason: "person@example.com" } })).reason, "unsupported_event_data");
    assert.equal((await f.ingest({ data: { decisionTimeMs: NaN } })).reason, "unsupported_event_data");
    assert.equal((await f.ingest({ arbitraryExtra: "not part of schema" })).reason, "unsupported_envelope_field");
    assert.equal(await f.db.commerceEvent.count(), 0);
  } finally { await f.close(); }
});

test("health loader retains missing-link checkout evidence and separates unknown store orders", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.ingest({ eventId: "checkout", eventType: "checkout_completed", shopifyOrderId: "gid://shopify/Order/1" })).accepted, true);
    assert.equal((await f.ingest({ eventId: "checkout-repeated", eventType: "checkout_completed", shopifyOrderId: "gid://shopify/Order/1" })).accepted, true);
    assert.equal((await f.ingest({ eventId: "checkout-unknown", eventType: "checkout_completed", decisionId: null, experimentId: null,
      shopifyOrderId: "gid://shopify/Order/2" })).accepted, true);
    await f.db.orderLedger.create({ data: {
      merchantId: f.merchant.id, shopifyOrderId: "gid://shopify/Order/3", shopifyCreatedAt: now, sourceUpdatedAt: now,
      shopCurrency: "USD", originalObligationMinor: "1000", paymentState: "PAID", reconciliationState: "RECONCILED",
      sourceHash: "synthetic", completenessJson: "{}", lines: { create: { shopifyLineItemId: "gid://shopify/LineItem/3",
        shopifyProductId: f.payload.productId, merchandiseAfterDiscountMinor: "1000", currencyCode: "USD" } },
    } });
    const health = await loadExperimentHealthV2({ db: f.db, merchantId: f.merchant.id,
      experimentId: f.payload.experimentId, now, financial: { linkedEligibleOrders: 0, reconciledLinkedOrders: 0, contradictoryLinks: 0 } });
    assert.equal(health.checkouts.arms.MATCHED.observed, 1);
    assert.equal(health.checkouts.arms.MATCHED.failed, 1);
    assert.equal(health.checkouts.arms.MATCHED.linked, 0);
    assert.equal(health.checkouts.unknownContext, 1);
    assert.equal(health.unassignedFocalOrders, 1);
    assert.deepEqual(health.sources, { pixelCheckoutEvents: 3, focalServerOrders: 1 });
    assert.equal(health.state, "INSUFFICIENT");
    await assert.rejects(loadExperimentHealthV2({ db: f.db, merchantId: "other-tenant",
      experimentId: f.payload.experimentId, now }));
  } finally { await f.close(); }
});

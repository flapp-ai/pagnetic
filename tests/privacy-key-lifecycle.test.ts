import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { privacyHash, processPrivacyWebhook, privacySecret } from "../app/services/privacy.server";
import { privacyLookupKeyId, privacyLookupKeys, privacyRequestLookupSecret } from "../app/services/privacy-lookup-keys.server";
import { assertOrderNotSuppressed, privacyOrderHash, PrivacyOrderSuppressedError } from "../app/services/order-privacy-guard.server";
import { adoptLegacyPrivacyLookupKey } from "../app/services/privacy-key-adoption.server";

const oldKey = "synthetic-old-privacy-key-at-least-32-bytes";
const newKey = "synthetic-new-privacy-key-at-least-32-bytes";
const scopeSecret = "synthetic-field-encryption-key-at-least-32-bytes";
const ring = { NODE_ENV: "production", PRIVACY_LOOKUP_KEY: newKey,
  PRIVACY_LOOKUP_PREVIOUS_KEYS: JSON.stringify([oldKey]), SHOPIFY_API_SECRET: "an-unrelated-API-credential" };
async function fixture(legacy = false) {
  const dir = mkdtempSync(join(tmpdir(), "pagnetic-privacy-keys-"));
  const database = join(dir, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const merchant = await db.merchant.create({ data: { shop: "privacy-key.myshopify.com" } });
  const request = await processPrivacyWebhook({ db, shop: merchant.shop, type: "CUSTOMERS_REDACT",
    payload: { orders_to_redact: [1] }, secret: oldKey, scopeSecret });
  await db.privacyOrderSuppression.create({ data: { shopHash: privacyHash(oldKey, merchant.shop),
    orderHash: privacyOrderHash(oldKey, "1"), requestId: request.id,
    lookupKeyId: legacy ? null : privacyLookupKeyId(oldKey) } });
  if (legacy) await db.privacyRequest.update({ where: { id: request.id }, data: { lookupKeyId: null } });
  return { db, merchant, request,
    guard: (environment: Record<string, string | undefined>, orderId = "1") => db.$transaction((tx) => assertOrderNotSuppressed({ tx, merchantId: merchant.id, orderId, environment })),
    async close() { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); } };
}

test("privacy lookup configuration is independent, bounded and never implicitly rotates with the API credential", () => {
  assert.equal(privacySecret(ring), newKey);
  assert.equal(privacySecret({ ...ring, SHOPIFY_API_SECRET: "a-rotated-API-credential" }), newKey);
  assert.throws(() => privacyLookupKeys({ NODE_ENV: "production", SHOPIFY_API_SECRET: oldKey }), /required/);
  for (const config of [ { ...ring, PRIVACY_LOOKUP_KEY: "short" }, { ...ring, PRIVACY_LOOKUP_PREVIOUS_KEYS: "bad-json" },
    { ...ring, PRIVACY_LOOKUP_PREVIOUS_KEYS: JSON.stringify([42]) },
    { ...ring, PRIVACY_LOOKUP_PREVIOUS_KEYS: JSON.stringify(Array(9).fill(oldKey)) },
    { ...ring, SHOPIFY_API_SECRET: newKey }, { ...ring, FIELD_ENCRYPTION_KEY: newKey } ])
    assert.throws(() => privacyLookupKeys(config), /PRIVACY_LOOKUP_/);
});

test("old tombstones remain effective after API and lookup-key rotation; omitted historical keys fail closed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.guard(ring), PrivacyOrderSuppressedError);
    await assert.rejects(f.guard({ ...ring, SHOPIFY_API_SECRET: "rotated" }), PrivacyOrderSuppressedError);
    assert.equal(privacyRequestLookupSecret(f.request, ring), oldKey);
    await f.guard(ring, "2");
    await assert.rejects(f.guard({ ...ring, PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]" }, "2"), /KEY_HISTORY_MISSING/);
    assert.equal(await f.db.privacyOrderSuppression.count(), 1);
  } finally { await f.close(); }
});

test("legacy adoption proves authenticated scope and stays read-only until explicit apply", async () => {
  const f = await fixture(true);
  try {
    await assert.rejects(f.guard({ ...ring, PRIVACY_LEGACY_LOOKUP_KEY: oldKey }), /LEGACY_REINDEX_REQUIRED/);
    await assert.rejects(adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id,
      legacySecret: newKey, scopeSecret }), /TENANT_MISMATCH/);
    const dry = await adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id,
      legacySecret: oldKey, scopeSecret, dryRun: true });
    assert.equal(dry.applied, false);
    assert.equal(await f.db.runtimeControl.count(), 0);
    assert.equal((await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.request.id } })).lookupKeyId, null);
    const applied = await adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id, legacySecret: oldKey, scopeSecret });
    assert.equal(applied.verifiedSuppressionRows, 1);
    await adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id, legacySecret: oldKey, scopeSecret });
    await assert.rejects(f.guard(ring), PrivacyOrderSuppressedError);
    await f.guard(ring, "2");
    assert.equal((await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status, "PENDING_ORDER_SCOPE");
  } finally { await f.close(); }
});

test("legacy adoption rolls back when a tombstone falls outside the original encrypted request", async () => {
  const f = await fixture(true);
  try {
    await f.db.privacyOrderSuppression.create({ data: { shopHash: privacyHash(oldKey, f.merchant.shop),
      orderHash: privacyOrderHash(oldKey, "2"), requestId: f.request.id } });
    await assert.rejects(adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id,
      legacySecret: oldKey, scopeSecret }), /ADOPTION_SCOPE_MISMATCH/);
    assert.equal(await f.db.privacyOrderSuppression.count({ where: { lookupKeyId: null } }), 2);
    assert.equal((await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.request.id } })).lookupKeyId, null);
  } finally { await f.close(); }
});

test("privacy request replay retains one receipt across key rotation and conflicts on changed Shopify request scope", async () => {
  const f = await fixture();
  try {
    const args = { db: f.db, shop: f.merchant.shop, type: "CUSTOMERS_DATA_REQUEST" as const,
      payload: { customer: { id: 7 }, data_request: { id: 1234 }, orders_requested: [1] }, scopeSecret };
    const first = await processPrivacyWebhook({ ...args, secret: oldKey, lookupSecrets: [oldKey] });
    const replay = await processPrivacyWebhook({ ...args, secret: newKey, lookupSecrets: [newKey, oldKey] });
    assert.equal(first.id, replay.id);
    assert.equal(replay.lookupKeyId, privacyLookupKeyId(oldKey));
    assert.equal(await f.db.privacyRequest.count({ where: { requestType: "CUSTOMERS_DATA_REQUEST" } }), 1);
    await assert.rejects(processPrivacyWebhook({ ...args, secret: newKey, lookupSecrets: [newKey, oldKey],
      payload: { ...args.payload, orders_requested: [2] } }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(processPrivacyWebhook({ ...args, secret: newKey, lookupSecrets: [newKey, oldKey],
      payload: { ...args.payload, customer: { id: 8 } } }), /IDEMPOTENCY_CONFLICT/);
  } finally { await f.close(); }
});

test("legacy adoption refuses missing suppression but accepts verified shared tombstones", async () => {
  const f = await fixture(true);
  try {
    const tombstone = await f.db.privacyOrderSuppression.findFirstOrThrow();
    await f.db.privacyOrderSuppression.delete({ where: { id: tombstone.id } });
    await assert.rejects(adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id, legacySecret: oldKey, scopeSecret }), /SUPPRESSION_GAP/);
    assert.equal((await f.db.privacyRequest.findUniqueOrThrow({ where: { id: f.request.id } })).lookupKeyId, null);
    await f.db.privacyOrderSuppression.create({ data: { ...tombstone, requestId: "a-prior-request" } });
    const applied = await adoptLegacyPrivacyLookupKey({ db: f.db, requestId: f.request.id, legacySecret: oldKey, scopeSecret });
    assert.equal(applied.verifiedSuppressionRows, 1);
    await assert.rejects(f.guard(ring), PrivacyOrderSuppressedError);
  } finally { await f.close(); }
});

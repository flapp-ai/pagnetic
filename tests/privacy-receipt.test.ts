import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  collectPrivacyReceiptInventory,
  decryptPrivacyReceipt,
  publishPrivacyReceipt,
  receiptName,
  privacyReceiptInstallationHash,
  type PrivacyReceipt,
} from "../app/services/privacy-receipt.server";
import { processJournaledPrivacyWebhook } from "../app/services/privacy-receipt.server";
import { replayPrivacyReceipt } from "../app/services/privacy-recovery.server";
import type { PrivacyReceiptStore } from "../app/services/privacy-receipt-store.server";

const key = randomBytes(32);
const base: PrivacyReceipt = {
  version: 2, shop: "demo.myshopify.com", type: "CUSTOMERS_REDACT", orderIds: ["gid://shopify/Order/11"],
  subjectHash: "a".repeat(64), lookupKeyId: "b".repeat(64), providerRequestId: "123",
  semanticHash: "c".repeat(64), installationHash: null, eventId: "webhook-1", receivedAt: "2026-09-05T00:00:00.000Z",
};

function storeFor(objects = new Map<string, Buffer>()): PrivacyReceiptStore & { objects: Map<string, Buffer> } {
  return {
    objects,
    async putIfAbsent(name, bytes) { if (!objects.has(name)) objects.set(name, bytes); },
    async get(name) { const bytes = objects.get(name); if (!bytes) throw Object.assign(new Error("MISSING"), { $metadata: { httpStatusCode: 404 } }); return bytes; },
    async list() { return { names: [...objects.keys()] }; },
  };
}

test("receipt readback is idempotent across retained lookup-key rotation and lost PUT response", async () => {
  const objects = new Map<string, Buffer>();
  const store = storeFor(objects);
  const first = await publishPrivacyReceipt(base, key, store);
  const rotated = await publishPrivacyReceipt({ ...base, subjectHash: "d".repeat(64), lookupKeyId: "e".repeat(64) }, key, {
    ...store,
    async putIfAbsent(name, bytes) { if (!objects.has(name)) objects.set(name, bytes); throw new Error("ambiguous accepted PUT"); },
  });
  assert.equal(rotated.name, first.name);
  assert.equal(decryptPrivacyReceipt(objects.get(first.name)!, key).semanticHash, base.semanticHash);
});

test("receipt conflicting semantic scope cannot overwrite immutable provider identity", async () => {
  const store = storeFor();
  await publishPrivacyReceipt(base, key, store);
  await assert.rejects(publishPrivacyReceipt({ ...base, orderIds: ["gid://shopify/Order/12"], semanticHash: "f".repeat(64) }, key, store), /SCOPE_CONFLICT/);
});

test("backup-key rotation reuses authenticated original receipt instead of creating a second identity", async () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const store = storeFor();
  const original = await publishPrivacyReceipt(base, oldKey, store);
  const rotatedReceipt = { ...base, semanticHash: "d".repeat(64) };
  const rotated = await publishPrivacyReceipt(rotatedReceipt, newKey, store, [newKey, oldKey], [{ key: newKey, receipt: rotatedReceipt }, { key: oldKey, receipt: base }]);
  assert.equal(rotated.name, original.name);
  assert.equal(rotated.key.equals(oldKey), true);
  const changed = { ...rotatedReceipt, orderIds: ["gid://shopify/Order/12"], semanticHash: "e".repeat(64) };
  await assert.rejects(publishPrivacyReceipt(changed, newKey, store, [newKey, oldKey], [{ key: newKey, receipt: changed }, { key: oldKey, receipt: { ...base, orderIds: ["gid://shopify/Order/12"] } }]), /SCOPE_CONFLICT/);
});

test("retained-key outage rejects publish and never falls back to an unchecked inventory", async () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const oldReceiptName = receiptName(base, oldKey);
  const rotatedReceipt = { ...base, semanticHash: "d".repeat(64) };
  const store: PrivacyReceiptStore = {
    async putIfAbsent() { throw new Error("must not PUT during retained-key outage"); },
    async get(name) {
      if (name === oldReceiptName) throw Object.assign(new Error("storage unavailable"), { $metadata: { httpStatusCode: 503 } });
      throw Object.assign(new Error("missing"), { $metadata: { httpStatusCode: 404 } });
    },
    async list() { throw new Error("LIST_NOT_ALLOWED"); },
  };
  await assert.rejects(publishPrivacyReceipt(rotatedReceipt, newKey, store, [newKey, oldKey], [{ key: newKey, receipt: rotatedReceipt }, { key: oldKey, receipt: base }]), /storage unavailable/);
});

test("receipt inventory rejects cursor cycles and duplicate names", async () => {
  const cycle: PrivacyReceiptStore = {
    async putIfAbsent() {}, async get() { return Buffer.alloc(0); },
    async list(cursor) { return cursor === undefined || cursor === "A" ? { names: [], next: cursor === "A" ? "B" : "A" } : { names: [], next: "A" }; },
  };
  await assert.rejects(collectPrivacyReceiptInventory(cycle, [key]), /CURSOR_INVALID/);
});

test("transplanted or corrupted receipt fails authenticated readback", async () => {
  const name = receiptName(base, key);
  const store = storeFor(new Map([[name, Buffer.from("PPR1corrupt")]]));
  await assert.rejects(collectPrivacyReceiptInventory(store, [key]), /AUTHENTICATION_FAILED/);
});

test("journaled webhook retry preserves original receipt and local deadline across lookup-key rotation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-receipt-wrapper-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const store = storeFor();
  const backup = key.toString("base64");
  const original = { ...process.env };
  const firstLookup = "receipt-wrapper-lookup-key-aaaaaaaaaaaaaaaa";
  const secondLookup = "receipt-wrapper-lookup-key-bbbbbbbbbbbbbbbb";
  try {
    process.env.BACKUP_ENCRYPTION_KEY = backup;
    process.env.FIELD_ENCRYPTION_KEY = "receipt-wrapper-field-key-aaaaaaaaaaaaaaaa";
    process.env.PRIVACY_LOOKUP_KEY = firstLookup;
    process.env.PRIVACY_LOOKUP_PREVIOUS_KEYS = "[]";
    const first = await processJournaledPrivacyWebhook({ db, shop: "wrapper.myshopify.com", type: "CUSTOMERS_DATA_REQUEST",
      payload: { customer: { id: 7 }, data_request: { id: 991 }, orders_requested: [] }, secret: firstLookup,
      webhookId: "stable-webhook", eventId: "stable-event", now: new Date("2026-09-05T00:00:00Z") }, { key, store });
    const saved = await db.privacyRequest.findUniqueOrThrow({ where: { id: first.id } });
    process.env.PRIVACY_LOOKUP_KEY = secondLookup;
    process.env.PRIVACY_LOOKUP_PREVIOUS_KEYS = JSON.stringify([firstLookup]);
    const second = await processJournaledPrivacyWebhook({ db, shop: "wrapper.myshopify.com", type: "CUSTOMERS_DATA_REQUEST",
      payload: { customer: { id: 7 }, data_request: { id: 991 }, orders_requested: [] }, secret: secondLookup,
      webhookId: "stable-webhook", eventId: "stable-event", now: new Date("2026-09-06T00:00:00Z") }, { key, store });
    assert.equal(second.id, first.id);
    assert.equal((second.receipt as PrivacyReceipt).receivedAt, (first.receipt as PrivacyReceipt).receivedAt);
    assert.equal((await db.privacyRequest.findUniqueOrThrow({ where: { id: first.id } })).requestedAt.getTime(), saved.requestedAt.getTime());
  } finally {
    for (const keyName of Object.keys(process.env)) if (!(keyName in original)) delete process.env[keyName];
    for (const [keyName, value] of Object.entries(original)) process.env[keyName] = value;
    await db.$disconnect(); rmSync(directory, { recursive: true, force: true });
  }
});

test("SHOP_REDACT replay deletes only the captured installation generation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-shop-replay-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  const lookup = "shop-replay-lookup-key-aaaaaaaaaaaaaaaaaaaa";
  const env = { NODE_ENV: "production", PRIVACY_LOOKUP_KEY: lookup, PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]",
    SHOPIFY_API_SECRET: "shop-replay-api-secret-bbbbbbbbbbbbbbbb" };
  try {
    const merchant = await db.merchant.create({ data: { shop: "generation.myshopify.com", installedAt: new Date("2026-09-05T00:00:00Z") } });
    const receiptKey = randomBytes(32);
    const matching: PrivacyReceipt = { version: 2, shop: merchant.shop, type: "SHOP_REDACT", orderIds: [], subjectHash: null,
      lookupKeyId: (await import("../app/services/privacy-lookup-keys.server")).privacyLookupKeyId(lookup), providerRequestId: null,
      semanticHash: "1".repeat(64), installationHash: privacyReceiptInstallationHash(receiptKey, merchant.shop, merchant),
      eventId: "shop-event", receivedAt: "2026-09-05T00:00:00.000Z" };
    const erased = await replayPrivacyReceipt({ db, receipt: matching, receiptKey, environment: env, now: new Date("2026-09-05T01:00:00Z") });
    assert.equal(erased.ok, true);
    const fresh = await db.merchant.create({ data: { shop: "generation.myshopify.com", installedAt: new Date("2026-09-06T00:00:00Z") } });
    const old: PrivacyReceipt = { ...matching, installationHash: privacyReceiptInstallationHash(receiptKey, matching.shop, merchant) };
    const blocked = await replayPrivacyReceipt({ db, receipt: old, receiptKey, environment: env, now: new Date("2026-09-06T01:00:00Z") });
    assert.equal(blocked.ok, false);
    assert.equal((await db.merchant.findUnique({ where: { id: fresh.id } }))?.id, fresh.id);
  } finally { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); }
});

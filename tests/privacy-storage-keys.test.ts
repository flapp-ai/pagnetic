import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { receiveCustomerPrivacyRequest } from "../app/services/customer-privacy-scope.server";
import { privacyHash } from "../app/services/privacy.server";
import { adoptLegacyPrivacyLookupKey } from "../app/services/privacy-key-adoption.server";
import {
  assertPrivacyStorageKeyCoverage,
  privacyRequestStorageSecret,
  privacyStorageKeyId,
  privacyStorageKeys,
} from "../app/services/privacy-storage-keys.server";

const lookupKey = "privacy-storage-test-lookup-key-at-least-32-characters";
const oldStorageKey =
  "privacy-storage-test-old-field-key-at-least-32-characters";
const newStorageKey =
  "privacy-storage-test-new-field-key-at-least-32-characters";
const shop = "privacy-storage-key.myshopify.com";
const now = new Date("2026-09-05T12:00:00.000Z");

function storageEnvironment(previous: string[] = [oldStorageKey]) {
  return {
    NODE_ENV: "production",
    FIELD_ENCRYPTION_KEY: newStorageKey,
    PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify(previous),
    PRIVACY_LOOKUP_KEY: lookupKey,
    SHOPIFY_API_SECRET: "independent-shopify-api-secret-at-least-32-characters",
  };
}

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-storage-"));
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

function receive(args: {
  db: PrismaClient;
  scopeSecret: string;
  scopeSecrets?: string[];
}) {
  return receiveCustomerPrivacyRequest({
    db: args.db,
    shop,
    shopHash: privacyHash(lookupKey, shop),
    subjectHash: privacyHash(lookupKey, 123),
    type: "CUSTOMERS_DATA_REQUEST",
    payload: {
      data_request: { id: 9001 },
      customer: { id: 123 },
      orders_requested: [41],
    },
    secret: lookupKey,
    lookupSecrets: [lookupKey],
    scopeSecret: args.scopeSecret,
    scopeSecrets: args.scopeSecrets,
    now,
  });
}

test("privacy storage key configuration is independent, bounded and resolves exact retained history", () => {
  const environment = storageEnvironment();
  const keys = privacyStorageKeys(environment);
  assert.equal(keys.active, newStorageKey);
  assert.deepEqual(keys.secrets, [newStorageKey, oldStorageKey]);
  const request = { scopeKeyId: privacyStorageKeyId(oldStorageKey) };
  assert.equal(
    privacyRequestStorageSecret(request, environment),
    oldStorageKey,
  );
  assert.throws(
    () => privacyRequestStorageSecret(request, storageEnvironment([])),
    /PRIVACY_STORAGE_KEY_HISTORY_MISSING/,
  );
  assert.throws(
    () =>
      privacyRequestStorageSecret({ scopeKeyId: null }, storageEnvironment()),
    /PRIVACY_STORAGE_LEGACY_ADOPTION_REQUIRED/,
  );

  for (const invalid of [
    { NODE_ENV: "production" },
    { ...environment, FIELD_ENCRYPTION_KEY: "short" },
    { ...environment, PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: "bad-json" },
    {
      ...environment,
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify([42]),
    },
    {
      ...environment,
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify(
        Array(8).fill(oldStorageKey),
      ),
    },
    { ...environment, SHOPIFY_API_SECRET: newStorageKey },
    { ...environment, PRIVACY_LOOKUP_KEY: newStorageKey },
  ])
    assert.throws(
      () => privacyStorageKeys(invalid),
      /PRIVACY_(?:FIELD_ENCRYPTION_KEY_REQUIRED|STORAGE_)/,
    );
});

test("new scopes retain their key identity and replay through an explicitly retained prior field key", async () => {
  const fixture = testDatabase();
  try {
    const first = await receive({ db: fixture.db, scopeSecret: oldStorageKey });
    assert.equal(first.scopeKeyId, privacyStorageKeyId(oldStorageKey));
    const replay = await receive({
      db: fixture.db,
      scopeSecret: newStorageKey,
      scopeSecrets: [oldStorageKey],
    });
    assert.equal(replay.id, first.id);
    assert.equal(replay.scopeKeyId, privacyStorageKeyId(oldStorageKey));
    assert.equal(
      privacyRequestStorageSecret(replay, storageEnvironment()),
      oldStorageKey,
    );
    await fixture.db.$transaction((tx) =>
      assertPrivacyStorageKeyCoverage(tx, storageEnvironment()),
    );
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        assertPrivacyStorageKeyCoverage(tx, storageEnvironment([])),
      ),
      /PRIVACY_STORAGE_KEY_HISTORY_MISSING/,
    );
  } finally {
    await fixture.close();
  }
});

test("legacy scope adoption authenticates the supplied field key and remains mutation-free in dry run", async () => {
  const fixture = testDatabase();
  try {
    const request = await receive({
      db: fixture.db,
      scopeSecret: oldStorageKey,
    });
    await fixture.db.privacyRequest.update({
      where: { id: request.id },
      // Migration-21 requests can already have a valid lookup fingerprint while
      // lacking only the new storage-key identity.
      data: { scopeKeyId: null },
    });
    await assert.rejects(
      adoptLegacyPrivacyLookupKey({
        db: fixture.db,
        requestId: request.id,
        legacySecret: lookupKey,
        scopeSecret: newStorageKey,
      }),
      /PRIVACY_SCOPE_INVALID/,
    );
    const dryRun = await adoptLegacyPrivacyLookupKey({
      db: fixture.db,
      requestId: request.id,
      legacySecret: lookupKey,
      scopeSecret: oldStorageKey,
      dryRun: true,
    });
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.scopeKeyId, privacyStorageKeyId(oldStorageKey));
    let saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.lookupKeyId, request.lookupKeyId);
    assert.equal(saved.scopeKeyId, null);
    assert.equal(await fixture.db.runtimeControl.count(), 0);

    const applied = await adoptLegacyPrivacyLookupKey({
      db: fixture.db,
      requestId: request.id,
      legacySecret: lookupKey,
      scopeSecret: oldStorageKey,
    });
    assert.equal(applied.applied, true);
    saved = await fixture.db.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(saved.lookupKeyId, applied.lookupKeyId);
    assert.equal(saved.scopeKeyId, applied.scopeKeyId);
    await adoptLegacyPrivacyLookupKey({
      db: fixture.db,
      requestId: request.id,
      legacySecret: lookupKey,
      scopeSecret: oldStorageKey,
    });
  } finally {
    await fixture.close();
  }
});

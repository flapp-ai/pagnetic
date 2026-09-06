import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { collectPrivacyReceiptInventory, encryptPrivacyReceipt, processJournaledPrivacyWebhook, receiptName, type PrivacyReceipt } from "../app/services/privacy-receipt.server";
import { replayPrivacyInventory, assertRecoveryHoldPresent } from "../app/services/privacy-recovery.server";
import { accessCustomerPrivacyArtifact, confirmCustomerPrivacyArtifactDelivery } from "../app/services/customer-privacy-access.server";
import { processCustomerPrivacyExportStep, purgeExpiredCustomerPrivacyArtifacts } from "../app/services/customer-privacy-artifact.server";
import { claimCustomerPrivacyRequest } from "../app/services/customer-privacy-queue.server";
import { recordRecoveryReplayEvidence } from "../app/services/recovery-reopening.server";
import { releaseRecoveryHold } from "../app/services/recovery-release.server";
import { assertRecoveryHoldClear } from "../app/services/recovery-hold.server";
import { createVerifiedBackup, restoreEncryptedBackup, type BackupStore } from "../scripts/lib/sqlite-backup";
import { transferSqliteToPostgres } from "../scripts/lib/postgres-transfer";
import type { PrivacyReceiptStore } from "../app/services/privacy-receipt-store.server";

const lookup = "recovery-integration-lookup-key-aaaaaaaaaaaaaaaa";
const field = "recovery-integration-field-key-bbbbbbbbbbbbbbbb";
const api = "recovery-integration-api-key-cccccccccccccccc";
const shop = "recovery-target.myshopify.com";
const otherShop = "recovery-unrelated.myshopify.com";
const order = (id: number) => `gid://shopify/Order/${id}`;

function migrations(database: string) {
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
}

function stores() {
  const objects = new Map<string, Buffer>();
  const backup: BackupStore = {
    kind: "test", destination: "fixture://recovery-integration",
    async put(name, path) { objects.set(name, readFileSync(path)); },
    async get(name, path) { const bytes = objects.get(name); if (!bytes) throw new Error("MISSING_BACKUP_OBJECT"); writeFileSync(path, bytes, { flag: "wx" }); },
  };
  const receipts = new Map<string, Buffer>();
  let listCalls = 0;
  const privacy: PrivacyReceiptStore = {
    async putIfAbsent(name, bytes) { if (!receipts.has(name)) receipts.set(name, bytes); },
    async get(name) { const bytes = receipts.get(name); if (!bytes) throw Object.assign(new Error("MISSING_RECEIPT"), { $metadata: { httpStatusCode: 404 } }); return bytes; },
    async list() { listCalls += 1; return { names: [...receipts.keys()] }; },
  };
  return { backup, privacy, objects, receipts, get listCalls() { return listCalls; } };
}

test("T0 backup -> T1 independent receipt -> quarantined restore -> exact replay erasure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-recovery-integration-"));
  const source = join(directory, "source.sqlite");
  const restored = join(directory, "restored.sqlite");
  const key = randomBytes(32);
  const f = stores();
  const original = { ...process.env };
  const receivedAt = new Date(Date.now() - 60_000);
  try {
    migrations(source);
    const db = new PrismaClient({ datasourceUrl: `file:${source}` });
    const target = await db.merchant.create({ data: { shop } });
    const unrelated = await db.merchant.create({ data: { shop: otherShop } });
    await db.storeOrder.createMany({ data: [
      { merchantId: target.id, shopifyOrderId: order(1001), orderNumber: "1001", currencyCode: "USD", grossAmount: "10.00", netAmount: "10.00", financialStatus: "paid", occurredAt: receivedAt },
      { merchantId: target.id, shopifyOrderId: order(1002), orderNumber: "1002", currencyCode: "USD", grossAmount: "20.00", netAmount: "20.00", financialStatus: "paid", occurredAt: receivedAt },
      { merchantId: unrelated.id, shopifyOrderId: order(2001), orderNumber: "2001", currencyCode: "USD", grossAmount: "30.00", netAmount: "30.00", financialStatus: "paid", occurredAt: receivedAt },
    ] });
    const manifest = await createVerifiedBackup({ sourcePath: source, directory: join(directory, "backups"), key, store: f.backup, appVersion: "recovery-integration" });
    assert.equal(await db.privacyRequest.count(), 0, "T0 backup has no local privacy request");
    delete process.env.FIELD_ENCRYPTION_KEY;
    process.env.PRIVACY_LOOKUP_KEY = lookup;
    process.env.PRIVACY_LOOKUP_PREVIOUS_KEYS = "[]";
    const event = { db, shop, type: "CUSTOMERS_REDACT" as const, secret: lookup,
      payload: { customer: { id: 77 }, data_request: { id: 7001 }, orders_to_redact: [1001] },
      webhookId: "recovery-webhook-7001", eventId: "recovery-event-7001", now: receivedAt };
    await assert.rejects(processJournaledPrivacyWebhook(event, { key, store: f.privacy }), /PRIVACY_SCOPE_ENCRYPTION_REQUIRED/);
    assert.equal(await db.privacyRequest.count(), 0, "local intake failed before its durable request write");
    await assert.rejects(processJournaledPrivacyWebhook({ ...event, type: "CUSTOMERS_DATA_REQUEST",
      payload: { customer: { id: 79 }, data_request: { id: 7002 }, orders_requested: [1002] },
      webhookId: "recovery-webhook-7002", eventId: "recovery-event-7002" }, { key, store: f.privacy }),
    /PRIVACY_SCOPE_ENCRYPTION_REQUIRED/);
    await assert.rejects(processJournaledPrivacyWebhook({ ...event, payload: { ...event.payload, customer: { id: 78 } } }, { key, store: f.privacy }), /PRIVACY_RECEIPT_SCOPE_CONFLICT/);
    assert.equal(f.listCalls, 0, "webhook intake must not LIST the receipt inventory");
    await db.$disconnect();

    await restoreEncryptedBackup({ artifactPath: join(directory, "backups", manifest.artifact), manifest, key, destination: restored,
      privacyJournalPath: manifest.privacyJournal ? join(directory, "backups", manifest.privacyJournal.artifact) : undefined,
      privacyJournal: manifest.privacyJournal });
    const recovered = new PrismaClient({ datasourceUrl: `file:${restored}` });
    await assertRecoveryHoldPresent(recovered);
    const environment = { NODE_ENV: "production", PRIVACY_LOOKUP_KEY: lookup, PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]", FIELD_ENCRYPTION_KEY: field,
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: "[]", SHOPIFY_API_SECRET: api };
    const before = await collectPrivacyReceiptInventory(f.privacy, [key]);
    const replay = await replayPrivacyInventory({ db: recovered, receipts: before.receipts, names: before.names, afterNames: before.names, environment, now: new Date() });
    const after = await collectPrivacyReceiptInventory(f.privacy, [key]);
    assert.equal(replay.unresolved.length, 0);
    const request = await recovered.privacyRequest.findFirstOrThrow({ where: { requestType: "CUSTOMERS_REDACT" } });
    assert.equal(request.requestedAt.toISOString(), receivedAt.toISOString());
    assert.equal(request.dueAt?.toISOString(), new Date(receivedAt.getTime() + 30 * 86_400_000).toISOString());
    assert.equal(request.status, "ACTIVE_DATA_ERASED_BACKUP_REVIEW");
    const dataRequest = await recovered.privacyRequest.findFirstOrThrow({ where: { requestType: "CUSTOMERS_DATA_REQUEST" } });
    assert.equal(dataRequest.status, "EXPORT_READY_OWNER_DELIVERY");
    assert.equal(await recovered.privacyArtifactChunk.count({ where: { requestId: dataRequest.id, kind: "CUSTOMER_DATA_COPY" } }), 1);
    assert.equal(await recovered.storeOrder.count({ where: { merchantId: target.id, shopifyOrderId: order(1001) } }), 0);
    assert.equal(await recovered.storeOrder.count({ where: { merchantId: target.id, shopifyOrderId: order(1002) } }), 1);
    assert.equal(await recovered.storeOrder.count({ where: { merchantId: unrelated.id, shopifyOrderId: order(2001) } }), 1);
    const manifestSha256 = (await import("node:crypto")).createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    process.env.BACKUP_ENCRYPTION_KEY = key.toString("base64");
    process.env.BACKUP_ENCRYPTION_PREVIOUS_KEYS = "[]";
    const leakedJob = await recovered.job.create({ data: { merchantId: target.id, type: "RECOVERY_FIXTURE",
      idempotencyKey: "recovery-leaked-order", inputHash: "x", payloadSchemaVersion: 1,
      payloadJson: JSON.stringify({ shopifyOrderId: order(1001) }) } });
    await assert.rejects(recordRecoveryReplayEvidence({ db: recovered, before, after,
      sourceManifestSha256: manifestSha256, sourceArtifact: manifest.artifact, sourceArtifactSha256: manifest.encryptedSha256,
      restoredDbSha256: (await recovered.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).restoredDbSha256!, schemaSha256: (await recovered.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).schemaSha256!,
      retainedKeyFingerprints: key.toString("hex"), replayStartedAt: new Date(Date.now() - 1000), replayFinishedAt: new Date(),
      unresolvedCount: replay.unresolved.length, environment, integrityKey: key }), /RECOVERY_ERASURE_GRAPH_UNRESOLVED/);
    await recovered.job.delete({ where: { id: leakedJob.id } });
    const evidence = await recordRecoveryReplayEvidence({ db: recovered, before, after,
      sourceManifestSha256: manifestSha256, sourceArtifact: manifest.artifact, sourceArtifactSha256: manifest.encryptedSha256,
      restoredDbSha256: (await recovered.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).restoredDbSha256!, schemaSha256: (await recovered.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).schemaSha256!,
      retainedKeyFingerprints: key.toString("hex"), replayStartedAt: new Date(Date.now() - 1000), replayFinishedAt: new Date(),
      unresolvedCount: replay.unresolved.length, environment, integrityKey: key });
    const released = await releaseRecoveryHold({ db: recovered, key, evidenceId: evidence.id, sourceManifestSha256: manifestSha256,
      sourceArtifact: manifest.artifact, sourceArtifactSha256: manifest.encryptedSha256, receiptInventoryDigest: evidence.inventoryDigest,
      retainedKeyFingerprints: key.toString("hex"),
      operatorIdentity: "/operator/test", privacyReviewReference: "/privacy/review", backupReviewReference: "/backup/review",
      legacyInventoryReference: "/legacy/review", receiptQuiescenceReference: "/receipt/quiescence", environment });
    assert.ok(released.auditId);
    assert.equal((await recovered.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).state, "RELEASED");
    assert.equal(await recovered.recoveryReleaseAudit.count(), 1);
    await assertRecoveryHoldClear(recovered, `file:${restored}`, { ...environment, BACKUP_ENCRYPTION_KEY: key.toString("base64") });
    await assert.rejects(assertRecoveryHoldPresent(recovered), /RECOVERY_HOLD_NOT_ACTIVE/);
    assert.equal(await recovered.recoveryReplayEvidence.count(), 1);
    await assert.rejects(transferSqliteToPostgres({ sourcePath: restored, postgres: { host: "127.0.0.1", port: 1, user: "x", database: "x" }, models: [], migrationSql: "", schemaHash: "x" }), /failed|connection|RECOVERY/);
    await recovered.$disconnect();
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
    for (const [name, value] of Object.entries(original)) process.env[name] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recovery inventory/key failures keep the quarantine hold", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-recovery-failure-"));
  const database = join(directory, "held.sqlite");
  try {
    migrations(database);
    execFileSync("sqlite3", [database], { input: "DROP TABLE _PagneticRecoveryHold; CREATE TABLE _PagneticRecoveryHold(id INTEGER PRIMARY KEY CHECK(id=1), reason TEXT NOT NULL); INSERT INTO _PagneticRecoveryHold VALUES(1,'replay');" });
    const db = new PrismaClient({ datasourceUrl: `file:${database}` });
    const f = stores();
    const validReceipt: PrivacyReceipt = { version: 2, shop, type: "CUSTOMERS_REDACT", orderIds: [order(1001)], subjectHash: "a".repeat(64),
      lookupKeyId: "b".repeat(64), providerRequestId: "7001", semanticHash: "c".repeat(64), installationHash: null,
      eventId: "recovery-event-7001", receivedAt: new Date().toISOString() };
    const retainedKey = randomBytes(32);
    await f.privacy.putIfAbsent(receiptName(validReceipt, retainedKey), encryptPrivacyReceipt(validReceipt, retainedKey));
    await assert.rejects(collectPrivacyReceiptInventory(f.privacy, [randomBytes(32)]), /AUTHENTICATION_FAILED/);
    await assert.rejects(assertRecoveryHoldPresent(db), /RECOVERY_HOLD_SCHEMA_UNSUPPORTED/);
    await assert.rejects(replayPrivacyInventory({ db, receipts: [], names: ["one"], afterNames: [], now: new Date() }), /INVENTORY_CHANGED/);
    await assert.rejects(assertRecoveryHoldPresent(db), /RECOVERY_HOLD_SCHEMA_UNSUPPORTED/);
    await db.$disconnect();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("delivered data-copy receipt survives backup, artifact expiry and authenticated restore replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-recovery-delivered-copy-"));
  const source = join(directory, "source.sqlite");
  const restored = join(directory, "restored.sqlite");
  const key = randomBytes(32);
  const f = stores();
  const original = { ...process.env };
  const requestedAt = new Date(Date.now() - 10_000);
  try {
    migrations(source);
    process.env.PRIVACY_LOOKUP_KEY = lookup;
    process.env.PRIVACY_LOOKUP_PREVIOUS_KEYS = "[]";
    process.env.FIELD_ENCRYPTION_KEY = field;
    process.env.PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS = "[]";
    const db = new PrismaClient({ datasourceUrl: `file:${source}` });
    const merchant = await db.merchant.create({ data: { shop } });
    const actor = `${shop}:user:123`;
    await db.pilotRole.create({ data: { merchantId: merchant.id, actorKey: actor, role: "OWNER", grantedBy: "recovery-test" } });
    const intake = await processJournaledPrivacyWebhook({ db, shop, type: "CUSTOMERS_DATA_REQUEST", secret: lookup,
      scopeSecret: field, now: requestedAt, eventId: "delivered-copy-event", webhookId: "delivered-copy-webhook",
      payload: { data_request: { id: 8001 }, customer: { id: 123 }, orders_requested: [3001] } },
    { key, store: f.privacy });
    const lease = await claimCustomerPrivacyRequest({ db, now: requestedAt });
    assert.ok(lease);
    await processCustomerPrivacyExportStep({ db, lease, scopeSecret: field, privacySecret: lookup, now: requestedAt });
    const access = { db, shop, actor, requestId: intake.id, environment: {
      PRIVACY_LOOKUP_KEY: lookup, PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]", FIELD_ENCRYPTION_KEY: field,
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: "[]",
    }, now: requestedAt, ownerAuthority: { shop, userId: "123", expiresAt: new Date(requestedAt.getTime() + 60_000) } };
    await accessCustomerPrivacyArtifact({ ...access, ordinal: 0 });
    await confirmCustomerPrivacyArtifactDelivery({ ...access,
      attestation: "I_CONFIRMED_SECURE_DELIVERY_TO_REQUESTER", evidenceReference: "recovery-test:delivery-8001" });
    const before = await db.privacyRequest.findUniqueOrThrow({ where: { id: intake.id } });
    await db.privacyArtifactChunk.updateMany({ where: { requestId: intake.id }, data: { expiresAt: requestedAt } });
    assert.equal(await purgeExpiredCustomerPrivacyArtifacts({ db, now: new Date(requestedAt.getTime() + 1) }), 1);
    assert.equal(await db.privacyArtifactChunk.count({ where: { requestId: intake.id } }), 0);
    const manifest = await createVerifiedBackup({ sourcePath: source, directory: join(directory, "backups"), key,
      store: f.backup, appVersion: "delivered-copy-recovery" });
    await db.$disconnect();

    await restoreEncryptedBackup({ artifactPath: join(directory, "backups", manifest.artifact), manifest, key, destination: restored,
      ...(manifest.privacyJournal ? { privacyJournalPath: join(directory, "backups", manifest.privacyJournal.artifact),
        privacyJournal: manifest.privacyJournal } : {}) });
    const recovered = new PrismaClient({ datasourceUrl: `file:${restored}` });
    const inventory = await collectPrivacyReceiptInventory(f.privacy, [key]);
    const environment = { PRIVACY_LOOKUP_KEY: lookup, PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]", FIELD_ENCRYPTION_KEY: field,
      PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: "[]" };
    const replay = await replayPrivacyInventory({ db: recovered, receipts: inventory.receipts, names: inventory.names,
      afterNames: inventory.names, environment, now: new Date(requestedAt.getTime() + 20_000) });
    assert.equal(replay.unresolved.length, 0);
    assert.equal(replay.results[0]?.action, "data-copy-delivery-authenticated");
    const after = await recovered.privacyRequest.findUniqueOrThrow({ where: { id: intake.id } });
    assert.equal(after.status, "OWNER_CONFIRMED_SECURE_DELIVERY");
    assert.equal(after.completedAt?.toISOString(), before.completedAt?.toISOString());
    assert.equal(after.dueAt?.toISOString(), before.dueAt?.toISOString(), "replay never extends the original deadline");
    assert.equal(await recovered.privacyArtifactChunk.count({ where: { requestId: intake.id } }), 0,
      "a signed terminal delivery does not require expired artifacts to be recreated");
    assert.equal(await recovered.privacyDeliveryAudit.count({ where: { requestId: intake.id } }), 1);
    await recovered.privacyDeliveryAudit.update({ where: { requestId: intake.id }, data: { integrityTag: "0".repeat(64) } });
    await assert.rejects(replayPrivacyInventory({ db: recovered, receipts: inventory.receipts, names: inventory.names,
      afterNames: inventory.names, environment, now: new Date(requestedAt.getTime() + 21_000) }), /PRIVACY_DELIVERY_AUDIT_INVALID/);
    await recovered.privacyDeliveryAudit.delete({ where: { requestId: intake.id } });
    await assert.rejects(replayPrivacyInventory({ db: recovered, receipts: inventory.receipts, names: inventory.names,
      afterNames: inventory.names, environment, now: new Date(requestedAt.getTime() + 22_000) }), /PRIVACY_DELIVERY_AUDIT_INVALID/);
    await recovered.$disconnect();
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
    for (const [name, value] of Object.entries(original)) process.env[name] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertRecoveryHoldClear } from "../app/services/recovery-hold.server";
import { protectedDatabaseFingerprint, recordRecoveryReplayEvidence,
  recoveryBackupKeyById } from "../app/services/recovery-reopening.server";
import { releaseRecoveryHold } from "../app/services/recovery-release.server";
import { createVerifiedBackup, restoreEncryptedBackup, type BackupManifest, type BackupStore } from "../scripts/lib/sqlite-backup";
import { transferSqliteToPostgres } from "../scripts/lib/postgres-transfer";

const lookup = "recovery-reopening-lookup-key-aaaaaaaaaaaaaa";
const field = "recovery-reopening-field-key-bbbbbbbbbbbbb";
const inventory = { names: [] as string[], receipts: [] as Array<{ name: string; ciphertextSha256: string }> };

function migrate(database: string) {
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
}

function store() {
  const values = new Map<string, Buffer>();
  const adapter: BackupStore = {
    kind: "test", destination: "fixture://recovery-reopening",
    async put(name, path) { values.set(name, readFileSync(path)); },
    async get(name, path) { const value = values.get(name); if (!value) throw new Error("MISSING_FIXTURE"); writeFileSync(path, value, { flag: "wx" }); },
  };
  return { values, adapter };
}

async function restoredFixture() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-reopening-"));
  const source = join(directory, "source.sqlite");
  const restored = join(directory, "restored.sqlite");
  migrate(source);
  const sourceDb = new PrismaClient({ datasourceUrl: `file:${source}` });
  await sourceDb.merchant.create({ data: { shop: "reopening.myshopify.com" } });
  await sourceDb.$disconnect();
  const key = randomBytes(32);
  const objects = store();
  const manifest = await createVerifiedBackup({ sourcePath: source, directory: join(directory, "backup"), key,
    appVersion: "reopening-test", store: objects.adapter });
  await restoreEncryptedBackup({ artifactPath: join(directory, "backup", manifest.artifact), manifest, key, destination: restored,
    ...(manifest.privacyJournal ? { privacyJournalPath: join(directory, "backup", manifest.privacyJournal.artifact), privacyJournal: manifest.privacyJournal } : {}) });
  const db = new PrismaClient({ datasourceUrl: `file:${restored}` });
  const environment = { BACKUP_ENCRYPTION_KEY: key.toString("base64"), PRIVACY_LOOKUP_KEY: lookup,
    PRIVACY_LOOKUP_PREVIOUS_KEYS: "[]", FIELD_ENCRYPTION_KEY: field, PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS: "[]" };
  return { directory, source, restored, db, key, manifest, environment, objects };
}

function manifestHash(manifest: BackupManifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function keyFingerprints(key: Buffer) {
  return createHash("sha256").update(key).digest("hex");
}

async function evidence(f: Awaited<ReturnType<typeof restoredFixture>>, options: { now?: Date; unresolvedCount?: number } = {}) {
  const now = options.now ?? new Date();
  const hold = await f.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } });
  return recordRecoveryReplayEvidence({ db: f.db, before: inventory, after: inventory,
    sourceManifestSha256: manifestHash(f.manifest), sourceArtifact: f.manifest.artifact,
    sourceArtifactSha256: f.manifest.encryptedSha256, restoredDbSha256: hold.restoredDbSha256!, schemaSha256: hold.schemaSha256!,
    retainedKeyFingerprints: keyFingerprints(f.key), replayStartedAt: new Date(now.getTime() - 2_000),
    replayFinishedAt: new Date(now.getTime() - 1_000), unresolvedCount: options.unresolvedCount ?? 0,
    environment: f.environment, integrityKey: f.key, now });
}

function releaseInput(f: Awaited<ReturnType<typeof restoredFixture>>, evidenceId: string, now = new Date()) {
  return { db: f.db, key: f.key, evidenceId, sourceManifestSha256: manifestHash(f.manifest),
    sourceArtifact: f.manifest.artifact, sourceArtifactSha256: f.manifest.encryptedSha256,
    receiptInventoryDigest: createHash("sha256").update("pagnetic-recovery-protected-db-v1\0receipt-inventory\0").update("[]").update("[]").digest("hex"),
    retainedKeyFingerprints: keyFingerprints(f.key), operatorIdentity: "operator:test", privacyReviewReference: "review:privacy:1",
    backupReviewReference: "review:backup:1", legacyInventoryReference: "review:legacy:1",
    receiptQuiescenceReference: "review:receipts:1", environment: f.environment, now };
}

test("fresh migrated SQLite starts with an empty recovery metadata table", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-reopening-fresh-"));
  const database = join(directory, "fresh.sqlite");
  migrate(database);
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  assert.equal(await db.recoveryHold.count(), 0);
  await assertRecoveryHoldClear(db, `file:${database}`, {});
  assert.equal((await db.$queryRawUnsafe<Array<{ violations: bigint }>>("SELECT count(*) AS violations FROM pragma_foreign_key_check"))[0].violations, 0n);
  await db.$disconnect();
  assert.match(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "await import('./app/db.server.ts'); console.log('fresh-start-ok')"], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", DATABASE_URL: `file:${database}` }, encoding: "utf8" }), /fresh-start-ok/);
});

test("restore, immutable replay evidence and authenticated release survive a second backup cycle", async () => {
  const first = await restoredFixture();
  await assert.rejects(transferSqliteToPostgres({ sourcePath: first.restored,
    postgres: { host: "127.0.0.1", port: 1, user: "fixture", database: "fixture", sslmode: "disable" },
    models: [], migrationSql: "", schemaHash: "fixture", environment: first.environment }), /RECOVERY_PRIVACY_REPLAY_REQUIRED/);
  const firstEvidence = await evidence(first);
  const released = await releaseRecoveryHold(releaseInput(first, firstEvidence.id));
  assert.ok(released.auditId);
  await assertRecoveryHoldClear(first.db, `file:${first.restored}`, first.environment);
  const rotated = randomBytes(32);
  const rotatedEnvironment = { ...first.environment, BACKUP_ENCRYPTION_KEY: rotated.toString("base64"),
    BACKUP_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify([first.key.toString("base64")]) };
  assert.ok(recoveryBackupKeyById(first.manifest.encryption.keyId, rotatedEnvironment).equals(first.key),
    "restore/replay/release manifest selection must resolve the retained historical key");
  await assertRecoveryHoldClear(first.db, `file:${first.restored}`, rotatedEnvironment);
  assert.match(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "await import('./app/db.server.ts'); console.log('rotated-key-start-ok')"], { cwd: process.cwd(),
    env: { ...process.env, ...rotatedEnvironment, NODE_ENV: "production", DATABASE_URL: `file:${first.restored}` }, encoding: "utf8" }),
  /rotated-key-start-ok/);
  await assert.rejects(transferSqliteToPostgres({ sourcePath: first.restored,
    postgres: { host: "127.0.0.1", port: 1, user: "fixture", database: "fixture", sslmode: "disable" },
    models: [], migrationSql: "", schemaHash: "fixture", environment: rotatedEnvironment }), (error: unknown) => {
    assert.doesNotMatch(error instanceof Error ? error.message : String(error), /RECOVERY_/,
      "retained historical key must pass the recovery authority gate before the synthetic connection fails");
    return true;
  });
  await assert.rejects(assertRecoveryHoldClear(first.db, `file:${first.restored}`, {
    ...first.environment, BACKUP_ENCRYPTION_KEY: rotated.toString("base64"), BACKUP_ENCRYPTION_PREVIOUS_KEYS: "[]",
  }), /RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED/);
  assert.throws(() => recoveryBackupKeyById(first.manifest.encryption.keyId, {
    ...first.environment, BACKUP_ENCRYPTION_KEY: rotated.toString("base64"), BACKUP_ENCRYPTION_PREVIOUS_KEYS: "[]",
  }), /RECOVERY_INTEGRITY_KEY_HISTORY_MISSING/);
  await assert.rejects(assertRecoveryHoldClear(first.db, `file:${first.restored}`, {
    ...first.environment, BACKUP_ENCRYPTION_KEY: rotated.toString("base64"), BACKUP_ENCRYPTION_PREVIOUS_KEYS: "not-json",
  }), /RECOVERY_RELEASE_AUDIT_REQUIRED/);
  const secondPath = join(first.directory, "restored-again.sqlite");
  const secondObjects = store();
  const secondManifest = await createVerifiedBackup({ sourcePath: first.restored, directory: join(first.directory, "backup-again"),
    key: first.key, appVersion: "reopening-test-2", store: secondObjects.adapter });
  await restoreEncryptedBackup({ artifactPath: join(first.directory, "backup-again", secondManifest.artifact), manifest: secondManifest,
    key: first.key, destination: secondPath, ...(secondManifest.privacyJournal ? {
      privacyJournalPath: join(first.directory, "backup-again", secondManifest.privacyJournal.artifact), privacyJournal: secondManifest.privacyJournal,
    } : {}) });
  const secondDb = new PrismaClient({ datasourceUrl: `file:${secondPath}` });
  const secondHold = await secondDb.recoveryHold.findUniqueOrThrow({ where: { id: "1" } });
  assert.equal(secondHold.state, "HELD");
  assert.equal(secondHold.replayEvidenceId, null, "a new restore cannot trust the previous cycle pointer");
  assert.equal(await secondDb.recoveryReplayEvidence.count(), 1, "prior signed evidence remains append-only");
  assert.equal(await secondDb.recoveryReleaseAudit.count(), 1, "prior signed release remains append-only");
  const second = { ...first, restored: secondPath, db: secondDb, manifest: secondManifest, objects: secondObjects };
  const secondEvidence = await evidence(second);
  await releaseRecoveryHold(releaseInput(second, secondEvidence.id));
  assert.equal(await secondDb.recoveryReplayEvidence.count(), 2);
  assert.equal(await secondDb.recoveryReleaseAudit.count(), 2);
  await assertRecoveryHoldClear(secondDb, `file:${secondPath}`, second.environment);
  assert.match(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "await import('./app/db.server.ts'); console.log('released-start-ok')"], { cwd: process.cwd(),
    env: { ...process.env, ...first.environment, NODE_ENV: "production", DATABASE_URL: `file:${first.restored}` }, encoding: "utf8" }), /released-start-ok/);
  await first.db.$disconnect();
  await secondDb.$disconnect();
});

test("release rejects changed database, stale evidence, wrong key and unresolved replay without clearing hold", async () => {
  const changed = await restoredFixture();
  const changedEvidence = await evidence(changed);
  await changed.db.merchant.updateMany({ data: { updatedAt: new Date(Date.now() + 5_000) } });
  await assert.rejects(releaseRecoveryHold(releaseInput(changed, changedEvidence.id)), /RECOVERY_DATABASE_CHANGED/);
  assert.equal((await changed.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).state, "READY");
  assert.equal(await changed.db.recoveryReleaseAudit.count(), 0);

  const stale = await restoredFixture();
  const base = new Date("2026-09-05T10:00:00.000Z");
  const staleEvidence = await evidence(stale, { now: base });
  await assert.rejects(releaseRecoveryHold(releaseInput(stale, staleEvidence.id, new Date(base.getTime() + 86_400_001))),
    /RECOVERY_EVIDENCE_STALE_OR_FUTURE/);
  assert.equal((await stale.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).state, "READY");

  const wrong = await restoredFixture();
  const wrongEvidence = await evidence(wrong);
  await assert.rejects(releaseRecoveryHold({ ...releaseInput(wrong, wrongEvidence.id), key: randomBytes(32) }),
    /RECOVERY_HOLD_AUTHENTICATION_FAILED/);
  assert.equal((await wrong.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).state, "READY");

  const unresolved = await restoredFixture();
  await assert.rejects(evidence(unresolved, { unresolvedCount: 1 }), /RECOVERY_REPLAY_UNRESOLVED/);
  assert.equal((await unresolved.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).state, "HELD");
  assert.equal(await unresolved.db.recoveryReplayEvidence.count(), 0);
  await Promise.all([changed.db.$disconnect(), stale.db.$disconnect(), wrong.db.$disconnect(), unresolved.db.$disconnect()]);
});

test("release is single-winner and audit insertion failure rolls back the hold transition", async () => {
  const race = await restoredFixture();
  const raceEvidence = await evidence(race);
  const contender = new PrismaClient({ datasourceUrl: `file:${race.restored}` });
  const outcomes = await Promise.allSettled([
    releaseRecoveryHold(releaseInput(race, raceEvidence.id)),
    releaseRecoveryHold({ ...releaseInput(race, raceEvidence.id), db: contender }),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await race.db.recoveryReleaseAudit.count(), 1);
  await contender.$disconnect();

  const rollback = await restoredFixture();
  const rollbackEvidence = await evidence(rollback);
  const seed = releaseInput(rollback, rollbackEvidence.id);
  await rollback.db.recoveryReleaseAudit.create({ data: {
    id: "preexisting-audit", holdId: "1", evidenceId: rollbackEvidence.id,
    sourceManifestSha256: seed.sourceManifestSha256, sourceArtifactSha256: seed.sourceArtifactSha256,
    restoredDbSha256: (await rollback.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).restoredDbSha256!,
    schemaSha256: (await rollback.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).schemaSha256!,
    receiptInventoryDigest: seed.receiptInventoryDigest, evidenceHash: rollbackEvidence.evidenceHash,
    operatorIdentity: "invalid-seed", privacyReviewReference: "invalid", backupReviewReference: "invalid",
    legacyInventoryReference: "invalid", receiptQuiescenceReference: "invalid", releasedAt: new Date(), integrityTag: "invalid",
  } });
  await assert.rejects(releaseRecoveryHold(seed), /Unique constraint|P2002/);
  assert.equal((await rollback.db.recoveryHold.findUniqueOrThrow({ where: { id: "1" } })).state, "READY");
  await Promise.all([race.db.$disconnect(), rollback.db.$disconnect()]);
});

test("fingerprinting and startup fail closed for oversized, malformed, extra or unsigned recovery state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-reopening-invalid-"));
  const oversized = join(directory, "oversized.sqlite");
  migrate(oversized);
  execFileSync("sqlite3", [oversized], { input: "CREATE TABLE Huge(id TEXT PRIMARY KEY, payload BLOB); INSERT INTO Huge VALUES('1', zeroblob(1048577));" });
  const oversizedDb = new PrismaClient({ datasourceUrl: `file:${oversized}` });
  await assert.rejects(protectedDatabaseFingerprint(oversizedDb), /RECOVERY_FINGERPRINT_BUDGET_EXCEEDED/);
  await oversizedDb.$disconnect();

  for (const [name, sql, expected] of [
    ["legacy", "CREATE TABLE _PagneticRecoveryHold(id INTEGER PRIMARY KEY, reason TEXT NOT NULL); INSERT INTO _PagneticRecoveryHold VALUES(1,'held');", /SCHEMA_UNSUPPORTED/],
    ["malformed", "CREATE TABLE _PagneticRecoveryHold(id TEXT PRIMARY KEY, state TEXT); INSERT INTO _PagneticRecoveryHold VALUES('1','RELEASED');", /SCHEMA_MALFORMED/],
  ] as const) {
    const path = join(directory, `${name}.sqlite`);
    execFileSync("sqlite3", [path], { input: sql });
    const db = new PrismaClient({ datasourceUrl: `file:${path}` });
    await assert.rejects(assertRecoveryHoldClear(db, `file:${path}`, {}), expected);
    await db.$disconnect();
  }

  const unsigned = join(directory, "unsigned.sqlite");
  migrate(unsigned);
  execFileSync("sqlite3", [unsigned], { input: "INSERT INTO _PagneticRecoveryHold(id,state,reason,integrityTag) VALUES('1','RELEASED','forged','');" });
  const unsignedDb = new PrismaClient({ datasourceUrl: `file:${unsigned}` });
  await assert.rejects(assertRecoveryHoldClear(unsignedDb, `file:${unsigned}`, {}), /RECOVERY_RELEASE_AUDIT_REQUIRED/);
  execFileSync("sqlite3", [unsigned], { input: "INSERT INTO _PagneticRecoveryHold(id,state,reason,integrityTag) VALUES('2','RELEASED','forged','x');" });
  await assert.rejects(assertRecoveryHoldClear(unsignedDb, `file:${unsigned}`, {}), /RECOVERY_HOLD_STATE_INVALID/);
  await unsignedDb.$disconnect();
});

import { execFile, spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  constants,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { assertBackupHeadroom } from "./backup-headroom";
import { PrismaClient } from "@prisma/client";
import { canonicalRecoveryHoldMetadata, protectedDatabaseFingerprint, protectedSchemaFingerprint,
  recoveryHoldIntegrityTag } from "../../app/services/recovery-reopening.server";
import {
  decryptPrivacyJournal,
  encryptPrivacyJournal,
  privacyJournalFromRows,
  type PrivacyJournal,
} from "../../app/services/privacy-journal.server";

const execute = promisify(execFile);
const DAY = 86_400_000;

export interface BackupStore {
  kind: "s3" | "test";
  destination: string;
  put(key: string, path: string): Promise<void>;
  get(key: string, path: string): Promise<void>;
}

export type BackupManifest = {
  format: 1;
  artifact: string;
  createdAt: string;
  appVersion: string;
  schemaSha256: string;
  plaintextSha256: string;
  encryptedSha256: string;
  encryptedBytes: number;
  encryption: {
    algorithm: "aes-256-gcm";
    nonce: string;
    tag: string;
    keyId: string;
  };
  remote: { kind: "s3" | "test"; destination: string; readBackAt: string };
  privacyJournal?: {
    artifact: string;
    encryptedSha256: string;
    encryptedBytes: number;
    rowCount: number;
    readBackAt: string;
  };
  restore: {
    verifiedAt: string;
    durationMs: number;
    integrity: "ok";
    foreignKeys: "ok";
  };
  signature: string;
};

export function decodeBackupKey(value: string | undefined) {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be a separate 32-byte base64 key",
    );
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Invalid backup key length");
  return key;
}

export function databasePath(databaseUrl: string | undefined) {
  // Require an absolute file path: Prisma resolves relative paths against its schema,
  // whereas sqlite3 resolves against the process directory. Never back up the wrong DB.
  if (
    !databaseUrl?.startsWith("file:/") ||
    databaseUrl.includes("?") ||
    databaseUrl.includes("\0")
  )
    throw new Error(
      "Backups require DATABASE_URL=file:/absolute/path.sqlite without query parameters",
    );
  return resolve(databaseUrl.slice(5));
}

async function sqlite(path: string, sql: string) {
  const result = await execute("sqlite3", ["-batch", "-readonly", path, sql], {
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function signature(manifest: Omit<BackupManifest, "signature">, key: Buffer) {
  // Domain separation keeps manifest authentication distinct from file encryption.
  return createHmac("sha256", key)
    .update("pagnetic-backup-manifest-v1\0")
    .update(canonical(manifest))
    .digest("hex");
}

export function verifyManifest(manifest: BackupManifest, key: Buffer) {
  const { signature: supplied, ...unsigned } = manifest;
  const expected = signature(unsigned, key);
  if (
    !/^[a-f0-9]{64}$/.test(supplied || "") ||
    !timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))
  )
    throw new Error("Backup manifest authentication failed");
  if (
    manifest.format !== 1 ||
    !/^pagnetic-[a-f0-9-]{36}\.sqlite\.enc$/.test(manifest.artifact) ||
    basename(manifest.artifact) !== manifest.artifact ||
    manifest.encryption.algorithm !== "aes-256-gcm"
  )
    throw new Error("Unsupported backup manifest");
  if (manifest.privacyJournal) {
    const journal = manifest.privacyJournal;
    if (journal.artifact !== `${manifest.artifact}.privacy.enc` ||
      !/^[a-f0-9]{64}$/.test(journal.encryptedSha256) ||
      !Number.isSafeInteger(journal.encryptedBytes) || journal.encryptedBytes <= 0 ||
      !Number.isSafeInteger(journal.rowCount) || journal.rowCount < 0 || journal.rowCount > 100_000 ||
      !Number.isFinite(Date.parse(journal.readBackAt)))
      throw new Error("Unsupported privacy journal manifest");
  }
  if (
    manifest.encryption.keyId !==
    createHash("sha256").update(key).digest("hex").slice(0, 16)
  )
    throw new Error("Backup key does not match manifest");
}

export async function preserveVerifiedRestoreManifest(manifestPath: string, restoredDatabasePath: string) {
  const output = `${restoredDatabasePath}.verified-manifest.json`;
  await copyFile(manifestPath, output, constants.COPYFILE_EXCL);
  return output;
}

export async function restoreEncryptedBackupWithManifest(input:
  Parameters<typeof restoreEncryptedBackup>[0] & { verifiedManifestSource: string }) {
  await restoreEncryptedBackup(input);
  try {
    const verifiedManifestPath = await preserveVerifiedRestoreManifest(input.verifiedManifestSource, input.destination);
    return { destination: input.destination, verifiedManifestPath };
  } catch (error) {
    // This destination was exclusively created by restoreEncryptedBackup in
    // this invocation. Do not leave a quarantined DB without its exact input.
    await rm(input.destination, { force: true });
    throw error;
  }
}

async function sqliteJson(path: string, sql: string) {
  const result = await execute("sqlite3", ["-batch", "-readonly", "-json", path, sql], {
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function sqliteScript(path: string, sql: string) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("sqlite3", ["-batch", "-bail", path], { stdio: ["pipe", "ignore", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 120_000);
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdin.once("error", () => { /* Nonzero exit is handled below. */ });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(stderr.trim() || `sqlite3 exited ${code}`)); });
    child.stdin.end(`${sql}\n`);
  });
}

async function readPrivacyJournal(path: string): Promise<PrivacyJournal | null> {
  const tables = await sqlite(path, "SELECT group_concat(name, '|') FROM sqlite_master WHERE type='table' AND name IN ('PrivacyOrderSuppression','PrivacyIdentitySuppression');");
  if (tables !== "PrivacyIdentitySuppression|PrivacyOrderSuppression" && tables !== "PrivacyOrderSuppression|PrivacyIdentitySuppression" &&
      tables !== "PrivacyOrderSuppression" && tables !== "PrivacyIdentitySuppression") return null;
  if (!tables.includes("PrivacyOrderSuppression") || !tables.includes("PrivacyIdentitySuppression"))
    throw new Error("Privacy suppression tables are incomplete");
  const orderJson = await sqliteJson(path, "SELECT shopHash, orderHash, requestId, lookupKeyId FROM PrivacyOrderSuppression ORDER BY id;");
  const identityJson = await sqliteJson(path, "SELECT shopHash, kind, identityHash, requestId, lookupKeyId FROM PrivacyIdentitySuppression ORDER BY id;");
  let orders: unknown;
  let identities: unknown;
  try { orders = JSON.parse(orderJson || "[]"); identities = JSON.parse(identityJson || "[]"); }
  catch { throw new Error("Privacy suppression journal rows are invalid JSON"); }
  if (!Array.isArray(orders) || !Array.isArray(identities)) throw new Error("Privacy suppression journal rows are invalid");
  return privacyJournalFromRows({ orderSuppressions: orders as PrivacyJournal["orderSuppressions"], identitySuppressions: identities as PrivacyJournal["identitySuppressions"] });
}

function sqlLiteral(value: string | null) {
  return value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
}

async function reapplyPrivacyJournalToSqlite(path: string, journal: PrivacyJournal) {
  const statements = ["BEGIN IMMEDIATE;"];
  for (const row of journal.orderSuppressions) statements.push(
    `INSERT INTO PrivacyOrderSuppression (id, shopHash, orderHash, requestId, createdAt, lookupKeyId) VALUES (${sqlLiteral(`restore-${randomUUID()}`)}, ${sqlLiteral(row.shopHash)}, ${sqlLiteral(row.orderHash)}, ${sqlLiteral(row.requestId)}, CURRENT_TIMESTAMP, ${sqlLiteral(row.lookupKeyId)}) ON CONFLICT(shopHash, orderHash) DO UPDATE SET requestId=excluded.requestId, lookupKeyId=excluded.lookupKeyId;`,
  );
  for (const row of journal.identitySuppressions) statements.push(
    `INSERT INTO PrivacyIdentitySuppression (id, shopHash, kind, identityHash, requestId, lookupKeyId, createdAt) VALUES (${sqlLiteral(`restore-${randomUUID()}`)}, ${sqlLiteral(row.shopHash)}, ${sqlLiteral(row.kind)}, ${sqlLiteral(row.identityHash)}, ${sqlLiteral(row.requestId)}, ${sqlLiteral(row.lookupKeyId)}, CURRENT_TIMESTAMP) ON CONFLICT(shopHash, kind, identityHash) DO UPDATE SET requestId=excluded.requestId, lookupKeyId=excluded.lookupKeyId;`,
  );
  statements.push("COMMIT;");
  await sqliteScript(path, statements.join("\n"));
}

async function integrity(path: string) {
  if ((await sqlite(path, "PRAGMA integrity_check;")) !== "ok")
    throw new Error("SQLite integrity check failed");
  if ((await sqlite(path, "PRAGMA foreign_key_check;")) !== "")
    throw new Error("SQLite foreign key check failed");
}

const recoveryDdl = `
CREATE TABLE IF NOT EXISTS "_PagneticRecoveryHold" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT '1', "state" TEXT NOT NULL DEFAULT 'HELD',
  "reason" TEXT NOT NULL DEFAULT 'NONE', "sourceManifestSha256" TEXT,
  "sourceArtifact" TEXT, "sourceArtifactSha256" TEXT, "restoredDbSha256" TEXT,
  "schemaSha256" TEXT, "replayEvidenceId" TEXT, "integrityTag" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "RecoveryReplayEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY, "holdId" TEXT NOT NULL, "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceManifestSha256" TEXT NOT NULL, "sourceArtifact" TEXT NOT NULL, "sourceArtifactSha256" TEXT NOT NULL,
  "restoredDbSha256" TEXT NOT NULL, "schemaSha256" TEXT NOT NULL, "receiptInventoryDigest" TEXT NOT NULL,
  "receiptInventoryStarted" DATETIME NOT NULL, "receiptInventoryFinished" DATETIME NOT NULL,
  "retainedKeyFingerprints" TEXT NOT NULL, "replayStartedAt" DATETIME NOT NULL,
  "replayFinishedAt" DATETIME NOT NULL, "receiptCount" INTEGER NOT NULL, "unresolvedCount" INTEGER NOT NULL,
  "erasureDigest" TEXT NOT NULL, "postReplayDbSha256" TEXT NOT NULL, "generatedAt" DATETIME NOT NULL,
  "integrityTag" TEXT NOT NULL,
  FOREIGN KEY ("holdId") REFERENCES "_PagneticRecoveryHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RecoveryReplayEvidence_sourceManifestSha256_generatedAt_idx" ON "RecoveryReplayEvidence"("sourceManifestSha256", "generatedAt");
CREATE TABLE IF NOT EXISTS "RecoveryReleaseAudit" (
  "id" TEXT NOT NULL PRIMARY KEY, "holdId" TEXT NOT NULL, "evidenceId" TEXT NOT NULL,
  "sourceManifestSha256" TEXT NOT NULL, "sourceArtifactSha256" TEXT NOT NULL, "restoredDbSha256" TEXT NOT NULL,
  "schemaSha256" TEXT NOT NULL, "receiptInventoryDigest" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL,
  "operatorIdentity" TEXT NOT NULL, "privacyReviewReference" TEXT NOT NULL, "backupReviewReference" TEXT NOT NULL,
  "legacyInventoryReference" TEXT NOT NULL, "receiptQuiescenceReference" TEXT NOT NULL, "releasedAt" DATETIME NOT NULL,
  "integrityTag" TEXT NOT NULL,
  FOREIGN KEY ("holdId") REFERENCES "_PagneticRecoveryHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("evidenceId") REFERENCES "RecoveryReplayEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryReleaseAudit_evidenceId_key" ON "RecoveryReleaseAudit"("evidenceId");
CREATE INDEX IF NOT EXISTS "RecoveryReleaseAudit_sourceManifestSha256_releasedAt_idx" ON "RecoveryReleaseAudit"("sourceManifestSha256", "releasedAt");`;

async function ensureRecoveryHold(path: string, manifest: BackupManifest, key: Buffer) {
  const applicationTables = Number(await sqlite(path,
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('Merchant','PrivacyRequest','PrivacyOrderSuppression');"));
  if (!applicationTables) return;
  const existing = await sqliteJson(path, "PRAGMA table_info(\"_PagneticRecoveryHold\");");
  let columns: Array<{ name: string }> = [];
  try { columns = JSON.parse(existing || "[]") as Array<{ name: string }>; } catch { throw new Error("RECOVERY_HOLD_SCHEMA_MALFORMED"); }
  if (columns.length === 2 && columns.some((column) => column.name === "id") && columns.some((column) => column.name === "reason"))
    throw new Error("RECOVERY_HOLD_SCHEMA_UNSUPPORTED");
  if (columns.length && !["id", "state", "reason", "sourceManifestSha256", "sourceArtifact", "sourceArtifactSha256", "restoredDbSha256", "schemaSha256", "replayEvidenceId", "integrityTag", "createdAt", "updatedAt"].every((name) => columns.some((column) => column.name === name)))
    throw new Error("RECOVERY_HOLD_SCHEMA_MALFORMED");
  const manifestSha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const db = new PrismaClient({ datasourceUrl: `file:${path}` });
  let restoredDbSha256: string;
  let schemaSha256: string;
  try {
    restoredDbSha256 = await protectedDatabaseFingerprint(db);
    schemaSha256 = await protectedSchemaFingerprint(db);
  } finally { await db.$disconnect(); }
  const holdFields = canonicalRecoveryHoldMetadata({ state: "HELD", reason: "INDEPENDENT_PRIVACY_RECEIPTS_AND_ACTIVE_DATA_REPLAY_REQUIRED",
    sourceManifestSha256: manifestSha256, sourceArtifact: manifest.artifact, sourceArtifactSha256: manifest.encryptedSha256,
    restoredDbSha256, schemaSha256, replayEvidenceId: null });
  const integrityTag = recoveryHoldIntegrityTag(key, holdFields);
  await sqliteScript(path, `${recoveryDdl}
BEGIN IMMEDIATE;
INSERT INTO "_PagneticRecoveryHold" ("id","state","reason","sourceManifestSha256","sourceArtifact","sourceArtifactSha256","restoredDbSha256","schemaSha256","integrityTag")
VALUES ('1',${sqlLiteral(holdFields.state)},${sqlLiteral(holdFields.reason)},${sqlLiteral(manifestSha256)},${sqlLiteral(manifest.artifact)},${sqlLiteral(manifest.encryptedSha256)},${sqlLiteral(restoredDbSha256)},${sqlLiteral(schemaSha256)},${sqlLiteral(integrityTag)})
ON CONFLICT("id") DO UPDATE SET "state"=excluded."state","reason"=excluded."reason","sourceManifestSha256"=excluded."sourceManifestSha256","sourceArtifact"=excluded."sourceArtifact","sourceArtifactSha256"=excluded."sourceArtifactSha256","restoredDbSha256"=excluded."restoredDbSha256","schemaSha256"=excluded."schemaSha256","replayEvidenceId"=NULL,"integrityTag"=excluded."integrityTag","updatedAt"=CURRENT_TIMESTAMP;
COMMIT;`);
}

export async function restoreEncryptedBackup(input: {
  artifactPath: string;
  manifest: BackupManifest;
  key: Buffer;
  destination: string;
  privacyJournalPath?: string;
  privacyJournal?: BackupManifest["privacyJournal"];
}) {
  verifyManifest(input.manifest, input.key);
  if ((await sha256File(input.artifactPath)) !== input.manifest.encryptedSha256)
    throw new Error("Encrypted backup checksum mismatch");
  const scratch = await mkdtemp(join(tmpdir(), "pagnetic-restore-"));
  try {
    const plain = join(scratch, "restored.sqlite");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      input.key,
      Buffer.from(input.manifest.encryption.nonce, "hex"),
    );
    decipher.setAuthTag(Buffer.from(input.manifest.encryption.tag, "hex"));
    await pipeline(
      createReadStream(input.artifactPath),
      decipher,
      createWriteStream(plain, { flags: "wx", mode: 0o600 }),
    );
    if ((await sha256File(plain)) !== input.manifest.plaintextSha256)
      throw new Error("Restored database checksum mismatch");
    await integrity(plain);
    if (input.manifest.privacyJournal) {
      if (!input.privacyJournalPath || !input.privacyJournal)
        throw new Error("Privacy journal is required for restore");
      // Authenticate against the signed manifest, never caller-supplied metadata.
      if (JSON.stringify(input.privacyJournal) !== JSON.stringify(input.manifest.privacyJournal))
        throw new Error("Privacy journal manifest mismatch");
      if ((await stat(input.privacyJournalPath)).size !== input.manifest.privacyJournal.encryptedBytes ||
        (await sha256File(input.privacyJournalPath)) !== input.manifest.privacyJournal.encryptedSha256)
        throw new Error("Privacy journal checksum mismatch");
      const journal = decryptPrivacyJournal(await readFile(input.privacyJournalPath), input.key);
      if (journal.orderSuppressions.length + journal.identitySuppressions.length !== input.privacyJournal.rowCount)
        throw new Error("Privacy journal row count mismatch");
      await reapplyPrivacyJournalToSqlite(plain, journal);
      await integrity(plain);
    }
    await ensureRecoveryHold(plain, input.manifest, input.key);
    // Never overwrite an existing database, even when a caller passes the live path.
    await copyFile(plain, input.destination, constants.COPYFILE_EXCL);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function createVerifiedBackup(input: {
  sourcePath: string;
  directory: string;
  key: Buffer;
  appVersion: string;
  store: BackupStore;
}) {
  if (!(await stat(input.sourcePath)).isFile())
    throw new Error("Source database must exist");
  if (input.key.length !== 32) throw new Error("Invalid backup key length");
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  await assertBackupHeadroom(input.sourcePath, input.directory);
  const scratch = await mkdtemp(join(tmpdir(), "pagnetic-backup-"));
  const artifact = `pagnetic-${randomUUID()}.sqlite.enc`;
  const createdAt = new Date().toISOString();
  try {
    const plain = join(scratch, "snapshot.sqlite");
    // SQLite's online snapshot includes committed WAL contents; never copy a live DB file.
    await sqlite(
      input.sourcePath,
      `VACUUM INTO '${plain.replaceAll("'", "''")}';`,
    );
    await integrity(plain);
    const schema = await sqlite(
      plain,
      "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;",
    );
    const journal = await readPrivacyJournal(plain);
    const journalArtifact = journal ? `${artifact}.privacy.enc` : null;
    const journalPath = journalArtifact ? join(scratch, journalArtifact) : null;
    if (journal && journalPath) await writeFile(journalPath, encryptPrivacyJournal(journal, input.key), { flag: "wx", mode: 0o600 });
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", input.key, nonce);
    const encrypted = join(scratch, artifact);
    await pipeline(
      createReadStream(plain),
      cipher,
      createWriteStream(encrypted, { flags: "wx", mode: 0o600 }),
    );
    const started = Date.now();
    await input.store.put(artifact, encrypted);
    if (journal && journalPath) await input.store.put(journalArtifact!, journalPath);
    const downloaded = join(scratch, "readback.enc");
    await input.store.get(artifact, downloaded);
    const downloadedJournal = journalArtifact ? join(scratch, "readback.privacy.enc") : undefined;
    if (journalArtifact && downloadedJournal) await input.store.get(journalArtifact, downloadedJournal);
    if (journal && downloadedJournal) {
      const opened = decryptPrivacyJournal(await readFile(downloadedJournal), input.key);
      if (opened.orderSuppressions.length + opened.identitySuppressions.length !== journal.orderSuppressions.length + journal.identitySuppressions.length)
        throw new Error("Privacy journal readback mismatch");
    }
    const unsigned: Omit<BackupManifest, "signature"> = {
      format: 1,
      artifact,
      createdAt,
      appVersion: input.appVersion,
      schemaSha256: createHash("sha256").update(schema).digest("hex"),
      plaintextSha256: await sha256File(plain),
      encryptedSha256: await sha256File(encrypted),
      encryptedBytes: (await stat(encrypted)).size,
      encryption: {
        algorithm: "aes-256-gcm",
        nonce: nonce.toString("hex"),
        tag: cipher.getAuthTag().toString("hex"),
        keyId: createHash("sha256")
          .update(input.key)
          .digest("hex")
          .slice(0, 16),
      },
      remote: {
        kind: input.store.kind,
        destination: input.store.destination,
        readBackAt: new Date().toISOString(),
      },
      ...(journal && journalArtifact && journalPath ? { privacyJournal: {
        artifact: journalArtifact,
        encryptedSha256: await sha256File(journalPath),
        encryptedBytes: (await stat(journalPath)).size,
        rowCount: journal.orderSuppressions.length + journal.identitySuppressions.length,
        readBackAt: new Date().toISOString(),
      } } : {}),
      restore: {
        verifiedAt: new Date().toISOString(),
        durationMs: 0,
        integrity: "ok",
        foreignKeys: "ok",
      },
    };
    // This provisional in-memory manifest is not published until restoration succeeds.
    await restoreEncryptedBackup({
      artifactPath: downloaded,
      manifest: { ...unsigned, signature: signature(unsigned, input.key) },
      key: input.key,
      destination: join(scratch, "verified.sqlite"),
      ...(downloadedJournal && unsigned.privacyJournal ? { privacyJournalPath: downloadedJournal, privacyJournal: unsigned.privacyJournal } : {}),
    });
    unsigned.restore.verifiedAt = new Date().toISOString();
    unsigned.restore.durationMs = Date.now() - started;
    const manifest: BackupManifest = {
      ...unsigned,
      signature: signature(unsigned, input.key),
    };
    const manifestPath = join(scratch, `${artifact}.json`);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    await input.store.put(`${artifact}.json`, manifestPath);
    const remoteManifest = join(scratch, "remote-manifest.json");
    await input.store.get(`${artifact}.json`, remoteManifest);
    if ((await sha256File(remoteManifest)) !== (await sha256File(manifestPath)))
      throw new Error("Remote manifest readback mismatch");
    await copyFile(
      encrypted,
      join(input.directory, artifact),
      constants.COPYFILE_EXCL,
    );
    if (journal && journalPath) await copyFile(journalPath, join(input.directory, journalArtifact!), constants.COPYFILE_EXCL);
    await copyFile(
      manifestPath,
      join(input.directory, `${artifact}.json`),
      constants.COPYFILE_EXCL,
    );
    const latest = join(input.directory, `${artifact}.latest`);
    await copyFile(manifestPath, latest, constants.COPYFILE_EXCL);
    await rename(latest, join(input.directory, "latest-verified.json"));
    return manifest;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function checkBackupEvidence(input: {
  directory: string;
  key: Buffer;
  expectedDestination: string;
  now?: Date;
}) {
  try {
    const path = join(input.directory, "latest-verified.json");
    if ((await stat(path)).size > 16_384)
      throw new Error("Invalid manifest size");
    const manifest = JSON.parse(await readFile(path, "utf8")) as BackupManifest;
    verifyManifest(manifest, input.key);
    const now = (input.now ?? new Date()).getTime();
    for (const timestamp of [
      manifest.createdAt,
      manifest.remote.readBackAt,
      manifest.restore.verifiedAt,
    ]) {
      const age = now - Date.parse(timestamp);
      if (!Number.isFinite(age) || age < -60_000 || age > DAY)
        throw new Error("Backup/restore evidence is stale or future dated");
    }
    if (
      manifest.remote.kind !== "s3" ||
      manifest.remote.destination !== input.expectedDestination
    )
      throw new Error(
        "Evidence is not from the configured off-volume destination",
      );
    if (
      manifest.restore.integrity !== "ok" ||
      manifest.restore.foreignKeys !== "ok" ||
      manifest.restore.durationMs < 0 ||
      manifest.restore.durationMs > 4 * 60 * 60_000
    )
      throw new Error("Restore proof failed the four-hour pilot target");
    const artifact = join(input.directory, manifest.artifact);
    if (
      (await stat(artifact)).size !== manifest.encryptedBytes ||
      (await sha256File(artifact)) !== manifest.encryptedSha256
    )
      throw new Error("Backup artifact checksum mismatch");
    if (manifest.privacyJournal) {
      const journal = manifest.privacyJournal;
      const journalPath = join(input.directory, journal.artifact);
      if ((await stat(journalPath)).size !== journal.encryptedBytes ||
        (await sha256File(journalPath)) !== journal.encryptedSha256 ||
        !Number.isFinite(Date.parse(journal.readBackAt)) ||
        now - Date.parse(journal.readBackAt) < -60_000 ||
        now - Date.parse(journal.readBackAt) > DAY)
        throw new Error("Privacy journal sidecar checksum/readback evidence is missing or stale");
    }
    return {
      passed: true,
      detail: `Encrypted off-volume readback, privacy sidecar and isolated SQLite restore verified at ${manifest.restore.verifiedAt}; independent receipt replay and full incident recovery drill still required`,
    };
  } catch (error) {
    return {
      passed: false,
      detail:
        error instanceof Error ? error.message : "Backup verification failed",
    };
  }
}

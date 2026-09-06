import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { backupS3Config } from "../scripts/lib/backup-s3";
import { pruneLocalVerifiedBackups } from "../scripts/lib/backup-retention";
import {
  checkBackupEvidence,
  createVerifiedBackup,
  databasePath,
  decodeBackupKey,
  preserveVerifiedRestoreManifest,
  restoreEncryptedBackup,
  restoreEncryptedBackupWithManifest,
  type BackupStore,
} from "../scripts/lib/sqlite-backup";

const execute = promisify(execFile);
const key = randomBytes(32);

test("authenticated local retention preserves recovery copies and never deletes remote or unrelated files", async () => {
  const f = await fixture();
  try {
    const manifests = [];
    for (let index = 0; index < 5; index += 1)
      manifests.push(await createVerifiedBackup({ sourcePath: f.sourcePath, directory: f.output, key, store: f.store, appVersion: "retention-fixture" }));
    const sentinel = join(f.output, "old-user-export.sqlite");
    await writeFile(sentinel, "preserve this unrelated export");
    const malformed = join(f.output, `pagnetic-${randomUUID()}.sqlite.enc.json`);
    await writeFile(malformed, "not a verified manifest");
    const dry = await pruneLocalVerifiedBackups({ directory: f.output, key, store: f.store, keep: 2, dryRun: true });
    assert.equal(dry.deleted.length, 0);
    assert.equal(dry.wouldDelete.length, 3);
    assert.equal(dry.skipped, 1);
    const before = (await readdir(f.output)).sort();
    await assert.rejects(pruneLocalVerifiedBackups({ directory: f.output, key, keep: 2,
      store: { ...f.store, async get() { throw new Error("synthetic remote outage"); } } }), /remote outage/);
    assert.deepEqual((await readdir(f.output)).sort(), before);
    const latestObject = manifests.at(-1)!.artifact;
    const originalRemoteBytes = f.objects.get(latestObject)!;
    f.objects.set(latestObject, Buffer.from("synthetic corrupted remote ciphertext"));
    await assert.rejects(pruneLocalVerifiedBackups({ directory: f.output, key, store: f.store, keep: 2 }), /REMOTE_READBACK_INVALID/);
    assert.deepEqual((await readdir(f.output)).sort(), before);
    f.objects.set(latestObject, originalRemoteBytes);
    await assert.rejects(pruneLocalVerifiedBackups({ directory: f.output, key: randomBytes(32), store: f.store, keep: 2 }), /authentication failed/);
    assert.deepEqual((await readdir(f.output)).sort(), before);
    await assert.rejects(pruneLocalVerifiedBackups({ directory: f.output, key, store: f.store, keep: 1 }), /CONFIGURATION/);
    await assert.rejects(pruneLocalVerifiedBackups({ directory: f.output, key, store: f.store,
      now: new Date(Date.now()+2*86_400_000) }), /LATEST_STALE/);
    const result = await pruneLocalVerifiedBackups({ directory: f.output, key, store: f.store, keep: 2 });
    assert.equal(result.deleted.length, 3);
    assert.ok(result.freedBytes > 0);
    assert.equal(f.objects.size, 10, "remote artifact and manifest objects are never deleted");
    assert.equal(await readFile(sentinel, "utf8"), "preserve this unrelated export");
    assert.equal(await readFile(malformed, "utf8"), "not a verified manifest");
    const latest = manifests.at(-1)!;
    assert.ok(!result.deleted.includes(latest.artifact));
    await restoreEncryptedBackup({ artifactPath: join(f.output, latest.artifact), manifest: latest, key,
      destination: join(f.directory, "retained-copy-restored.sqlite") });
    assert.equal((await execute("sqlite3", [join(f.directory, "retained-copy-restored.sqlite"), "SELECT amount FROM orders;"])).stdout.trim(), "1599");
  } finally { await f.cleanup(); }
});

test("retention rejects unsafe directory links and preserves a replaced artifact symlink", async () => {
  const f = await fixture();
  try {
    const manifests = [];
    for (let index = 0; index < 4; index += 1)
      manifests.push(await createVerifiedBackup({ sourcePath: f.sourcePath, directory: f.output, key, store: f.store, appVersion: "retention-fixture" }));
    const replaced = join(f.output, manifests[0]!.artifact);
    await unlink(replaced);
    await symlink(f.sourcePath, replaced);
    const result = await pruneLocalVerifiedBackups({ directory: f.output, key, store: f.store, keep: 2 });
    assert.equal(result.skipped, 1);
    assert.ok(!result.deleted.includes(manifests[0]!.artifact));
    assert.equal((await execute("sqlite3", [f.sourcePath, "SELECT amount FROM orders;"])).stdout.trim(), "1599");
    const directoryLink = join(f.directory, "linked-cache");
    await symlink(f.output, directoryLink);
    await assert.rejects(pruneLocalVerifiedBackups({ directory: directoryLink, key, store: f.store }), /DIRECTORY_UNSAFE/);
  } finally { await f.cleanup(); }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pagnetic-backup-test-"));
  const sourcePath = join(directory, "source.sqlite");
  await execute("sqlite3", [
    sourcePath,
    "PRAGMA foreign_keys=ON; CREATE TABLE orders(id INTEGER PRIMARY KEY, amount INTEGER NOT NULL); INSERT INTO orders VALUES(1, 1599);",
  ]);
  const objects = new Map<string, Buffer>();
  const store: BackupStore = {
    kind: "test",
    destination: "fixture://isolated-memory-store",
    async put(name, path) {
      objects.set(name, await readFile(path));
    },
    async get(name, path) {
      const bytes = objects.get(name);
      if (!bytes) throw new Error("Missing fixture object");
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    },
  };
  return {
    directory,
    sourcePath,
    objects,
    store,
    output: join(directory, "backups"),
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("encrypted backup roundtrip restores actual rows and cannot overwrite an existing database", async () => {
  const f = await fixture();
  try {
    const manifest = await createVerifiedBackup({
      sourcePath: f.sourcePath,
      directory: f.output,
      key,
      store: f.store,
      appVersion: "test-release",
    });
    assert.equal(manifest.appVersion, "test-release");
    assert.equal(manifest.restore.integrity, "ok");
    const artifactPath = join(f.output, manifest.artifact);
    assert.notEqual(
      (await readFile(artifactPath)).subarray(0, 15).toString(),
      "SQLite format 3",
    );
    assert.equal(f.objects.size, 2);
    const destination = join(f.directory, "recovered.sqlite");
    await restoreEncryptedBackup({ artifactPath, manifest, key, destination });
    const verifiedManifest = await preserveVerifiedRestoreManifest(
      join(f.output, `${manifest.artifact}.json`), destination);
    assert.equal(verifiedManifest, `${destination}.verified-manifest.json`);
    assert.deepEqual(await readFile(verifiedManifest), await readFile(join(f.output, `${manifest.artifact}.json`)),
      "recovery CLIs receive the exact authenticated manifest bytes beside the restored database");
    await assert.rejects(preserveVerifiedRestoreManifest(join(f.output, `${manifest.artifact}.json`), destination), /EEXIST/);
    const collisionDestination = join(f.directory, "collision-recovered.sqlite");
    await writeFile(`${collisionDestination}.verified-manifest.json`, "operator-owned-existing-manifest");
    await assert.rejects(restoreEncryptedBackupWithManifest({ artifactPath, manifest, key,
      destination: collisionDestination, verifiedManifestSource: join(f.output, `${manifest.artifact}.json`) }), /EEXIST/);
    await assert.rejects(stat(collisionDestination), /ENOENT/,
      "a manifest collision must roll back only the database created by this restore invocation");
    assert.equal(await readFile(`${collisionDestination}.verified-manifest.json`, "utf8"), "operator-owned-existing-manifest");
    assert.equal(
      (
        await execute("sqlite3", [destination, "SELECT amount FROM orders;"])
      ).stdout.trim(),
      "1599",
    );
    const before = await readFile(f.sourcePath);
    await assert.rejects(
      restoreEncryptedBackup({
        artifactPath,
        manifest,
        key,
        destination: f.sourcePath,
      }),
      /EEXIST/,
    );
    assert.deepEqual(await readFile(f.sourcePath), before);
    assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
    const evidence = await checkBackupEvidence({
      directory: f.output,
      key,
      expectedDestination: f.store.destination,
    });
    assert.equal(
      evidence.passed,
      false,
      "fixture store must never certify production readiness",
    );
    assert.match(evidence.detail, /off-volume/);
  } finally {
    await f.cleanup();
  }
});

test("backup carries the encrypted suppression journal and reapplies it before restore", async () => {
  const f = await fixture();
  try {
    await execute("sqlite3", [f.sourcePath, [
      "CREATE TABLE PrivacyOrderSuppression(id TEXT PRIMARY KEY, shopHash TEXT NOT NULL, orderHash TEXT NOT NULL, requestId TEXT NOT NULL, createdAt DATETIME NOT NULL, lookupKeyId TEXT);",
      "CREATE UNIQUE INDEX PrivacyOrderSuppression_shopHash_orderHash_key ON PrivacyOrderSuppression(shopHash, orderHash);",
      "CREATE TABLE PrivacyIdentitySuppression(id TEXT PRIMARY KEY, shopHash TEXT NOT NULL, kind TEXT NOT NULL, identityHash TEXT NOT NULL, requestId TEXT NOT NULL, lookupKeyId TEXT NOT NULL, createdAt DATETIME NOT NULL);",
      "CREATE UNIQUE INDEX PrivacyIdentitySuppression_shopHash_kind_identityHash_key ON PrivacyIdentitySuppression(shopHash, kind, identityHash);",
      `INSERT INTO PrivacyOrderSuppression VALUES('o1','${"a".repeat(64)}','${"b".repeat(64)}','request-1',CURRENT_TIMESTAMP,'${"c".repeat(64)}');`,
      `INSERT INTO PrivacyIdentitySuppression VALUES('i1','${"a".repeat(64)}','VISITOR','${"d".repeat(64)}','request-1','${"c".repeat(64)}',CURRENT_TIMESTAMP);`,
    ].join(" ")]);
    const manifest = await createVerifiedBackup({ sourcePath: f.sourcePath, directory: f.output, key, store: f.store, appVersion: "journal-fixture" });
    assert.ok(manifest.privacyJournal);
    assert.equal(manifest.privacyJournal!.rowCount, 2);
    assert.equal(f.objects.size, 3);
    const destination = join(f.directory, "journal-restored.sqlite");
    await restoreEncryptedBackup({ artifactPath: join(f.output, manifest.artifact), manifest, key, destination,
      privacyJournalPath: join(f.output, manifest.privacyJournal!.artifact), privacyJournal: manifest.privacyJournal });
    assert.equal((await execute("sqlite3", [destination, "SELECT count(*) FROM PrivacyOrderSuppression; SELECT count(*) FROM PrivacyIdentitySuppression;"])).stdout.trim(), "1\n1");
  } finally { await f.cleanup(); }
});

test("backup evidence rejects a missing or corrupted privacy sidecar", async () => {
  const f = await fixture();
  try {
    f.store.kind = "s3";
    f.store.destination = "https://fixture.invalid/privacy-backups";
    await execute("sqlite3", [f.sourcePath, [
      "CREATE TABLE PrivacyOrderSuppression(id TEXT PRIMARY KEY, shopHash TEXT NOT NULL, orderHash TEXT NOT NULL, requestId TEXT NOT NULL, createdAt DATETIME NOT NULL, lookupKeyId TEXT);",
      "CREATE UNIQUE INDEX PrivacyOrderSuppression_shopHash_orderHash_key ON PrivacyOrderSuppression(shopHash, orderHash);",
      "CREATE TABLE PrivacyIdentitySuppression(id TEXT PRIMARY KEY, shopHash TEXT NOT NULL, kind TEXT NOT NULL, identityHash TEXT NOT NULL, requestId TEXT NOT NULL, lookupKeyId TEXT NOT NULL, createdAt DATETIME NOT NULL);",
      "CREATE UNIQUE INDEX PrivacyIdentitySuppression_shopHash_kind_identityHash_key ON PrivacyIdentitySuppression(shopHash, kind, identityHash);",
      `INSERT INTO PrivacyOrderSuppression VALUES('o1','${"a".repeat(64)}','${"b".repeat(64)}','request-1',CURRENT_TIMESTAMP,'${"c".repeat(64)}');`,
    ].join(" ")]);
    const manifest = await createVerifiedBackup({ sourcePath: f.sourcePath, directory: f.output, key, store: f.store, appVersion: "sidecar-check" });
    const sidecar = join(f.output, manifest.privacyJournal!.artifact);
    await unlink(sidecar);
    const missing = await checkBackupEvidence({ directory: f.output, key, expectedDestination: f.store.destination });
    assert.equal(missing.passed, false);
    assert.match(missing.detail, /sidecar|ENOENT/);
  } finally { await f.cleanup(); }
});

test("remote corruption or failed upload never publishes verified evidence", async () => {
  for (const failure of ["corrupt", "upload"] as const) {
    const f = await fixture();
    try {
      if (failure === "upload")
        f.store.put = async () => {
          throw new Error("HTTP503");
        };
      else
        f.store.get = async (_name, path) => {
          await writeFile(path, "corrupted");
        };
      await assert.rejects(
        createVerifiedBackup({
          sourcePath: f.sourcePath,
          directory: f.output,
          key,
          store: f.store,
          appVersion: "test",
        }),
      );
      assert.deepEqual(await readdir(f.output), []);
    } finally {
      await f.cleanup();
    }
  }
});

test("authenticated manifests reject tampering and wrong keys before restoration", async () => {
  const f = await fixture();
  try {
    const manifest = await createVerifiedBackup({
      sourcePath: f.sourcePath,
      directory: f.output,
      key,
      store: f.store,
      appVersion: "test",
    });
    const args = {
      artifactPath: join(f.output, manifest.artifact),
      manifest,
      key,
      destination: join(f.directory, "new.sqlite"),
    };
    await assert.rejects(
      restoreEncryptedBackup({
        ...args,
        manifest: { ...manifest, appVersion: "tampered" },
      }),
      /authentication/,
    );
    await assert.rejects(
      restoreEncryptedBackup({ ...args, key: randomBytes(32) }),
      /authentication/,
    );
    await writeFile(args.artifactPath, "damaged");
    await assert.rejects(restoreEncryptedBackup(args), /checksum/);
  } finally {
    await f.cleanup();
  }
});

test("readiness rejects stale proof and arbitrary sqlite filenames", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await checkBackupEvidence({
          directory: f.directory,
          key,
          expectedDestination: "s3",
        })
      ).passed,
      false,
    );
    const manifest = await createVerifiedBackup({
      sourcePath: f.sourcePath,
      directory: f.output,
      key,
      store: f.store,
      appVersion: "test",
    });
    const evidence = await checkBackupEvidence({
      directory: f.output,
      key,
      expectedDestination: f.store.destination,
      now: new Date(Date.parse(manifest.createdAt) + 86_400_001),
    });
    assert.equal(evidence.passed, false);
    assert.match(evidence.detail, /stale/);
  } finally {
    await f.cleanup();
  }
});

test("snapshot includes committed WAL rows while a source connection remains open", async () => {
  const f = await fixture();
  const child = spawn("sqlite3", [f.sourcePath]);
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.once("error", reject);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("READY")) resolve();
      });
      child.stderr.on("data", (chunk) => reject(new Error(chunk.toString())));
      child.stdin.write(
        "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO orders VALUES(2,2499); SELECT 'READY';\n",
      );
    });
    assert.ok((await stat(`${f.sourcePath}-wal`)).size > 0);
    const manifest = await createVerifiedBackup({
      sourcePath: f.sourcePath,
      directory: f.output,
      key,
      store: f.store,
      appVersion: "wal-test",
    });
    const destination = join(f.directory, "wal-recovered.sqlite");
    await restoreEncryptedBackup({
      artifactPath: join(f.output, manifest.artifact),
      manifest,
      key,
      destination,
    });
    assert.equal(
      (
        await execute("sqlite3", [
          destination,
          "SELECT SUM(amount) FROM orders;",
        ])
      ).stdout.trim(),
      "4098",
    );
  } finally {
    child.stdin.end();
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
    await f.cleanup();
  }
});

test("backup configuration rejects ambiguous paths, unsafe endpoints and missing credentials", () => {
  assert.throws(() => databasePath("file:./prisma/dev.sqlite"), /absolute/);
  assert.throws(() => databasePath("postgres://example"), /absolute/);
  assert.equal(databasePath("file:/data/app.sqlite"), "/data/app.sqlite");
  assert.throws(() => decodeBackupKey("short"), /32-byte/);
  assert.deepEqual(decodeBackupKey(key.toString("base64")), key);
  assert.throws(
    () => backupS3Config({ BACKUP_S3_ENDPOINT: "http://example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () => backupS3Config({ BACKUP_S3_BUCKET: "test-bucket" }),
    /credentials/,
  );
});

test("readiness validates authenticated production-shaped evidence and rejects changed destinations or bytes", async () => {
  const f = await fixture();
  try {
    // Exercise the pure evidence checker only; this is not a real storage certification.
    const store: BackupStore = {
      ...f.store,
      kind: "s3",
      destination: "https://fixture.invalid/test-bucket/pagnetic-backups",
    };
    const manifest = await createVerifiedBackup({
      sourcePath: f.sourcePath,
      directory: f.output,
      key,
      store,
      appVersion: "test",
    });
    const args = {
      directory: f.output,
      key,
      expectedDestination: store.destination,
    };
    assert.equal((await checkBackupEvidence(args)).passed, true);
    assert.equal(
      (
        await checkBackupEvidence({
          ...args,
          expectedDestination: "https://other.invalid/bucket",
        })
      ).passed,
      false,
    );
    assert.equal(
      (
        await checkBackupEvidence({
          ...args,
          now: new Date(Date.parse(manifest.createdAt) - 120_000),
        })
      ).passed,
      false,
    );
    await writeFile(join(f.output, manifest.artifact), "damaged");
    assert.equal((await checkBackupEvidence(args)).passed, false);
  } finally {
    await f.cleanup();
  }
});

test("foreign-key violations cannot produce a verified backup", async () => {
  const f = await fixture();
  try {
    await execute("sqlite3", [
      f.sourcePath,
      "CREATE TABLE invalid_child(id INTEGER REFERENCES orders(id)); INSERT INTO invalid_child VALUES(999);",
    ]);
    await assert.rejects(
      createVerifiedBackup({
        sourcePath: f.sourcePath,
        directory: f.output,
        key,
        store: f.store,
        appVersion: "test",
      }),
      /foreign key/,
    );
    assert.equal(f.objects.size, 0);
  } finally {
    await f.cleanup();
  }
});

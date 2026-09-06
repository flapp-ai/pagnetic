import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBackupStore } from "./lib/backup-s3";
import {
  restoreEncryptedBackupWithManifest,
  verifyManifest,
  type BackupManifest,
} from "./lib/sqlite-backup";
import { recoveryBackupKeyById } from "../app/services/recovery-reopening.server";

const scratch = await mkdtemp(join(tmpdir(), "pagnetic-recovery-download-"));
try {
  const [manifestName, destination] = process.argv.slice(2);
  if (
    !/^pagnetic-[a-f0-9-]{36}\.sqlite\.enc\.json$/.test(manifestName || "") ||
    !destination?.startsWith("/")
  )
    throw new Error(
      "Usage: restore-sqlite.sh pagnetic-UUID.sqlite.enc.json /absolute/NEW-database.sqlite",
    );
  const store = createBackupStore();
  const manifestPath = join(scratch, "manifest.json");
  await store.get(manifestName, manifestPath);
  if ((await stat(manifestPath)).size > 16_384)
    throw new Error("Invalid manifest size");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as BackupManifest;
  const key = recoveryBackupKeyById(manifest.encryption?.keyId, process.env);
  verifyManifest(manifest, key);
  if (
    `${manifest.artifact}.json` !== manifestName ||
    manifest.remote.destination !== store.destination
  )
    throw new Error("Manifest destination/object mismatch");
  const artifactPath = join(scratch, "backup.enc");
  await store.get(manifest.artifact, artifactPath);
  const journalPath = manifest.privacyJournal ? join(scratch, "privacy-journal.enc") : undefined;
  if (manifest.privacyJournal && journalPath) await store.get(manifest.privacyJournal.artifact, journalPath);
  const exactDestination = resolve(destination);
  const restored = await restoreEncryptedBackupWithManifest({
    artifactPath,
    manifest,
    key,
    destination: exactDestination,
    verifiedManifestSource: manifestPath,
    ...(journalPath && manifest.privacyJournal ? { privacyJournalPath: journalPath, privacyJournal: manifest.privacyJournal } : {}),
  });
  console.log(
    `Restored and integrity-checked into ${exactDestination}. Verified manifest preserved at ${restored.verifiedManifestPath}. Application databases are quarantined: startup and PostgreSQL transfer refuse this file until independent privacy receipts and active-data deletion are verified. Keep writers stopped and complete the recovery runbook.`,
  );
} catch {
  console.error(
    "Restore failed. Confirm the manifest object, backup key, storage credentials and a new absolute destination path. Existing databases are never overwritten.",
  );
  process.exitCode = 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}

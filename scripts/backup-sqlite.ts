import { readFile } from "node:fs/promises";
import { createBackupStore } from "./lib/backup-s3";
import { pruneLocalVerifiedBackups } from "./lib/backup-retention";
import {
  createVerifiedBackup,
  databasePath,
  decodeBackupKey,
} from "./lib/sqlite-backup";

try {
  if (process.env.BACKUP_ENCRYPTION_KEY === process.env.FIELD_ENCRYPTION_KEY)
    throw new Error("Backup and field encryption keys must be independent");
  if (!process.env.BACKUP_DESTINATION?.startsWith("/"))
    throw new Error("Set an absolute BACKUP_DESTINATION");
  const keep = Number(process.env.BACKUP_LOCAL_KEEP ?? "8");
  if (!Number.isSafeInteger(keep) || keep < 2 || keep > 30)
    throw new Error("BACKUP_LOCAL_KEEP must retain 2 through 30 verified local copies");
  const store = createBackupStore();
  const key = decodeBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const manifest = await createVerifiedBackup({
    sourcePath: databasePath(process.env.DATABASE_URL),
    directory: process.env.BACKUP_DESTINATION,
    key,
    appVersion: process.env.APP_RELEASE || pkg.version,
    store,
  });
  console.log(
    `Verified encrypted backup ${manifest.artifact}; restore ${manifest.restore.durationMs}ms`,
  );
  try {
    const retention = await pruneLocalVerifiedBackups({ directory: process.env.BACKUP_DESTINATION, key, store, keep });
    console.log(`Local backup cache: ${retention.deleted.length} verified obsolete pairs removed; remote objects unchanged.`);
    if (retention.skipped) console.error("Backup cache contains unverified or changed entries; operator review required.");
  } catch {
    console.error("Backup is verified, but local retention did not complete; inspect storage headroom and preserved entries.");
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Encrypted off-volume backup failed. Check configuration, storage permissions, connectivity and SQLite integrity.",
  );
  process.exitCode = 1;
}

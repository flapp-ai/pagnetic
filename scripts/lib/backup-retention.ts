import { lstat, mkdtemp, opendir, readFile, rm, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sha256File, verifyManifest, type BackupManifest, type BackupStore } from "./sqlite-backup";

const DAY_MS = 86_400_000;
const MANIFEST_PATTERN = /^pagnetic-[a-f0-9-]{36}\.sqlite\.enc\.json$/;

/** Local cache only. The store adapter has no remote-delete operation. */
export async function pruneLocalVerifiedBackups(args: {
  directory: string; key: Buffer; store: BackupStore; keep?: number; dryRun?: boolean; now?: Date;
}) {
  const directory = resolve(args.directory);
  const keep = args.keep ?? 8;
  const now = (args.now ?? new Date()).getTime();
  if (!Number.isSafeInteger(keep) || keep < 2 || keep > 30 || !Number.isFinite(now) ||
    !args.directory.startsWith("/") || [dirname(directory), homedir(), process.cwd()].includes(directory))
    throw new Error("BACKUP_RETENTION_CONFIGURATION_INVALID");
  const folder = await lstat(directory);
  if (!folder.isDirectory() || folder.isSymbolicLink() || (folder.mode & 0o022) !== 0)
    throw new Error("BACKUP_RETENTION_DIRECTORY_UNSAFE");

  async function verified(name: string) {
    const manifestPath = join(directory, name);
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.nlink !== 1 || manifestStat.size > 16_384)
      throw new Error("BACKUP_RETENTION_MANIFEST_UNSAFE");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
    verifyManifest(manifest, args.key);
    if (name !== "latest-verified.json" && name !== `${manifest.artifact}.json`)
      throw new Error("BACKUP_RETENTION_ARTIFACT_NAME_MISMATCH");
    if (manifest.remote.kind !== args.store.kind || manifest.remote.destination !== args.store.destination ||
      manifest.restore.integrity !== "ok" || manifest.restore.foreignKeys !== "ok" ||
      !Number.isFinite(manifest.restore.durationMs) || manifest.restore.durationMs < 0 || manifest.restore.durationMs > 4*60*60_000)
      throw new Error("BACKUP_RETENTION_PROOF_INVALID");
    const times = [manifest.createdAt, manifest.remote.readBackAt, manifest.restore.verifiedAt].map(Date.parse);
    if (times.some((time) => !Number.isFinite(time) || time > now+60_000) ||
      times[1]! < times[0]! || times[2]! < times[0]!) throw new Error("BACKUP_RETENTION_TIMESTAMPS_INVALID");
    const artifactPath = join(directory, manifest.artifact);
    const artifactStat = await lstat(artifactPath);
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink() || artifactStat.nlink !== 1 ||
      artifactStat.size !== manifest.encryptedBytes || await sha256File(artifactPath) !== manifest.encryptedSha256)
      throw new Error("BACKUP_RETENTION_ARTIFACT_INVALID");
    const privacyJournalPath = manifest.privacyJournal ? join(directory, manifest.privacyJournal.artifact) : undefined;
    let privacyJournalStat;
    if (manifest.privacyJournal) {
      privacyJournalStat = await lstat(privacyJournalPath!);
      if (!privacyJournalStat.isFile() || privacyJournalStat.isSymbolicLink() || privacyJournalStat.nlink !== 1 ||
        privacyJournalStat.size !== manifest.privacyJournal.encryptedBytes || await sha256File(privacyJournalPath!) !== manifest.privacyJournal.encryptedSha256)
        throw new Error("BACKUP_RETENTION_PRIVACY_JOURNAL_INVALID");
    }
    return { manifest, manifestPath, artifactPath, manifestStat, artifactStat, privacyJournalPath, privacyJournalStat };
  }

  const latest = await verified("latest-verified.json");
  if ([latest.manifest.createdAt, latest.manifest.remote.readBackAt, latest.manifest.restore.verifiedAt]
    .some((time) => now-Date.parse(time) > DAY_MS)) throw new Error("BACKUP_RETENTION_LATEST_STALE");
  const candidates: Array<Awaited<ReturnType<typeof verified>>> = [];
  let skipped = 0;
  let entries = 0;
  for await (const entry of await opendir(directory)) {
    entries += 1;
    if (entries > 1_024) throw new Error("BACKUP_RETENTION_SCAN_LIMIT_REQUIRES_OPERATOR");
    if (!MANIFEST_PATTERN.test(entry.name)) continue;
    try { candidates.push(await verified(entry.name)); }
    catch { skipped += 1; } // Unknown, corrupt, old-key or linked files are untouched.
  }
  candidates.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt) || a.manifest.artifact.localeCompare(b.manifest.artifact));
  const preserved = new Set(candidates.slice(0, keep).map((item) => item.manifest.artifact));
  preserved.add(latest.manifest.artifact);
  if (candidates.length < 2) return { deleted: [] as string[], wouldDelete: [] as string[], preserved: [...preserved], skipped, freedBytes: 0 };
  const selected = candidates.filter((item) => !preserved.has(item.manifest.artifact));
  if (!selected.length) return { deleted: [] as string[], wouldDelete: [] as string[], preserved: [...preserved], skipped, freedBytes: 0 };

  // Verify that today's retained latest copy can still be fetched from the
  // configured store. Historical upload proof alone cannot authorize pruning.
  const scratch = await mkdtemp(join(tmpdir(), "pagnetic-retention-readback-"));
  try {
    const readback = join(scratch, "latest.enc");
    await args.store.get(latest.manifest.artifact, readback);
    if (await sha256File(readback) !== latest.manifest.encryptedSha256)
      throw new Error("BACKUP_RETENTION_REMOTE_READBACK_INVALID");
    if (latest.manifest.privacyJournal) {
      const journal = join(scratch, "latest.privacy.enc");
      await args.store.get(latest.manifest.privacyJournal.artifact, journal);
      if (await sha256File(journal) !== latest.manifest.privacyJournal.encryptedSha256)
        throw new Error("BACKUP_RETENTION_REMOTE_PRIVACY_JOURNAL_INVALID");
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }

  const deleted: string[] = [];
  let freedBytes = 0;
  for (const candidate of selected) {
    // Re-read current pointer and file identities immediately before removal;
    // never prune a newly selected latest copy or a replaced filesystem entry.
    const current = await verified("latest-verified.json");
    if (current.manifest.artifact === candidate.manifest.artifact) { skipped += 1; continue; }
    const checked = await verified(`${candidate.manifest.artifact}.json`);
    if (checked.artifactStat.ino !== candidate.artifactStat.ino || checked.artifactStat.dev !== candidate.artifactStat.dev ||
      checked.manifestStat.ino !== candidate.manifestStat.ino || checked.manifestStat.dev !== candidate.manifestStat.dev)
      throw new Error("BACKUP_RETENTION_FILE_CHANGED");
    if (args.dryRun) continue;
    await unlink(checked.artifactPath);
    if (checked.privacyJournalPath) await unlink(checked.privacyJournalPath);
    await unlink(checked.manifestPath);
    deleted.push(checked.manifest.artifact);
    freedBytes += checked.artifactStat.size+checked.manifestStat.size+(checked.privacyJournalStat?.size ?? 0);
  }
  return { deleted, wouldDelete: selected.map((item) => item.manifest.artifact), preserved: [...preserved], skipped, freedBytes };
}

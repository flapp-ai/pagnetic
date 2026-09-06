import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createPrivacyReceiptStore } from "../app/services/privacy-receipt-store.server";
import { collectPrivacyReceiptInventory, receiptEncryptionKeys } from "../app/services/privacy-receipt.server";
import { assertRecoveryHoldPresent, replayPrivacyInventory } from "../app/services/privacy-recovery.server";
import { recoveryBackupKeyById, recordRecoveryReplayEvidence } from "../app/services/recovery-reopening.server";
import { verifyManifest, type BackupManifest } from "./lib/sqlite-backup";

const database = process.argv[2];
const manifestPath = process.argv[3];
if (!database?.startsWith("/") || !manifestPath?.startsWith("/")) {
  console.error("Usage: replay-privacy-receipts.ts /absolute/QUARANTINED-database.sqlite /absolute/verified-manifest.json");
  process.exit(2);
}
process.env.DATABASE_URL = `file:${database}`;
const db = new PrismaClient({ datasourceUrl: `file:${database}` });
try {
  await assertRecoveryHoldPresent(db);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
  const integrityKey = recoveryBackupKeyById(manifest.encryption?.keyId, process.env);
  verifyManifest(manifest, integrityKey);
  const manifestSha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const hold = await db.recoveryHold.findUnique({ where: { id: "1" } });
  if (!hold || hold.state === "RELEASED" || hold.sourceManifestSha256 !== manifestSha256 || hold.sourceArtifact !== manifest.artifact || hold.sourceArtifactSha256 !== manifest.encryptedSha256)
    throw new Error("RECOVERY_SOURCE_IDENTITY_MISMATCH");
  const keys = receiptEncryptionKeys(process.env);
  const store = createPrivacyReceiptStore(process.env);
  // Two complete inventories are required. A changing object set means writers
  // are not quiesced and release/replay completeness cannot be established.
  const before = await collectPrivacyReceiptInventory(store, keys);
  const replayStartedAt = new Date();
  const replay = await replayPrivacyInventory({ db, receipts: before.receipts, names: before.names, afterNames: before.names });
  const replayFinishedAt = new Date();
  const after = await collectPrivacyReceiptInventory(store, keys);
  const { results, unresolved } = replay;
  const evidence = await recordRecoveryReplayEvidence({ db, before, after, sourceManifestSha256: manifestSha256,
    sourceArtifact: manifest.artifact, sourceArtifactSha256: manifest.encryptedSha256, restoredDbSha256: hold.restoredDbSha256 ?? "",
    schemaSha256: hold.schemaSha256 ?? manifest.schemaSha256, retainedKeyFingerprints: keys.map((key) => createHash("sha256").update(key).digest("hex")).sort().join(","),
    replayStartedAt, replayFinishedAt, unresolvedCount: unresolved.length, integrityKey });
  console.log(JSON.stringify({ inventoryCount: before.receipts.length, replayed: results.length, unresolved: unresolved.length,
    evidenceId: evidence.id, holdRetained: true, results: results.map(({ name, ok, action }) => ({ name, ok, action })) }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Privacy receipt replay failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { createPrivacyReceiptStore } from "../app/services/privacy-receipt-store.server";
import { collectPrivacyReceiptInventory, receiptEncryptionKeys } from "../app/services/privacy-receipt.server";
import { recoveryBackupKeyById, receiptInventoryDigest } from "../app/services/recovery-reopening.server";
import { releaseRecoveryHold } from "../app/services/recovery-release.server";
import { verifyManifest, type BackupManifest } from "./lib/sqlite-backup";

const [database, manifestPath, evidenceId, operatorIdentity, privacyReviewReference, backupReviewReference,
  legacyInventoryReference, receiptQuiescenceReference] = process.argv.slice(2);
if (![database, manifestPath, evidenceId, operatorIdentity, privacyReviewReference, backupReviewReference,
  legacyInventoryReference, receiptQuiescenceReference].every((value) => value?.startsWith("/") || (value && !value.includes("\0")))) {
  console.error("Usage: release-recovery-hold.ts /absolute/QUARANTINED.sqlite /absolute/manifest.json evidence-id operator privacy-ref backup-ref legacy-ref receipt-quiescence-ref");
  process.exit(2);
}
if (!database.startsWith("/") || !manifestPath.startsWith("/")) process.exit(2);
process.env.DATABASE_URL = `file:${database}`;
const db = new PrismaClient({ datasourceUrl: `file:${database}` });

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
  const key = recoveryBackupKeyById(manifest.encryption?.keyId, process.env);
  verifyManifest(manifest, key);
  const manifestSha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const keys = receiptEncryptionKeys(process.env);
  const store = createPrivacyReceiptStore(process.env);
  const inventory = await collectPrivacyReceiptInventory(store, keys);
  const inventoryAgain = await collectPrivacyReceiptInventory(store, keys);
  if (receiptInventoryDigest(inventory) !== receiptInventoryDigest(inventoryAgain) || JSON.stringify(inventory.names) !== JSON.stringify(inventoryAgain.names))
    throw new Error("PRIVACY_RECEIPT_INVENTORY_CHANGED");
  const released = await releaseRecoveryHold({ db, key, evidenceId, sourceManifestSha256: manifestSha256,
    sourceArtifact: manifest.artifact, sourceArtifactSha256: manifest.encryptedSha256, receiptInventoryDigest: receiptInventoryDigest(inventory),
    retainedKeyFingerprints: keys.map((candidate) => createHash("sha256").update(candidate).digest("hex")).sort().join(","),
    operatorIdentity, privacyReviewReference, backupReviewReference, legacyInventoryReference, receiptQuiescenceReference });
  console.log(JSON.stringify({ released: true, holdRetained: true, ...released, servingOrCutover: false }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Recovery release failed");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

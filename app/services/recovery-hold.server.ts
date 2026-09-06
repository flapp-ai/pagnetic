import type { PrismaClient } from "@prisma/client";
import { canonicalRecoveryEvidence, evidenceHash, recoveryBackupKeys, verifyRecoveryHoldIntegrity,
  verifyRecoveryMetadataTag } from "./recovery-reopening.server";

// Written into restored SQLite files themselves, so copying/renaming the file
// cannot discard the hold. Only offline recovery code can resolve it.
export const RECOVERY_HOLD_TABLE = "_PagneticRecoveryHold";
const REQUIRED_COLUMNS = [
  "id", "state", "reason", "sourceManifestSha256", "sourceArtifact",
  "sourceArtifactSha256", "restoredDbSha256", "schemaSha256", "replayEvidenceId",
  "integrityTag", "createdAt", "updatedAt",
];

type HoldDb = Pick<PrismaClient, "$queryRawUnsafe">;

async function holdColumns(db: HoldDb) {
  const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='_PagneticRecoveryHold'",
  );
  if (!tables.length) return null;
  return db.$queryRawUnsafe<Array<{ name: string; type: string; notnull: number }>>(
    "PRAGMA table_info(\"_PagneticRecoveryHold\")",
  );
}

export async function recoveryHoldShape(db: HoldDb) {
  const columns = await holdColumns(db);
  if (!columns) return "missing" as const;
  const names = columns.map((column) => column.name);
  if (names.length === 2 && names.includes("id") && names.includes("reason")) return "legacy" as const;
  if (!REQUIRED_COLUMNS.every((name) => names.includes(name))) return "malformed" as const;
  return "current" as const;
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED");
  return date.toISOString();
}

export async function assertRecoveryHoldClear(db: HoldDb, databaseUrl: string | undefined,
  environment: Record<string, string | undefined> = process.env) {
  if (!databaseUrl?.startsWith("file:")) return;
  const shape = await recoveryHoldShape(db);
  if (shape === "missing") return;
  if (shape === "legacy") throw new Error("RECOVERY_PRIVACY_REPLAY_REQUIRED:RECOVERY_HOLD_SCHEMA_UNSUPPORTED");
  if (shape === "malformed") throw new Error("RECOVERY_HOLD_SCHEMA_MALFORMED");
  const rows = await db.$queryRawUnsafe<Array<{ id: string; state: string; reason: string; sourceManifestSha256: string | null;
    sourceArtifact: string | null; sourceArtifactSha256: string | null; restoredDbSha256: string | null; schemaSha256: string | null;
    replayEvidenceId: string | null; integrityTag: string }>>(
    "SELECT id, state, reason, sourceManifestSha256, sourceArtifact, sourceArtifactSha256, restoredDbSha256, schemaSha256, replayEvidenceId, integrityTag FROM \"_PagneticRecoveryHold\" ORDER BY id",
  );
  if (!rows.length) return;
  if (rows.length !== 1 || rows[0].id !== "1") throw new Error("RECOVERY_HOLD_STATE_INVALID");
  if (!["RELEASED", "HELD", "READY"].includes(rows[0].state)) throw new Error("RECOVERY_HOLD_STATE_INVALID");
  if (rows[0].state !== "RELEASED") throw new Error("RECOVERY_PRIVACY_REPLAY_REQUIRED");
  if (!rows[0].replayEvidenceId || !rows[0].integrityTag) throw new Error("RECOVERY_RELEASE_AUDIT_REQUIRED");
  const verifyWithKey = async (key: Buffer) => {
    if (!verifyRecoveryHoldIntegrity(key, rows[0])) throw new Error("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED");
    const audits = await db.$queryRawUnsafe<Array<{ id: string; holdId: string; evidenceId: string; sourceManifestSha256: string; sourceArtifactSha256: string; restoredDbSha256: string; schemaSha256: string; receiptInventoryDigest: string; evidenceHash: string; operatorIdentity: string; privacyReviewReference: string; backupReviewReference: string; legacyInventoryReference: string; receiptQuiescenceReference: string; releasedAt: Date | string; integrityTag: string }>>(
      "SELECT id, holdId, evidenceId, sourceManifestSha256, sourceArtifactSha256, restoredDbSha256, schemaSha256, receiptInventoryDigest, evidenceHash, operatorIdentity, privacyReviewReference, backupReviewReference, legacyInventoryReference, receiptQuiescenceReference, releasedAt, integrityTag FROM \"RecoveryReleaseAudit\" WHERE holdId = '1' AND evidenceId = ?",
      rows[0].replayEvidenceId,
    );
    const evidenceRows = await db.$queryRawUnsafe<Array<{ id: string; holdId: string; evidenceVersion: number; sourceManifestSha256: string;
      sourceArtifact: string; sourceArtifactSha256: string; restoredDbSha256: string; schemaSha256: string; receiptInventoryDigest: string;
      receiptInventoryStarted: Date | string; receiptInventoryFinished: Date | string; retainedKeyFingerprints: string;
      replayStartedAt: Date | string; replayFinishedAt: Date | string; receiptCount: number; unresolvedCount: number;
      erasureDigest: string; postReplayDbSha256: string; generatedAt: Date | string; integrityTag: string }>>(
      "SELECT * FROM \"RecoveryReplayEvidence\" WHERE id = ? AND holdId = '1'",
      rows[0].replayEvidenceId,
    );
    if (audits.length !== 1 || evidenceRows.length !== 1) throw new Error("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED");
    const audit = audits[0];
    const evidence = evidenceRows[0];
    const canonical = canonicalRecoveryEvidence({ sourceManifestSha256: evidence.sourceManifestSha256,
      sourceArtifact: evidence.sourceArtifact, sourceArtifactSha256: evidence.sourceArtifactSha256,
      restoredDbSha256: evidence.restoredDbSha256, schemaSha256: evidence.schemaSha256,
      receiptInventoryDigest: evidence.receiptInventoryDigest, receiptInventoryStarted: iso(evidence.receiptInventoryStarted),
      receiptInventoryFinished: iso(evidence.receiptInventoryFinished), retainedKeyFingerprints: evidence.retainedKeyFingerprints,
      replayStartedAt: iso(evidence.replayStartedAt), replayFinishedAt: iso(evidence.replayFinishedAt),
      receiptCount: evidence.receiptCount, unresolvedCount: evidence.unresolvedCount, erasureDigest: evidence.erasureDigest,
      postReplayDbSha256: evidence.postReplayDbSha256, generatedAt: iso(evidence.generatedAt) });
    const hash = evidenceHash(canonical);
    if (evidence.evidenceVersion !== 1 || evidence.unresolvedCount !== 0 ||
      !verifyRecoveryMetadataTag(key, "evidence", { ...canonical, evidenceHash: hash }, evidence.integrityTag) ||
      audit.evidenceHash !== hash || audit.evidenceId !== evidence.id || audit.holdId !== evidence.holdId ||
      rows[0].sourceManifestSha256 !== evidence.sourceManifestSha256 || rows[0].sourceArtifact !== evidence.sourceArtifact ||
      rows[0].sourceArtifactSha256 !== evidence.sourceArtifactSha256 || rows[0].restoredDbSha256 !== evidence.restoredDbSha256 ||
      rows[0].schemaSha256 !== evidence.schemaSha256 || audit.sourceManifestSha256 !== evidence.sourceManifestSha256 ||
      audit.sourceArtifactSha256 !== evidence.sourceArtifactSha256 || audit.restoredDbSha256 !== evidence.restoredDbSha256 ||
      audit.schemaSha256 !== evidence.schemaSha256 || audit.receiptInventoryDigest !== evidence.receiptInventoryDigest)
      throw new Error("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED");
    if (!verifyRecoveryMetadataTag(key, "release", { id: audit.id, holdId: "1", evidenceId: audit.evidenceId,
      sourceManifestSha256: audit.sourceManifestSha256, sourceArtifactSha256: audit.sourceArtifactSha256, restoredDbSha256: audit.restoredDbSha256,
      schemaSha256: audit.schemaSha256, receiptInventoryDigest: audit.receiptInventoryDigest, evidenceHash: audit.evidenceHash,
      operatorIdentity: audit.operatorIdentity, privacyReviewReference: audit.privacyReviewReference, backupReviewReference: audit.backupReviewReference,
      legacyInventoryReference: audit.legacyInventoryReference, receiptQuiescenceReference: audit.receiptQuiescenceReference, releasedAt: iso(audit.releasedAt) }, audit.integrityTag))
      throw new Error("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED");
  };
  let keys: Buffer[];
  try { keys = recoveryBackupKeys(environment); }
  catch { throw new Error("RECOVERY_RELEASE_AUDIT_REQUIRED"); }
  for (const key of keys) {
    try { await verifyWithKey(key); return; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED"))
        throw new Error("RECOVERY_RELEASE_AUDIT_REQUIRED");
    }
  }
  throw new Error("RECOVERY_RELEASE_AUDIT_AUTHENTICATION_FAILED");
}

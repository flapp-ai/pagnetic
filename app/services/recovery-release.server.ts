import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { canonicalRecoveryEvidence, canonicalRecoveryHoldMetadata, evidenceHash, protectedDatabaseFingerprint, protectedSchemaFingerprint,
  recoveryHoldIntegrityTag, recoveryMetadataTag, verifyRecoveryHoldIntegrity, verifyRecoveryMetadataTag, assertFreshTimestamp,
  verifyErasureGraph } from "./recovery-reopening.server";

function boundedReference(value: string, code: string) {
  if (!value || value.length > 500 || value.includes("\0")) throw new Error(code);
  return value;
}

function assertSha256(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("RECOVERY_SOURCE_IDENTITY_INVALID");
}

export async function releaseRecoveryHold(input: {
  db: PrismaClient; key: Buffer; evidenceId: string; sourceManifestSha256: string; sourceArtifact: string;
  sourceArtifactSha256: string; receiptInventoryDigest: string; operatorIdentity: string;
  privacyReviewReference: string; backupReviewReference: string; legacyInventoryReference: string;
  receiptQuiescenceReference: string; retainedKeyFingerprints: string;
  environment?: Record<string, string | undefined>; now?: Date;
}) {
  const now = input.now ?? new Date();
  assertSha256(input.sourceManifestSha256);
  assertSha256(input.sourceArtifactSha256);
  assertSha256(input.receiptInventoryDigest);
  const references = {
    operatorIdentity: boundedReference(input.operatorIdentity, "RECOVERY_OPERATOR_IDENTITY_REQUIRED"),
    privacyReviewReference: boundedReference(input.privacyReviewReference, "RECOVERY_PRIVACY_REVIEW_REQUIRED"),
    backupReviewReference: boundedReference(input.backupReviewReference, "RECOVERY_BACKUP_REVIEW_REQUIRED"),
    legacyInventoryReference: boundedReference(input.legacyInventoryReference, "RECOVERY_LEGACY_REVIEW_REQUIRED"),
    receiptQuiescenceReference: boundedReference(input.receiptQuiescenceReference, "RECOVERY_RECEIPT_QUIESCENCE_REQUIRED"),
  };
  return input.db.$transaction(async (tx) => {
    // This conditional update acquires the database row lock before any verification.
    const lock = await tx.recoveryHold.updateMany({ where: { id: "1", state: "READY" }, data: { state: "READY" } });
    if (lock.count !== 1) throw new Error("RECOVERY_RELEASE_CONCURRENT_OR_NOT_READY");
    const hold = await tx.recoveryHold.findUnique({ where: { id: "1" } });
    const evidence = await tx.recoveryReplayEvidence.findUnique({ where: { id: input.evidenceId } });
    if (!hold || !evidence || hold.replayEvidenceId !== evidence.id || evidence.holdId !== hold.id) throw new Error("RECOVERY_EVIDENCE_NOT_CURRENT");
    if (!verifyRecoveryHoldIntegrity(input.key, hold)) throw new Error("RECOVERY_HOLD_AUTHENTICATION_FAILED");
    if (hold.sourceManifestSha256 !== input.sourceManifestSha256 || evidence.sourceManifestSha256 !== input.sourceManifestSha256 || evidence.sourceArtifact !== input.sourceArtifact || evidence.sourceArtifactSha256 !== input.sourceArtifactSha256)
      throw new Error("RECOVERY_SOURCE_IDENTITY_MISMATCH");
    if (hold.sourceArtifact !== evidence.sourceArtifact || hold.sourceArtifactSha256 !== evidence.sourceArtifactSha256 ||
      hold.restoredDbSha256 !== evidence.restoredDbSha256 || hold.schemaSha256 !== evidence.schemaSha256)
      throw new Error("RECOVERY_SOURCE_IDENTITY_MISMATCH");
    const canonical = canonicalRecoveryEvidence({ sourceManifestSha256: evidence.sourceManifestSha256, sourceArtifact: evidence.sourceArtifact,
      sourceArtifactSha256: evidence.sourceArtifactSha256, restoredDbSha256: evidence.restoredDbSha256, schemaSha256: evidence.schemaSha256,
      receiptInventoryDigest: evidence.receiptInventoryDigest, receiptInventoryStarted: evidence.receiptInventoryStarted.toISOString(),
      receiptInventoryFinished: evidence.receiptInventoryFinished.toISOString(), retainedKeyFingerprints: evidence.retainedKeyFingerprints,
      replayStartedAt: evidence.replayStartedAt.toISOString(), replayFinishedAt: evidence.replayFinishedAt.toISOString(),
      receiptCount: evidence.receiptCount, unresolvedCount: evidence.unresolvedCount, erasureDigest: evidence.erasureDigest,
      postReplayDbSha256: evidence.postReplayDbSha256, generatedAt: evidence.generatedAt.toISOString() });
    const hash = evidenceHash(canonical);
    if (!verifyRecoveryMetadataTag(input.key, "evidence", { ...canonical, evidenceHash: hash }, evidence.integrityTag)) throw new Error("RECOVERY_EVIDENCE_AUTHENTICATION_FAILED");
    for (const timestamp of [evidence.receiptInventoryStarted, evidence.receiptInventoryFinished, evidence.replayStartedAt, evidence.replayFinishedAt, evidence.generatedAt]) assertFreshTimestamp(timestamp, now);
    if (evidence.receiptInventoryStarted > evidence.receiptInventoryFinished || evidence.replayStartedAt > evidence.replayFinishedAt ||
      evidence.replayFinishedAt > evidence.generatedAt) throw new Error("RECOVERY_EVIDENCE_TIMELINE_INVALID");
    if (evidence.unresolvedCount !== 0 || evidence.receiptInventoryDigest !== input.receiptInventoryDigest ||
      evidence.retainedKeyFingerprints !== input.retainedKeyFingerprints) throw new Error("RECOVERY_EVIDENCE_STALE_OR_CHANGED");
    if (await protectedDatabaseFingerprint(tx) !== evidence.postReplayDbSha256) throw new Error("RECOVERY_DATABASE_CHANGED");
    if (await protectedSchemaFingerprint(tx) !== evidence.schemaSha256) throw new Error("RECOVERY_SCHEMA_CHANGED");
    if (await verifyErasureGraph(tx, input.environment ?? process.env) !== evidence.erasureDigest) throw new Error("RECOVERY_ERASURE_GRAPH_CHANGED");
    const auditId = randomUUID();
    const fields = { id: auditId, holdId: hold.id, evidenceId: evidence.id, sourceManifestSha256: evidence.sourceManifestSha256,
      sourceArtifactSha256: evidence.sourceArtifactSha256, restoredDbSha256: evidence.restoredDbSha256, schemaSha256: evidence.schemaSha256,
      receiptInventoryDigest: evidence.receiptInventoryDigest, evidenceHash: hash, ...references,
      releasedAt: now.toISOString() };
    const integrityTag = recoveryMetadataTag(input.key, "release", fields);
    await tx.recoveryReleaseAudit.create({ data: { ...fields, releasedAt: now, integrityTag } });
    const released = canonicalRecoveryHoldMetadata({ ...hold, state: "RELEASED", reason: "TECHNICAL_REOPENING_AUDITED" });
    await tx.recoveryHold.update({ where: { id: hold.id }, data: { ...released, integrityTag: recoveryHoldIntegrityTag(input.key, released) } });
    return { auditId, evidenceHash: hash };
  });
}

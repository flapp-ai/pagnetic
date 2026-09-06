CREATE TABLE IF NOT EXISTS "_PagneticRecoveryHold" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT '1',
    "state" TEXT NOT NULL DEFAULT 'HELD',
    "reason" TEXT NOT NULL DEFAULT 'NONE',
    "sourceManifestSha256" TEXT,
    "sourceArtifact" TEXT,
    "sourceArtifactSha256" TEXT,
    "restoredDbSha256" TEXT,
    "schemaSha256" TEXT,
    "replayEvidenceId" TEXT,
    "integrityTag" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "RecoveryReplayEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "holdId" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceManifestSha256" TEXT NOT NULL,
    "sourceArtifact" TEXT NOT NULL,
    "sourceArtifactSha256" TEXT NOT NULL,
    "restoredDbSha256" TEXT NOT NULL,
    "schemaSha256" TEXT NOT NULL,
    "receiptInventoryDigest" TEXT NOT NULL,
    "receiptInventoryStarted" DATETIME NOT NULL,
    "receiptInventoryFinished" DATETIME NOT NULL,
    "retainedKeyFingerprints" TEXT NOT NULL,
    "replayStartedAt" DATETIME NOT NULL,
    "replayFinishedAt" DATETIME NOT NULL,
    "receiptCount" INTEGER NOT NULL,
    "unresolvedCount" INTEGER NOT NULL,
    "erasureDigest" TEXT NOT NULL,
    "postReplayDbSha256" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "integrityTag" TEXT NOT NULL,
    CONSTRAINT "RecoveryReplayEvidence_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "_PagneticRecoveryHold" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RecoveryReplayEvidence_sourceManifestSha256_generatedAt_idx" ON "RecoveryReplayEvidence"("sourceManifestSha256", "generatedAt");

CREATE TABLE IF NOT EXISTS "RecoveryReleaseAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "holdId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "sourceManifestSha256" TEXT NOT NULL,
    "sourceArtifactSha256" TEXT NOT NULL,
    "restoredDbSha256" TEXT NOT NULL,
    "schemaSha256" TEXT NOT NULL,
    "receiptInventoryDigest" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "operatorIdentity" TEXT NOT NULL,
    "privacyReviewReference" TEXT NOT NULL,
    "backupReviewReference" TEXT NOT NULL,
    "legacyInventoryReference" TEXT NOT NULL,
    "receiptQuiescenceReference" TEXT NOT NULL,
    "releasedAt" DATETIME NOT NULL,
    "integrityTag" TEXT NOT NULL,
    CONSTRAINT "RecoveryReleaseAudit_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "_PagneticRecoveryHold" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecoveryReleaseAudit_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "RecoveryReplayEvidence" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryReleaseAudit_evidenceId_key" ON "RecoveryReleaseAudit"("evidenceId");
CREATE INDEX IF NOT EXISTS "RecoveryReleaseAudit_sourceManifestSha256_releasedAt_idx" ON "RecoveryReleaseAudit"("sourceManifestSha256", "releasedAt");

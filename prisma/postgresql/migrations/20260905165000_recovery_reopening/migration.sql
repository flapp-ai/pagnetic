-- CreateTable
CREATE TABLE "_PagneticRecoveryHold" (
    "id" TEXT NOT NULL DEFAULT '1',
    "state" TEXT NOT NULL DEFAULT 'HELD',
    "reason" TEXT NOT NULL DEFAULT 'NONE',
    "sourceManifestSha256" TEXT,
    "sourceArtifact" TEXT,
    "sourceArtifactSha256" TEXT,
    "restoredDbSha256" TEXT,
    "schemaSha256" TEXT,
    "replayEvidenceId" TEXT,
    "integrityTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "_PagneticRecoveryHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryReplayEvidence" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "evidenceVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceManifestSha256" TEXT NOT NULL,
    "sourceArtifact" TEXT NOT NULL,
    "sourceArtifactSha256" TEXT NOT NULL,
    "restoredDbSha256" TEXT NOT NULL,
    "schemaSha256" TEXT NOT NULL,
    "receiptInventoryDigest" TEXT NOT NULL,
    "receiptInventoryStarted" TIMESTAMP(3) NOT NULL,
    "receiptInventoryFinished" TIMESTAMP(3) NOT NULL,
    "retainedKeyFingerprints" TEXT NOT NULL,
    "replayStartedAt" TIMESTAMP(3) NOT NULL,
    "replayFinishedAt" TIMESTAMP(3) NOT NULL,
    "receiptCount" INTEGER NOT NULL,
    "unresolvedCount" INTEGER NOT NULL,
    "erasureDigest" TEXT NOT NULL,
    "postReplayDbSha256" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "integrityTag" TEXT NOT NULL,

    CONSTRAINT "RecoveryReplayEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryReleaseAudit" (
    "id" TEXT NOT NULL,
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
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "integrityTag" TEXT NOT NULL,

    CONSTRAINT "RecoveryReleaseAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryReplayEvidence_sourceManifestSha256_generatedAt_idx" ON "RecoveryReplayEvidence"("sourceManifestSha256", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryReleaseAudit_evidenceId_key" ON "RecoveryReleaseAudit"("evidenceId");

-- CreateIndex
CREATE INDEX "RecoveryReleaseAudit_sourceManifestSha256_releasedAt_idx" ON "RecoveryReleaseAudit"("sourceManifestSha256", "releasedAt");

-- AddForeignKey
ALTER TABLE "RecoveryReplayEvidence" ADD CONSTRAINT "RecoveryReplayEvidence_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "_PagneticRecoveryHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryReleaseAudit" ADD CONSTRAINT "RecoveryReleaseAudit_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "_PagneticRecoveryHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

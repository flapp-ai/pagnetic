ALTER TABLE "BetaEntitlement" ADD COLUMN "lastResultSnapshotId" TEXT;
ALTER TABLE "BetaEntitlement" ADD COLUMN "lastResultState" TEXT;
ALTER TABLE "BetaEntitlement" ADD COLUMN "freeExtensionUntil" DATETIME;
ALTER TABLE "BetaEntitlement" ADD COLUMN "revisedExperimentsRemaining" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BetaEntitlement" ADD COLUMN "offerPriceUsd" INTEGER NOT NULL DEFAULT 49;

CREATE TABLE "ProductCandidateScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "lookbackStart" DATETIME,
    "lookbackEnd" DATETIME,
    "inputAvailabilityJson" TEXT NOT NULL,
    "componentScoresJson" TEXT NOT NULL,
    "exclusionsJson" TEXT NOT NULL DEFAULT '[]',
    "explanationJson" TEXT NOT NULL DEFAULT '[]',
    "totalScore" REAL NOT NULL,
    "qualificationBand" TEXT NOT NULL,
    "durationBand" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCandidateScore_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductCandidateScore_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProductCandidateScore_merchantId_createdAt_idx" ON "ProductCandidateScore"("merchantId", "createdAt");
CREATE INDEX "ProductCandidateScore_merchantId_qualificationBand_totalScore_idx" ON "ProductCandidateScore"("merchantId", "qualificationBand", "totalScore");
CREATE INDEX "ProductCandidateScore_productId_createdAt_idx" ON "ProductCandidateScore"("productId", "createdAt");

CREATE TABLE "AutopilotPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "candidateScoreId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARING',
    "planHash" TEXT NOT NULL,
    "candidateScoreSnapshotJson" TEXT NOT NULL,
    "contentVersionIdsJson" TEXT NOT NULL,
    "contentHashesJson" TEXT NOT NULL,
    "evidenceSnapshotHash" TEXT NOT NULL,
    "mappingVersionsJson" TEXT NOT NULL DEFAULT '[]',
    "unknownTrafficPolicy" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "aaProtocolJson" TEXT NOT NULL,
    "realExperimentProtocolJson" TEXT NOT NULL,
    "safetyPolicyVersion" TEXT NOT NULL,
    "authorizedTransitionsJson" TEXT NOT NULL,
    "approvalRecordJson" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "mediumRiskAcknowledgedAt" DATETIME,
    "aaExperimentId" TEXT,
    "realExperimentId" TEXT,
    "resultSnapshotId" TEXT,
    "lockToken" TEXT,
    "lockExpiresAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutopilotPlan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutopilotPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutopilotPlan_candidateScoreId_fkey" FOREIGN KEY ("candidateScoreId") REFERENCES "ProductCandidateScore" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutopilotPlan_planHash_key" ON "AutopilotPlan"("planHash");
CREATE UNIQUE INDEX "AutopilotPlan_merchantId_productId_version_key" ON "AutopilotPlan"("merchantId", "productId", "version");
CREATE INDEX "AutopilotPlan_merchantId_state_updatedAt_idx" ON "AutopilotPlan"("merchantId", "state", "updatedAt");
CREATE INDEX "AutopilotPlan_aaExperimentId_idx" ON "AutopilotPlan"("aaExperimentId");
CREATE INDEX "AutopilotPlan_realExperimentId_idx" ON "AutopilotPlan"("realExperimentId");

CREATE TABLE "AutopilotTransition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "gateSnapshotHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutopilotTransition_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutopilotTransition_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutopilotPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutopilotTransition_idempotencyKey_key" ON "AutopilotTransition"("idempotencyKey");
CREATE INDEX "AutopilotTransition_planId_occurredAt_idx" ON "AutopilotTransition"("planId", "occurredAt");
CREATE INDEX "AutopilotTransition_merchantId_occurredAt_idx" ON "AutopilotTransition"("merchantId", "occurredAt");

CREATE TABLE "MerchantNotice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "planId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actionLabel" TEXT,
    "actionHref" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "MerchantNotice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MerchantNotice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutopilotPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MerchantNotice_merchantId_dedupeKey_key" ON "MerchantNotice"("merchantId", "dedupeKey");
CREATE INDEX "MerchantNotice_merchantId_status_createdAt_idx" ON "MerchantNotice"("merchantId", "status", "createdAt");
CREATE INDEX "MerchantNotice_planId_status_idx" ON "MerchantNotice"("planId", "status");

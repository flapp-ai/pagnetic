-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceSnapshot" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceDocument_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourceDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "verbatimText" TEXT NOT NULL,
    "productScope" TEXT NOT NULL,
    "variantScope" TEXT,
    "marketScope" TEXT NOT NULL DEFAULT 'ALL',
    "localeScope" TEXT NOT NULL DEFAULT 'en',
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "requiredQualifiersJson" TEXT NOT NULL DEFAULT '[]',
    "substantiationReference" TEXT,
    "merchantStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "sourceHash" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceObject_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvidenceObject_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvidenceObject_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcquisitionAngle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AcquisitionAngle_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "angleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "utmContent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "fallback" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignMapping_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignMapping_angleId_fkey" FOREIGN KEY ("angleId") REFERENCES "AcquisitionAngle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExperienceVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "angleId" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "headline" TEXT NOT NULL,
    "supportingLine" TEXT,
    "benefitsJson" TEXT NOT NULL,
    "proofItemsJson" TEXT NOT NULL DEFAULT '[]',
    "reassurance" TEXT,
    "contentHash" TEXT NOT NULL,
    "sourceSnapshotHash" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "provider" TEXT,
    "modelId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "rawOutputJson" TEXT NOT NULL,
    "validationFindingsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "staleAt" DATETIME,
    CONSTRAINT "ExperienceVersion_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperienceVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExperienceVersion_angleId_fkey" FOREIGN KEY ("angleId") REFERENCES "AcquisitionAngle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experienceVersionId" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "transformationType" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "requiredQualifiersJson" TEXT NOT NULL DEFAULT '[]',
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "validationFindingsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Claim_experienceVersionId_fkey" FOREIGN KEY ("experienceVersionId") REFERENCES "ExperienceVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "claimId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,

    PRIMARY KEY ("claimId", "evidenceId"),
    CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClaimEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceObject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experienceVersionId" TEXT NOT NULL,
    "approver" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "evidenceSnapshotHash" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    CONSTRAINT "Approval_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_experienceVersionId_fkey" FOREIGN KEY ("experienceVersionId") REFERENCES "ExperienceVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_shop_key" ON "Merchant"("shop");

-- CreateIndex
CREATE INDEX "Product_merchantId_status_idx" ON "Product"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchantId_shopifyProductId_key" ON "Product"("merchantId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "SourceDocument_merchantId_productId_idx" ON "SourceDocument"("merchantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_merchantId_sourceId_sourceVersion_key" ON "SourceDocument"("merchantId", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "EvidenceObject_merchantId_productId_merchantStatus_idx" ON "EvidenceObject"("merchantId", "productId", "merchantStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceObject_merchantId_sourceId_sourceVersion_key" ON "EvidenceObject"("merchantId", "sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionAngle_merchantId_key_key" ON "AcquisitionAngle"("merchantId", "key");

-- CreateIndex
CREATE INDEX "CampaignMapping_merchantId_signature_status_idx" ON "CampaignMapping"("merchantId", "signature", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMapping_merchantId_signature_version_key" ON "CampaignMapping"("merchantId", "signature", "version");

-- CreateIndex
CREATE INDEX "ExperienceVersion_merchantId_status_idx" ON "ExperienceVersion"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExperienceVersion_productId_angleId_version_key" ON "ExperienceVersion"("productId", "angleId", "version");

-- CreateIndex
CREATE INDEX "Claim_experienceVersionId_idx" ON "Claim"("experienceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_experienceVersionId_key" ON "Approval"("experienceVersionId");

-- CreateIndex
CREATE INDEX "Approval_merchantId_approvedAt_idx" ON "Approval"("merchantId", "approvedAt");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");

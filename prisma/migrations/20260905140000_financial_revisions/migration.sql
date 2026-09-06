ALTER TABLE "Experiment" ADD COLUMN "finalResultSnapshotId" TEXT;

CREATE TABLE "FinancialOrderRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "shopifyOrderId" TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "firstObservedAt" DATETIME NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "revisionHash" TEXT NOT NULL,
  "canonicalPayload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialOrderRevision_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinancialOrderRevision_merchantId_shopifyOrderId_revisionHash_key" ON "FinancialOrderRevision"("merchantId", "shopifyOrderId", "revisionHash");
CREATE INDEX "FinancialOrderRevision_merchantId_shopifyOrderId_sourceUpdatedAt_idx" ON "FinancialOrderRevision"("merchantId", "shopifyOrderId", "sourceUpdatedAt");

CREATE TABLE "FinancialRevisionLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "revisionId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "shopifyLineId" TEXT NOT NULL,
  "signedRefHash" TEXT NOT NULL,
  CONSTRAINT "FinancialRevisionLink_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "FinancialOrderRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinancialRevisionLink_revisionId_shopifyLineId_key" ON "FinancialRevisionLink"("revisionId", "shopifyLineId");
CREATE INDEX "FinancialRevisionLink_merchantId_experimentId_assignmentId_idx" ON "FinancialRevisionLink"("merchantId", "experimentId", "assignmentId");

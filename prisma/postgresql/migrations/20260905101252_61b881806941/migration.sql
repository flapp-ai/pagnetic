-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "finalResultSnapshotId" TEXT;

-- CreateTable
CREATE TABLE "FinancialOrderRevision" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "firstObservedAt" TIMESTAMP(3) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "revisionHash" TEXT NOT NULL,
    "canonicalPayload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialOrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialRevisionLink" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "shopifyLineId" TEXT NOT NULL,
    "signedRefHash" TEXT NOT NULL,

    CONSTRAINT "FinancialRevisionLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialOrderRevision_merchantId_shopifyOrderId_sourceUpda_idx" ON "FinancialOrderRevision"("merchantId", "shopifyOrderId", "sourceUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialOrderRevision_merchantId_shopifyOrderId_revisionHa_key" ON "FinancialOrderRevision"("merchantId", "shopifyOrderId", "revisionHash");

-- CreateIndex
CREATE INDEX "FinancialRevisionLink_merchantId_experimentId_assignmentId_idx" ON "FinancialRevisionLink"("merchantId", "experimentId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialRevisionLink_revisionId_shopifyLineId_key" ON "FinancialRevisionLink"("revisionId", "shopifyLineId");

-- AddForeignKey
ALTER TABLE "FinancialOrderRevision" ADD CONSTRAINT "FinancialOrderRevision_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialRevisionLink" ADD CONSTRAINT "FinancialRevisionLink_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "FinancialOrderRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

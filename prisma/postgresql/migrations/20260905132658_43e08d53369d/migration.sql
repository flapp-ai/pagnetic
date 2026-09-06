-- AlterTable
ALTER TABLE "PrivacyRequest" ADD COLUMN     "lookupKeyId" TEXT;

-- AlterTable
ALTER TABLE "PrivacyOrderSuppression" ADD COLUMN     "lookupKeyId" TEXT;

-- CreateIndex
CREATE INDEX "PrivacyRequest_lookupKeyId_idx" ON "PrivacyRequest"("lookupKeyId");

-- CreateIndex
CREATE INDEX "PrivacyOrderSuppression_lookupKeyId_idx" ON "PrivacyOrderSuppression"("lookupKeyId");

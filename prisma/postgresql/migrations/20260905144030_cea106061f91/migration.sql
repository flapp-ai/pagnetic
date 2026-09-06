-- AlterTable
ALTER TABLE "PrivacyRequest" ADD COLUMN     "scopeKeyId" TEXT;

-- CreateIndex
CREATE INDEX "PrivacyRequest_scopeKeyId_idx" ON "PrivacyRequest"("scopeKeyId");

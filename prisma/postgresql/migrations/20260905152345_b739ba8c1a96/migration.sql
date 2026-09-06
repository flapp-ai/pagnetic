-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "privacyAffectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PrivacyIdentitySuppression" (
    "id" TEXT NOT NULL,
    "shopHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lookupKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyIdentitySuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyIdentitySuppression_requestId_idx" ON "PrivacyIdentitySuppression"("requestId");

-- CreateIndex
CREATE INDEX "PrivacyIdentitySuppression_lookupKeyId_idx" ON "PrivacyIdentitySuppression"("lookupKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyIdentitySuppression_shopHash_kind_identityHash_key" ON "PrivacyIdentitySuppression"("shopHash", "kind", "identityHash");

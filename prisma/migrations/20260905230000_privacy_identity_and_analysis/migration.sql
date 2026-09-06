ALTER TABLE "Experiment" ADD COLUMN "privacyAffectedAt" DATETIME;
CREATE TABLE "PrivacyIdentitySuppression" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "identityHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "lookupKeyId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivacyIdentitySuppression_shopHash_kind_identityHash_key" ON "PrivacyIdentitySuppression"("shopHash", "kind", "identityHash");
CREATE INDEX "PrivacyIdentitySuppression_requestId_idx" ON "PrivacyIdentitySuppression"("requestId");
CREATE INDEX "PrivacyIdentitySuppression_lookupKeyId_idx" ON "PrivacyIdentitySuppression"("lookupKeyId");

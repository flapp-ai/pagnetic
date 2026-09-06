-- Bind each encrypted privacy scope to the exact retained field-encryption key.
ALTER TABLE "PrivacyRequest" ADD COLUMN "scopeKeyId" TEXT;

CREATE INDEX "PrivacyRequest_scopeKeyId_idx" ON "PrivacyRequest"("scopeKeyId");

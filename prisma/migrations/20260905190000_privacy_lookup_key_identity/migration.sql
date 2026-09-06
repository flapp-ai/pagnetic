-- Nullable means a pre-versioned receipt/tombstone. It must be read with the
-- explicitly retained legacy key; no old digest or customer identifier is rewritten.
ALTER TABLE "PrivacyRequest" ADD COLUMN "lookupKeyId" TEXT;
ALTER TABLE "PrivacyOrderSuppression" ADD COLUMN "lookupKeyId" TEXT;
CREATE INDEX "PrivacyRequest_lookupKeyId_idx" ON "PrivacyRequest"("lookupKeyId");
CREATE INDEX "PrivacyOrderSuppression_lookupKeyId_idx" ON "PrivacyOrderSuppression"("lookupKeyId");

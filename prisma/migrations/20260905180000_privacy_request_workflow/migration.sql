ALTER TABLE "PrivacyRequest" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "PrivacyRequest" ADD COLUMN "scopeCiphertext" TEXT;
ALTER TABLE "PrivacyRequest" ADD COLUMN "dueAt" DATETIME;
ALTER TABLE "PrivacyRequest" ADD COLUMN "nextRunAt" DATETIME;
ALTER TABLE "PrivacyRequest" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PrivacyRequest" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "PrivacyRequest" ADD COLUMN "leaseUntil" DATETIME;
ALTER TABLE "PrivacyRequest" ADD COLUMN "lastErrorCode" TEXT;
CREATE UNIQUE INDEX "PrivacyRequest_idempotencyKey_key" ON "PrivacyRequest"("idempotencyKey");
CREATE INDEX "PrivacyRequest_status_nextRunAt_idx" ON "PrivacyRequest"("status", "nextRunAt");
CREATE TABLE "PrivacyOrderSuppression" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopHash" TEXT NOT NULL,
  "orderHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PrivacyOrderSuppression_shopHash_orderHash_key" ON "PrivacyOrderSuppression"("shopHash", "orderHash");
CREATE INDEX "PrivacyOrderSuppression_requestId_idx" ON "PrivacyOrderSuppression"("requestId");

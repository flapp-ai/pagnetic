-- AlterTable
ALTER TABLE "PrivacyRequest" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dueAt" TIMESTAMP(3),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "scopeCiphertext" TEXT;

-- CreateTable
CREATE TABLE "PrivacyOrderSuppression" (
    "id" TEXT NOT NULL,
    "shopHash" TEXT NOT NULL,
    "orderHash" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyOrderSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyOrderSuppression_requestId_idx" ON "PrivacyOrderSuppression"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyOrderSuppression_shopHash_orderHash_key" ON "PrivacyOrderSuppression"("shopHash", "orderHash");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRequest_idempotencyKey_key" ON "PrivacyRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PrivacyRequest_status_nextRunAt_idx" ON "PrivacyRequest"("status", "nextRunAt");

-- CreateTable
CREATE TABLE "PrivacyDeliveryAudit" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "shopHash" TEXT NOT NULL,
    "actorHash" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "partCount" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "integrityTag" TEXT NOT NULL,

    CONSTRAINT "PrivacyDeliveryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyDeliveryAudit_deliveredAt_idx" ON "PrivacyDeliveryAudit"("deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyDeliveryAudit_requestId_key" ON "PrivacyDeliveryAudit"("requestId");

-- AddForeignKey
ALTER TABLE "PrivacyDeliveryAudit" ADD CONSTRAINT "PrivacyDeliveryAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

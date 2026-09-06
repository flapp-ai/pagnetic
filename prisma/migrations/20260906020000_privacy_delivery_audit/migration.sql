CREATE TABLE "PrivacyDeliveryAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "shopHash" TEXT NOT NULL,
    "actorHash" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "partCount" INTEGER NOT NULL,
    "deliveredAt" DATETIME NOT NULL,
    "integrityTag" TEXT NOT NULL,
    CONSTRAINT "PrivacyDeliveryAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PrivacyRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrivacyDeliveryAudit_requestId_key" ON "PrivacyDeliveryAudit"("requestId");
CREATE INDEX "PrivacyDeliveryAudit_deliveredAt_idx" ON "PrivacyDeliveryAudit"("deliveredAt");

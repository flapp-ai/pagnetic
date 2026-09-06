-- CreateTable
CREATE TABLE "BetaEntitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FREE_UNTIL_RESULT',
    "offerVersion" TEXT NOT NULL DEFAULT 'founding-beta-v1',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstValidResultAt" DATETIME,
    "firstValidResultState" TEXT,
    "firstValidResultSnapshotId" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BetaEntitlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicFunnelEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "anonymousIdHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "productHostHash" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LANDING_PAGE',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "BetaEntitlement_merchantId_key" ON "BetaEntitlement"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicFunnelEvent_requestId_key" ON "PublicFunnelEvent"("requestId");

-- CreateIndex
CREATE INDEX "PublicFunnelEvent_eventType_occurredAt_idx" ON "PublicFunnelEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "PublicFunnelEvent_anonymousIdHash_occurredAt_idx" ON "PublicFunnelEvent"("anonymousIdHash", "occurredAt");

-- CreateTable
CREATE TABLE "PixelCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "webPixelId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PixelCredential_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "salt" TEXT NOT NULL,
    "saltVersion" INTEGER NOT NULL DEFAULT 1,
    "controlPercentage" INTEGER NOT NULL DEFAULT 50,
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 7,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Experiment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Experiment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "randomizationUnitId" TEXT NOT NULL,
    "randomizationUnitType" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "bucket" INTEGER NOT NULL,
    "saltVersion" INTEGER NOT NULL,
    "consentState" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Assignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT,
    "assignmentId" TEXT,
    "productId" TEXT NOT NULL,
    "experienceVersionId" TEXT,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT,
    "arm" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "acquisitionAngle" TEXT,
    "mappingVersion" INTEGER,
    "bucket" INTEGER,
    "reason" TEXT NOT NULL,
    "consentState" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Decision_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Decision_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Decision_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Decision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Decision_experienceVersionId_fkey" FOREIGN KEY ("experienceVersionId") REFERENCES "ExperienceVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RenderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RenderEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RenderEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommerceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "decisionId" TEXT,
    "experimentKey" TEXT,
    "productId" TEXT,
    "checkoutToken" TEXT,
    "shopifyOrderId" TEXT,
    "consentState" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "CommerceEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommerceEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoreOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "currencyCode" TEXT NOT NULL,
    "grossAmount" DECIMAL NOT NULL,
    "netAmount" DECIMAL NOT NULL,
    "financialStatus" TEXT,
    "cancelledAt" DATETIME,
    "occurredAt" DATETIME NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoreOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "joinMethod" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderAttribution_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderAttribution_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderAttribution_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OrderAttribution_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PixelCredential_merchantId_key" ON "PixelCredential"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PixelCredential_tokenHash_key" ON "PixelCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "Experiment_merchantId_status_idx" ON "Experiment"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_merchantId_key_version_key" ON "Experiment"("merchantId", "key", "version");

-- CreateIndex
CREATE INDEX "Assignment_merchantId_assignedAt_idx" ON "Assignment"("merchantId", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_experimentId_randomizationUnitId_key" ON "Assignment"("experimentId", "randomizationUnitId");

-- CreateIndex
CREATE INDEX "Decision_merchantId_occurredAt_idx" ON "Decision"("merchantId", "occurredAt");

-- CreateIndex
CREATE INDEX "Decision_experimentId_arm_idx" ON "Decision"("experimentId", "arm");

-- CreateIndex
CREATE INDEX "RenderEvent_decisionId_occurredAt_idx" ON "RenderEvent"("decisionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderEvent_merchantId_eventId_key" ON "RenderEvent"("merchantId", "eventId");

-- CreateIndex
CREATE INDEX "CommerceEvent_merchantId_eventType_occurredAt_idx" ON "CommerceEvent"("merchantId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "CommerceEvent_merchantId_shopifyOrderId_idx" ON "CommerceEvent"("merchantId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEvent_merchantId_eventId_key" ON "CommerceEvent"("merchantId", "eventId");

-- CreateIndex
CREATE INDEX "StoreOrder_merchantId_occurredAt_idx" ON "StoreOrder"("merchantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_merchantId_shopifyOrderId_key" ON "StoreOrder"("merchantId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttribution_orderId_key" ON "OrderAttribution"("orderId");

-- CreateIndex
CREATE INDEX "OrderAttribution_merchantId_joinedAt_idx" ON "OrderAttribution"("merchantId", "joinedAt");

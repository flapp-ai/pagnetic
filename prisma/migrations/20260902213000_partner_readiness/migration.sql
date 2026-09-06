PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Merchant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apiVersion" TEXT NOT NULL DEFAULT '2026-07',
    "grantedScopesJson" TEXT NOT NULL DEFAULT '[]',
    "lastScopeSyncAt" DATETIME
);
INSERT INTO "new_Merchant" ("id", "shop", "displayName", "createdAt", "updatedAt", "installedAt")
SELECT "id", "shop", "displayName", "createdAt", "updatedAt", "createdAt" FROM "Merchant";
DROP TABLE "Merchant";
ALTER TABLE "new_Merchant" RENAME TO "Merchant";
CREATE UNIQUE INDEX "Merchant_shop_key" ON "Merchant"("shop");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE TABLE "PilotSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "unknownTrafficPolicy" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "rawEventRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "aggregateRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "incidentContactJson" TEXT NOT NULL DEFAULT '{}',
    "vertical" TEXT,
    "reviewProvider" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PilotSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PilotSettings_merchantId_key" ON "PilotSettings"("merchantId");

CREATE TABLE "ProductQualification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "eligibleSessions" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "revenueAmount" DECIMAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "eventCoverage" REAL NOT NULL,
    "weeklyEligibleSessions" REAL NOT NULL,
    "targetSampleSize" INTEGER NOT NULL,
    "expectedDurationDays" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "assumptionsJson" TEXT NOT NULL DEFAULT '{}',
    "overrideReason" TEXT,
    "overriddenBy" TEXT,
    "overriddenAt" DATETIME,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductQualification_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductQualification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductQualification_productId_key" ON "ProductQualification"("productId");
CREATE INDEX "ProductQualification_merchantId_status_idx" ON "ProductQualification"("merchantId", "status");

CREATE TABLE "ThemeActivation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "themeId" TEXT,
    "blockHandle" TEXT NOT NULL DEFAULT 'adaptive-panel',
    "extensionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "activationTarget" TEXT,
    "activeOnPublishedTheme" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" DATETIME,
    "placementApproved" BOOLEAN NOT NULL DEFAULT false,
    "mobileApproved" BOOLEAN NOT NULL DEFAULT false,
    "desktopApproved" BOOLEAN NOT NULL DEFAULT false,
    "standardCheckoutApproved" BOOLEAN NOT NULL DEFAULT false,
    "acceleratedCheckoutApproved" BOOLEAN NOT NULL DEFAULT false,
    "shopPayApproved" BOOLEAN NOT NULL DEFAULT false,
    "consentFlowsApproved" BOOLEAN NOT NULL DEFAULT false,
    "fallbackApproved" BOOLEAN NOT NULL DEFAULT false,
    "performanceApproved" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" DATETIME,
    CONSTRAINT "ThemeActivation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ThemeActivation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ThemeActivation_productId_key" ON "ThemeActivation"("productId");
CREATE INDEX "ThemeActivation_merchantId_activeOnPublishedTheme_idx" ON "ThemeActivation"("merchantId", "activeOnPublishedTheme");

CREATE TABLE "PilotQaCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "checkedBy" TEXT,
    "checkedAt" DATETIME,
    CONSTRAINT "PilotQaCheck_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PilotQaCheck_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PilotQaCheck_productId_key_key" ON "PilotQaCheck"("productId", "key");
CREATE INDEX "PilotQaCheck_merchantId_status_idx" ON "PilotQaCheck"("merchantId", "status");

CREATE TABLE "PilotRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PilotRole_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PilotRole_merchantId_actorKey_key" ON "PilotRole"("merchantId", "actorKey");
CREATE INDEX "PilotRole_merchantId_role_active_idx" ON "PilotRole"("merchantId", "role", "active");

CREATE TABLE "OperationalAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "OperationalAlert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OperationalAlert_merchantId_fingerprint_key" ON "OperationalAlert"("merchantId", "fingerprint");
CREATE INDEX "OperationalAlert_merchantId_status_openedAt_idx" ON "OperationalAlert"("merchantId", "status", "openedAt");

CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    CONSTRAINT "AutomationRun_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AutomationRun_jobType_startedAt_idx" ON "AutomationRun"("jobType", "startedAt");
CREATE INDEX "AutomationRun_merchantId_startedAt_idx" ON "AutomationRun"("merchantId", "startedAt");

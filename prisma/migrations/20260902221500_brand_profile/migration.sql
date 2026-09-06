CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "voiceTraitsJson" TEXT NOT NULL,
    "vocabularyJson" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "provider" TEXT NOT NULL DEFAULT 'LOCAL_DETERMINISTIC',
    "modelId" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'brand-profile-v1',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    CONSTRAINT "BrandProfile_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BrandProfile_merchantId_key" ON "BrandProfile"("merchantId");

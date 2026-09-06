CREATE TABLE "AdaptivePackageReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packageHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdaptivePackageReview_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AdaptivePackageReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdaptivePackageReview_merchantId_productId_packageHash_key" ON "AdaptivePackageReview"("merchantId", "productId", "packageHash");
CREATE INDEX "AdaptivePackageReview_merchantId_productId_status_idx" ON "AdaptivePackageReview"("merchantId", "productId", "status");

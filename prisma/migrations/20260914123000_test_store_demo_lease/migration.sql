CREATE TABLE "TestStoreDemoLease" (
    "merchantId" TEXT NOT NULL PRIMARY KEY,
    "startReceiptId" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "stoppedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestStoreDemoLease_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TestStoreDemoLease_startReceiptId_key" ON "TestStoreDemoLease"("startReceiptId");

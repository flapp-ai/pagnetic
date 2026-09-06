-- CreateTable
CREATE TABLE "StoreRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreRefund_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StoreRefund_orderId_occurredAt_idx" ON "StoreRefund"("orderId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreRefund_merchantId_shopifyRefundId_key" ON "StoreRefund"("merchantId", "shopifyRefundId");

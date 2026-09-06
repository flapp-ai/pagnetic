CREATE TABLE "EvaluationConsumption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "allowanceKey" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "offerVersion" TEXT NOT NULL,
    "sourceResultSnapshotId" TEXT,
    "inputHash" TEXT NOT NULL,
    "consumedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationConsumption_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EvaluationConsumption_merchantId_allowanceKey_key" ON "EvaluationConsumption"("merchantId", "allowanceKey");
CREATE UNIQUE INDEX "EvaluationConsumption_merchantId_experimentId_key" ON "EvaluationConsumption"("merchantId", "experimentId");
CREATE INDEX "EvaluationConsumption_merchantId_consumedAt_idx" ON "EvaluationConsumption"("merchantId", "consumedAt");

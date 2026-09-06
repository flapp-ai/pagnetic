ALTER TABLE "AutopilotPlan"
ADD COLUMN "cutoverReceiptId" TEXT;

CREATE INDEX "AutopilotPlan_cutoverReceiptId_idx"
ON "AutopilotPlan"("cutoverReceiptId");

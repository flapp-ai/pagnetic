-- AlterTable
ALTER TABLE "AutopilotPlan" ADD COLUMN     "cutoverReceiptId" TEXT;

-- CreateIndex
CREATE INDEX "AutopilotPlan_cutoverReceiptId_idx" ON "AutopilotPlan"("cutoverReceiptId");

-- AlterTable
ALTER TABLE "BetaEntitlement" ADD COLUMN "heroProductId" TEXT;
ALTER TABLE "BetaEntitlement" ADD COLUMN "activationStage" TEXT NOT NULL DEFAULT 'CONNECTED';
ALTER TABLE "BetaEntitlement" ADD COLUMN "activationStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

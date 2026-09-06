-- AlterTable
ALTER TABLE "WebhookInbox" ADD COLUMN     "processingLeaseToken" TEXT,
ADD COLUMN     "processingLeaseUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SubscriptionState" ADD COLUMN     "providerPayloadHash" TEXT,
ADD COLUMN     "providerShop" TEXT,
ADD COLUMN     "providerState" TEXT,
ADD COLUMN     "providerUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WebhookInbox_processingState_processingLeaseUntil_idx" ON "WebhookInbox"("processingState", "processingLeaseUntil");

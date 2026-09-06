ALTER TABLE "WebhookInbox" ADD COLUMN "processingLeaseToken" TEXT;
ALTER TABLE "WebhookInbox" ADD COLUMN "processingLeaseUntil" DATETIME;

CREATE INDEX "WebhookInbox_processingState_processingLeaseUntil_idx"
ON "WebhookInbox"("processingState", "processingLeaseUntil");

-- Pagnetic MVP v2 uses additive storage. Legacy experiment rows, registrations,
-- assignments, reports and financial tables are intentionally left in place.

ALTER TABLE "Experiment" ADD COLUMN "enrollmentStartedAt" DATETIME;
ALTER TABLE "Experiment" ADD COLUMN "enrollmentClosedAt" DATETIME;
ALTER TABLE "Experiment" ADD COLUMN "attributionClosesAt" DATETIME;
ALTER TABLE "Experiment" ADD COLUMN "financialMaturityAt" DATETIME;
ALTER TABLE "Experiment" ADD COLUMN "finalizedAt" DATETIME;
ALTER TABLE "Experiment" ADD COLUMN "stopReason" TEXT;
ALTER TABLE "Experiment" ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Assignment" ADD COLUMN "visitorHash" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "eligibilityVersion" TEXT NOT NULL DEFAULT 'legacy-v1';
ALTER TABLE "Assignment" ADD COLUMN "consentPolicyVersion" TEXT NOT NULL DEFAULT 'legacy-v1';
CREATE UNIQUE INDEX "Assignment_experimentId_visitorHash_key" ON "Assignment"("experimentId", "visitorHash");

ALTER TABLE "Decision" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "Decision" ADD COLUMN "deploymentVersionId" TEXT REFERENCES "DeploymentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Decision" ADD COLUMN "deploymentRevision" INTEGER;

CREATE TABLE "MessageDiagnosis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT,
  "productId" TEXT,
  "productRef" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "adEvidenceRef" TEXT,
  "mode" TEXT NOT NULL,
  "gapType" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "sourceSpansJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "rulesVersion" TEXT NOT NULL,
  "publicLookupHash" TEXT,
  "expiresAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageDiagnosis_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageDiagnosis_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageDiagnosis_publicLookupHash_key" ON "MessageDiagnosis"("publicLookupHash");
CREATE INDEX "MessageDiagnosis_merchantId_productId_createdAt_idx" ON "MessageDiagnosis"("merchantId", "productId", "createdAt");
CREATE INDEX "MessageDiagnosis_expiresAt_idx" ON "MessageDiagnosis"("expiresAt");

CREATE TABLE "QualificationSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "observationStart" DATETIME NOT NULL,
  "observationEnd" DATETIME NOT NULL,
  "dataSource" TEXT NOT NULL,
  "eligibleVisitors" INTEGER NOT NULL,
  "eligibleSessions" INTEGER NOT NULL,
  "paidPurchasers" INTEGER NOT NULL,
  "revenueMeanMinor" TEXT NOT NULL,
  "revenueVariance" REAL NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "coverage" REAL NOT NULL,
  "targetEffect" REAL NOT NULL,
  "targetVisitors" INTEGER,
  "forecastLowDays" INTEGER,
  "forecastHighDays" INTEGER,
  "status" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "canonicalPayload" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualificationSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QualificationSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualificationSnapshot_snapshotHash_key" ON "QualificationSnapshot"("snapshotHash");
CREATE INDEX "QualificationSnapshot_merchantId_productId_createdAt_idx" ON "QualificationSnapshot"("merchantId", "productId", "createdAt");

CREATE TABLE "DeploymentVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "planId" TEXT,
  "revision" INTEGER NOT NULL,
  "protocolVersion" TEXT NOT NULL,
  "policy" TEXT NOT NULL,
  "contentSetHash" TEXT NOT NULL,
  "experimentId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "approvedAuthorityHash" TEXT NOT NULL,
  "canonicalPayload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeploymentVersion_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DeploymentVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeploymentVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutopilotPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeploymentVersion_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DeploymentVersion_merchantId_productId_revision_key" ON "DeploymentVersion"("merchantId", "productId", "revision");
CREATE INDEX "DeploymentVersion_merchantId_state_createdAt_idx" ON "DeploymentVersion"("merchantId", "state", "createdAt");
CREATE INDEX "DeploymentVersion_experimentId_idx" ON "DeploymentVersion"("experimentId");
CREATE INDEX "Decision_deploymentVersionId_occurredAt_idx" ON "Decision"("deploymentVersionId", "occurredAt");

CREATE TABLE "ActiveDeployment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "deploymentVersionId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ActiveDeployment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveDeployment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActiveDeployment_deploymentVersionId_fkey" FOREIGN KEY ("deploymentVersionId") REFERENCES "DeploymentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ActiveDeployment_productId_key" ON "ActiveDeployment"("productId");
CREATE UNIQUE INDEX "ActiveDeployment_merchantId_productId_key" ON "ActiveDeployment"("merchantId", "productId");
CREATE INDEX "ActiveDeployment_merchantId_updatedAt_idx" ON "ActiveDeployment"("merchantId", "updatedAt");

CREATE TABLE "VisitorOutcome" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "eligibleSessionCount" INTEGER NOT NULL DEFAULT 0,
  "netFocalRevenueMinor" TEXT NOT NULL DEFAULT '0',
  "paidOrders" INTEGER NOT NULL DEFAULT 0,
  "sourceWatermark" TEXT,
  "projectionVersion" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "VisitorOutcome_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VisitorOutcome_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "VisitorOutcome_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VisitorOutcome_assignmentId_key" ON "VisitorOutcome"("assignmentId");
CREATE INDEX "VisitorOutcome_merchantId_experimentId_idx" ON "VisitorOutcome"("merchantId", "experimentId");

CREATE TABLE "WebhookInbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "shopifyEventId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "sourceOccurredAt" DATETIME,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadSchemaVersion" INTEGER NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "processingState" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastErrorCode" TEXT,
  "processedAt" DATETIME,
  CONSTRAINT "WebhookInbox_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebhookInbox_merchantId_shopifyEventId_key" ON "WebhookInbox"("merchantId", "shopifyEventId");
CREATE INDEX "WebhookInbox_processingState_nextAttemptAt_idx" ON "WebhookInbox"("processingState", "nextAttemptAt");
CREATE INDEX "WebhookInbox_merchantId_topic_receivedAt_idx" ON "WebhookInbox"("merchantId", "topic", "receivedAt");

CREATE TABLE "OrderLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "shopifyOrderId" TEXT NOT NULL,
  "shopifyCreatedAt" DATETIME NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "shopCurrency" TEXT NOT NULL,
  "originalObligationMinor" TEXT NOT NULL,
  "paymentState" TEXT NOT NULL,
  "test" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" DATETIME,
  "reconciliationState" TEXT NOT NULL DEFAULT 'PENDING',
  "sourceWatermark" TEXT,
  "sourceHash" TEXT NOT NULL,
  "completenessJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OrderLedger_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderLedger_merchantId_shopifyOrderId_key" ON "OrderLedger"("merchantId", "shopifyOrderId");
CREATE INDEX "OrderLedger_merchantId_sourceUpdatedAt_idx" ON "OrderLedger"("merchantId", "sourceUpdatedAt");
CREATE INDEX "OrderLedger_merchantId_reconciliationState_updatedAt_idx" ON "OrderLedger"("merchantId", "reconciliationState", "updatedAt");

CREATE TABLE "OrderLedgerLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "shopifyLineItemId" TEXT NOT NULL,
  "shopifyProductId" TEXT,
  "shopifyVariantId" TEXT,
  "merchandiseAfterDiscountMinor" TEXT,
  "currencyCode" TEXT NOT NULL,
  "giftCardProduct" BOOLEAN NOT NULL DEFAULT false,
  "allocationState" TEXT NOT NULL DEFAULT 'RESOLVED',
  CONSTRAINT "OrderLedgerLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderLedgerLine_orderId_shopifyLineItemId_key" ON "OrderLedgerLine"("orderId", "shopifyLineItemId");
CREATE INDEX "OrderLedgerLine_shopifyProductId_idx" ON "OrderLedgerLine"("shopifyProductId");

CREATE TABLE "RefundLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "orderId" TEXT,
  "shopifyOrderId" TEXT NOT NULL,
  "shopifyRefundId" TEXT NOT NULL,
  "shopifyTransactionId" TEXT,
  "shopifyLineItemId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "amountMinor" TEXT NOT NULL,
  "currencyCode" TEXT NOT NULL,
  "sourceOccurredAt" DATETIME NOT NULL,
  "allocationState" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundLedger_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RefundLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefundLedger_merchantId_shopifyRefundId_shopifyTransactionId_shopifyLineItemId_key" ON "RefundLedger"("merchantId", "shopifyRefundId", "shopifyTransactionId", "shopifyLineItemId");
CREATE UNIQUE INDEX "RefundLedger_merchantId_sourceKey_key" ON "RefundLedger"("merchantId", "sourceKey");
CREATE INDEX "RefundLedger_merchantId_shopifyOrderId_sourceOccurredAt_idx" ON "RefundLedger"("merchantId", "shopifyOrderId", "sourceOccurredAt");
CREATE INDEX "RefundLedger_allocationState_createdAt_idx" ON "RefundLedger"("allocationState", "createdAt");

CREATE TABLE "AttributionV2" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "joinMethod" TEXT NOT NULL,
  "signedRefHash" TEXT,
  "validAt" DATETIME NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "correctedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttributionV2_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttributionV2_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLedgerLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttributionV2_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttributionV2_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AttributionV2_orderLineId_experimentId_key" ON "AttributionV2"("orderLineId", "experimentId");
CREATE INDEX "AttributionV2_merchantId_experimentId_status_idx" ON "AttributionV2"("merchantId", "experimentId", "status");

CREATE TABLE "QaEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "themeId" TEXT,
  "templateSuffix" TEXT,
  "deploymentVersionId" TEXT,
  "checkKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "applicability" TEXT NOT NULL,
  "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedBy" TEXT NOT NULL,
  "evidenceRef" TEXT NOT NULL,
  "expiresAt" DATETIME,
  CONSTRAINT "QaEvidence_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "QaEvidence_merchantId_productId_checkKey_capturedAt_idx" ON "QaEvidence"("merchantId", "productId", "checkKey", "capturedAt");
CREATE INDEX "QaEvidence_expiresAt_idx" ON "QaEvidence"("expiresAt");

CREATE TABLE "Job" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "payloadSchemaVersion" INTEGER NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" DATETIME,
  "resultRef" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Job_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Job_merchantId_idempotencyKey_key" ON "Job"("merchantId", "idempotencyKey");
CREATE INDEX "Job_status_nextRunAt_leaseUntil_idx" ON "Job"("status", "nextRunAt", "leaseUntil");
CREATE INDEX "Job_merchantId_type_createdAt_idx" ON "Job"("merchantId", "type", "createdAt");

CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "payloadSchemaVersion" INTEGER NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" DATETIME,
  "deliveredAt" DATETIME,
  "lastErrorCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OutboxEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OutboxEvent_merchantId_idempotencyKey_key" ON "OutboxEvent"("merchantId", "idempotencyKey");
CREATE INDEX "OutboxEvent_status_nextRunAt_leaseUntil_idx" ON "OutboxEvent"("status", "nextRunAt", "leaseUntil");
CREATE INDEX "OutboxEvent_merchantId_aggregateType_aggregateId_idx" ON "OutboxEvent"("merchantId", "aggregateType", "aggregateId");

CREATE TABLE "SubscriptionState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "externalSubscriptionIdentity" TEXT,
  "offerVersion" TEXT NOT NULL,
  "authoritativeStatus" TEXT NOT NULL DEFAULT 'FREE_EVALUATION',
  "rawSourceVersion" TEXT,
  "verifiedAt" DATETIME,
  "periodEnd" DATETIME,
  "cancellationAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SubscriptionState_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SubscriptionState_merchantId_key" ON "SubscriptionState"("merchantId");

CREATE TABLE "ActionReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchantId" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "responseRef" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActionReceipt_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ActionReceipt_merchantId_idempotencyKey_key" ON "ActionReceipt"("merchantId", "idempotencyKey");
CREATE INDEX "ActionReceipt_merchantId_action_createdAt_idx" ON "ActionReceipt"("merchantId", "action", "createdAt");

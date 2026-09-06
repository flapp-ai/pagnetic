-- Registered experiment analysis, reliability state, and pilot operations.
CREATE TABLE "ExperimentRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "primaryMetric" TEXT NOT NULL,
    "revenueDefinition" TEXT NOT NULL,
    "minimumMeaningfulLift" REAL NOT NULL,
    "alpha" REAL NOT NULL,
    "power" REAL NOT NULL,
    "targetSampleSize" INTEGER NOT NULL,
    "minimumDurationDays" INTEGER NOT NULL,
    "maximumDurationDays" INTEGER NOT NULL,
    "randomizationUnit" TEXT NOT NULL,
    "eligibilityJson" TEXT NOT NULL,
    "exclusionsJson" TEXT NOT NULL,
    "covariatesJson" TEXT NOT NULL,
    "stoppingRule" TEXT NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "contentVersionsJson" TEXT NOT NULL,
    "mappingVersionsJson" TEXT NOT NULL,
    "guardrailsJson" TEXT NOT NULL,
    "dataMaturityLagDays" INTEGER NOT NULL DEFAULT 7,
    "registrationHash" TEXT NOT NULL,
    "registeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentRegistration_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExperimentRegistration_experimentId_key" ON "ExperimentRegistration"("experimentId");
CREATE UNIQUE INDEX "ExperimentRegistration_registrationHash_key" ON "ExperimentRegistration"("registrationHash");

CREATE TABLE "ExperimentResultSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "experimentId" TEXT NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "resultState" TEXT NOT NULL,
    "dataMaturityAt" DATETIME NOT NULL,
    "dataHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "reportMarkdown" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentResultSnapshot_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExperimentResultSnapshot_experimentId_dataHash_key" ON "ExperimentResultSnapshot"("experimentId", "dataHash");
CREATE INDEX "ExperimentResultSnapshot_experimentId_createdAt_idx" ON "ExperimentResultSnapshot"("experimentId", "createdAt");

CREATE TABLE "MeasurementSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "lastOrderSyncAt" DATETIME,
    "lastSuccessfulAt" DATETIME,
    "lastCursor" TEXT,
    "recoveredOrderCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MeasurementSyncState_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MeasurementSyncState_merchantId_key" ON "MeasurementSyncState"("merchantId");

CREATE TABLE "RuntimeControl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "activatedBy" TEXT,
    "activatedAt" DATETIME,
    "clearedBy" TEXT,
    "clearedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuntimeControl_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RuntimeControl_merchantId_key" ON "RuntimeControl"("merchantId");

CREATE TABLE "Incident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "actor" TEXT NOT NULL,
    CONSTRAINT "Incident_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Incident_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Incident_merchantId_status_detectedAt_idx" ON "Incident"("merchantId", "status", "detectedAt");
CREATE INDEX "Incident_experimentId_detectedAt_idx" ON "Incident"("experimentId", "detectedAt");

CREATE TABLE "Confounder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "materiality" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,
    CONSTRAINT "Confounder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Confounder_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Confounder_experimentId_occurredAt_idx" ON "Confounder"("experimentId", "occurredAt");

CREATE TABLE "SafetyEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "rollbackTriggered" BOOLEAN NOT NULL DEFAULT false,
    "metricsJson" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "evaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SafetyEvaluation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SafetyEvaluation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SafetyEvaluation_experimentId_evaluatedAt_idx" ON "SafetyEvaluation"("experimentId", "evaluatedAt");

CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopHash" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "subjectHash" TEXT,
    "status" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME
);
CREATE INDEX "PrivacyRequest_shopHash_requestedAt_idx" ON "PrivacyRequest"("shopHash", "requestedAt");

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apiVersion" TEXT NOT NULL DEFAULT '2026-07',
    "grantedScopesJson" TEXT NOT NULL DEFAULT '[]',
    "lastScopeSyncAt" TIMESTAMP(3),

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaEntitlement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FREE_UNTIL_RESULT',
    "offerVersion" TEXT NOT NULL DEFAULT 'founding-beta-v1',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstValidResultAt" TIMESTAMP(3),
    "firstValidResultState" TEXT,
    "firstValidResultSnapshotId" TEXT,
    "lastResultSnapshotId" TEXT,
    "lastResultState" TEXT,
    "freeExtensionUntil" TIMESTAMP(3),
    "revisedExperimentsRemaining" INTEGER NOT NULL DEFAULT 0,
    "offerPriceUsd" INTEGER NOT NULL DEFAULT 49,
    "heroProductId" TEXT,
    "activationStage" TEXT NOT NULL DEFAULT 'CONNECTED',
    "activationStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetaEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicFunnelEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "anonymousIdHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "productHostHash" TEXT,
    "source" TEXT NOT NULL DEFAULT 'LANDING_PAGE',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicFunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "voiceTraitsJson" TEXT NOT NULL,
    "vocabularyJson" TEXT NOT NULL,
    "analysisJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "provider" TEXT NOT NULL DEFAULT 'LOCAL_DETERMINISTIC',
    "modelId" TEXT,
    "promptVersion" TEXT NOT NULL DEFAULT 'brand-profile-v1',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceSnapshot" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceObject" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "verbatimText" TEXT NOT NULL,
    "productScope" TEXT NOT NULL,
    "variantScope" TEXT,
    "marketScope" TEXT NOT NULL DEFAULT 'ALL',
    "localeScope" TEXT NOT NULL DEFAULT 'en',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "requiredQualifiersJson" TEXT NOT NULL DEFAULT '[]',
    "substantiationReference" TEXT,
    "merchantStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "sourceHash" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionAngle" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcquisitionAngle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMapping" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "angleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "utmSource" TEXT NOT NULL,
    "utmCampaign" TEXT NOT NULL,
    "utmContent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "fallback" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperienceVersion" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "angleId" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "headline" TEXT NOT NULL,
    "supportingLine" TEXT,
    "benefitsJson" TEXT NOT NULL,
    "proofItemsJson" TEXT NOT NULL DEFAULT '[]',
    "reassurance" TEXT,
    "contentHash" TEXT NOT NULL,
    "sourceSnapshotHash" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "provider" TEXT,
    "modelId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "rawOutputJson" TEXT NOT NULL,
    "validationFindingsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),

    CONSTRAINT "ExperienceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "experienceVersionId" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "transformationType" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "requiredQualifiersJson" TEXT NOT NULL DEFAULT '[]',
    "riskClass" TEXT NOT NULL DEFAULT 'LOW',
    "validationFindingsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "claimId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,

    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("claimId","evidenceId")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experienceVersionId" TEXT NOT NULL,
    "approver" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "evidenceSnapshotHash" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PixelCredential" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "webPixelId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "salt" TEXT NOT NULL,
    "saltVersion" INTEGER NOT NULL DEFAULT 1,
    "controlPercentage" INTEGER NOT NULL DEFAULT 50,
    "controlPolicy" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "treatmentPolicy" TEXT NOT NULL DEFAULT 'MATCHED',
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 7,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enrollmentStartedAt" TIMESTAMP(3),
    "enrollmentClosedAt" TIMESTAMP(3),
    "attributionClosesAt" TIMESTAMP(3),
    "financialMaturityAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "lifecycleVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentRegistration" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "primaryMetric" TEXT NOT NULL,
    "revenueDefinition" TEXT NOT NULL,
    "minimumMeaningfulLift" DOUBLE PRECISION NOT NULL,
    "alpha" DOUBLE PRECISION NOT NULL,
    "power" DOUBLE PRECISION NOT NULL,
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
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentResultSnapshot" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "resultState" TEXT NOT NULL,
    "dataMaturityAt" TIMESTAMP(3) NOT NULL,
    "dataHash" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "reportMarkdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentResultSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "randomizationUnitId" TEXT NOT NULL,
    "randomizationUnitType" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "bucket" INTEGER NOT NULL,
    "saltVersion" INTEGER NOT NULL,
    "consentState" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "visitorHash" TEXT,
    "eligibilityVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
    "consentPolicyVersion" TEXT NOT NULL DEFAULT 'legacy-v1',

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT,
    "assignmentId" TEXT,
    "productId" TEXT NOT NULL,
    "experienceVersionId" TEXT,
    "sessionId" TEXT NOT NULL,
    "visitorId" TEXT,
    "arm" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "acquisitionAngle" TEXT,
    "mappingVersion" INTEGER,
    "bucket" INTEGER,
    "reason" TEXT NOT NULL,
    "consentState" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestHash" TEXT,
    "deploymentVersionId" TEXT,
    "deploymentRevision" INTEGER,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceEvent" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "decisionId" TEXT,
    "experimentKey" TEXT,
    "productId" TEXT,
    "checkoutToken" TEXT,
    "shopifyOrderId" TEXT,
    "consentState" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "CommerceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOrder" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "currencyCode" TEXT NOT NULL,
    "grossAmount" DECIMAL(65,30) NOT NULL,
    "netAmount" DECIMAL(65,30) NOT NULL,
    "financialStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreRefund" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAttribution" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "joinMethod" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementSyncState" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "lastOrderSyncAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "recoveredOrderCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeControl" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "killSwitch" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "activatedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "clearedBy" TEXT,
    "clearedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "actor" TEXT NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Confounder" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "materiality" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,

    CONSTRAINT "Confounder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyEvaluation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "rollbackTriggered" BOOLEAN NOT NULL DEFAULT false,
    "metricsJson" TEXT NOT NULL,
    "reasonsJson" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "shopHash" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "subjectHash" TEXT,
    "status" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotSettings" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "unknownTrafficPolicy" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "rawEventRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "aggregateRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "incidentContactJson" TEXT NOT NULL DEFAULT '{}',
    "vertical" TEXT,
    "reviewProvider" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductQualification" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "eligibleSessions" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "revenueAmount" DECIMAL(65,30) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "eventCoverage" DOUBLE PRECISION NOT NULL,
    "weeklyEligibleSessions" DOUBLE PRECISION NOT NULL,
    "targetSampleSize" INTEGER NOT NULL,
    "expectedDurationDays" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "assumptionsJson" TEXT NOT NULL DEFAULT '{}',
    "overrideReason" TEXT,
    "overriddenBy" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeActivation" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "themeId" TEXT,
    "blockHandle" TEXT NOT NULL DEFAULT 'adaptive-panel',
    "extensionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "activationTarget" TEXT,
    "activeOnPublishedTheme" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3),
    "placementApproved" BOOLEAN NOT NULL DEFAULT false,
    "mobileApproved" BOOLEAN NOT NULL DEFAULT false,
    "desktopApproved" BOOLEAN NOT NULL DEFAULT false,
    "standardCheckoutApproved" BOOLEAN NOT NULL DEFAULT false,
    "acceleratedCheckoutApproved" BOOLEAN NOT NULL DEFAULT false,
    "shopPayApproved" BOOLEAN NOT NULL DEFAULT false,
    "consentFlowsApproved" BOOLEAN NOT NULL DEFAULT false,
    "fallbackApproved" BOOLEAN NOT NULL DEFAULT false,
    "performanceApproved" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ThemeActivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotQaCheck" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "PilotQaCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotRole" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalAlert" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OperationalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCandidateScore" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "lookbackStart" TIMESTAMP(3),
    "lookbackEnd" TIMESTAMP(3),
    "inputAvailabilityJson" TEXT NOT NULL,
    "componentScoresJson" TEXT NOT NULL,
    "exclusionsJson" TEXT NOT NULL DEFAULT '[]',
    "explanationJson" TEXT NOT NULL DEFAULT '[]',
    "totalScore" DOUBLE PRECISION NOT NULL,
    "qualificationBand" TEXT NOT NULL,
    "durationBand" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCandidateScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotPlan" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "candidateScoreId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARING',
    "planHash" TEXT NOT NULL,
    "candidateScoreSnapshotJson" TEXT NOT NULL,
    "contentVersionIdsJson" TEXT NOT NULL,
    "contentHashesJson" TEXT NOT NULL,
    "evidenceSnapshotHash" TEXT NOT NULL,
    "mappingVersionsJson" TEXT NOT NULL DEFAULT '[]',
    "unknownTrafficPolicy" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "aaProtocolJson" TEXT NOT NULL,
    "realExperimentProtocolJson" TEXT NOT NULL,
    "safetyPolicyVersion" TEXT NOT NULL,
    "authorizedTransitionsJson" TEXT NOT NULL,
    "approvalRecordJson" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "mediumRiskAcknowledgedAt" TIMESTAMP(3),
    "aaExperimentId" TEXT,
    "realExperimentId" TEXT,
    "resultSnapshotId" TEXT,
    "lockToken" TEXT,
    "lockExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotTransition" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "gateSnapshotHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantNotice" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "planId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actionLabel" TEXT,
    "actionHref" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MerchantNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDiagnosis" (
    "id" TEXT NOT NULL,
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
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationSnapshot" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "observationStart" TIMESTAMP(3) NOT NULL,
    "observationEnd" TIMESTAMP(3) NOT NULL,
    "dataSource" TEXT NOT NULL,
    "eligibleVisitors" INTEGER NOT NULL,
    "eligibleSessions" INTEGER NOT NULL,
    "paidPurchasers" INTEGER NOT NULL,
    "revenueMeanMinor" TEXT NOT NULL,
    "revenueVariance" DOUBLE PRECISION NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "targetEffect" DOUBLE PRECISION NOT NULL,
    "targetVisitors" INTEGER,
    "forecastLowDays" INTEGER,
    "forecastHighDays" INTEGER,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "canonicalPayload" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualificationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentVersion" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveDeployment" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deploymentVersionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorOutcome" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "eligibleSessionCount" INTEGER NOT NULL DEFAULT 0,
    "netFocalRevenueMinor" TEXT NOT NULL DEFAULT '0',
    "paidOrders" INTEGER NOT NULL DEFAULT 0,
    "sourceWatermark" TEXT,
    "projectionVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookInbox" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyEventId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "sourceOccurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadSchemaVersion" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "processingState" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLedger" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "shopCurrency" TEXT NOT NULL,
    "originalObligationMinor" TEXT NOT NULL,
    "paymentState" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "reconciliationState" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceWatermark" TEXT,
    "sourceHash" TEXT NOT NULL,
    "completenessJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLedgerLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "merchandiseAfterDiscountMinor" TEXT,
    "currencyCode" TEXT NOT NULL,
    "giftCardProduct" BOOLEAN NOT NULL DEFAULT false,
    "allocationState" TEXT NOT NULL DEFAULT 'RESOLVED',

    CONSTRAINT "OrderLedgerLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundLedger" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT,
    "shopifyOrderId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "shopifyTransactionId" TEXT,
    "shopifyLineItemId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "amountMinor" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "sourceOccurredAt" TIMESTAMP(3) NOT NULL,
    "allocationState" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionV2" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "joinMethod" TEXT NOT NULL,
    "signedRefHash" TEXT,
    "validAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaEvidence" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "themeId" TEXT,
    "templateSuffix" TEXT,
    "deploymentVersionId" TEXT,
    "checkKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "applicability" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedBy" TEXT NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "QaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "payloadSchemaVersion" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "resultRef" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
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
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionState" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "externalSubscriptionIdentity" TEXT,
    "offerVersion" TEXT NOT NULL,
    "authoritativeStatus" TEXT NOT NULL DEFAULT 'FREE_EVALUATION',
    "rawSourceVersion" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "cancellationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionReceipt" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "responseRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_shop_key" ON "Merchant"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "BetaEntitlement_merchantId_key" ON "BetaEntitlement"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicFunnelEvent_requestId_key" ON "PublicFunnelEvent"("requestId");

-- CreateIndex
CREATE INDEX "PublicFunnelEvent_eventType_occurredAt_idx" ON "PublicFunnelEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "PublicFunnelEvent_anonymousIdHash_occurredAt_idx" ON "PublicFunnelEvent"("anonymousIdHash", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_merchantId_key" ON "BrandProfile"("merchantId");

-- CreateIndex
CREATE INDEX "Product_merchantId_status_idx" ON "Product"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_merchantId_shopifyProductId_key" ON "Product"("merchantId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "SourceDocument_merchantId_productId_idx" ON "SourceDocument"("merchantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_merchantId_sourceId_sourceVersion_key" ON "SourceDocument"("merchantId", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "EvidenceObject_merchantId_productId_merchantStatus_idx" ON "EvidenceObject"("merchantId", "productId", "merchantStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceObject_merchantId_sourceId_sourceVersion_key" ON "EvidenceObject"("merchantId", "sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AcquisitionAngle_merchantId_key_key" ON "AcquisitionAngle"("merchantId", "key");

-- CreateIndex
CREATE INDEX "CampaignMapping_merchantId_signature_status_idx" ON "CampaignMapping"("merchantId", "signature", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMapping_merchantId_signature_version_key" ON "CampaignMapping"("merchantId", "signature", "version");

-- CreateIndex
CREATE INDEX "ExperienceVersion_merchantId_status_idx" ON "ExperienceVersion"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExperienceVersion_productId_angleId_version_key" ON "ExperienceVersion"("productId", "angleId", "version");

-- CreateIndex
CREATE INDEX "Claim_experienceVersionId_idx" ON "Claim"("experienceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_experienceVersionId_key" ON "Approval"("experienceVersionId");

-- CreateIndex
CREATE INDEX "Approval_merchantId_approvedAt_idx" ON "Approval"("merchantId", "approvedAt");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PixelCredential_merchantId_key" ON "PixelCredential"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "PixelCredential_tokenHash_key" ON "PixelCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "Experiment_merchantId_status_idx" ON "Experiment"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_merchantId_key_version_key" ON "Experiment"("merchantId", "key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentRegistration_experimentId_key" ON "ExperimentRegistration"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentRegistration_registrationHash_key" ON "ExperimentRegistration"("registrationHash");

-- CreateIndex
CREATE INDEX "ExperimentResultSnapshot_experimentId_createdAt_idx" ON "ExperimentResultSnapshot"("experimentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentResultSnapshot_experimentId_dataHash_key" ON "ExperimentResultSnapshot"("experimentId", "dataHash");

-- CreateIndex
CREATE INDEX "Assignment_merchantId_assignedAt_idx" ON "Assignment"("merchantId", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_experimentId_randomizationUnitId_key" ON "Assignment"("experimentId", "randomizationUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_experimentId_visitorHash_key" ON "Assignment"("experimentId", "visitorHash");

-- CreateIndex
CREATE INDEX "Decision_merchantId_occurredAt_idx" ON "Decision"("merchantId", "occurredAt");

-- CreateIndex
CREATE INDEX "Decision_experimentId_arm_idx" ON "Decision"("experimentId", "arm");

-- CreateIndex
CREATE INDEX "Decision_deploymentVersionId_occurredAt_idx" ON "Decision"("deploymentVersionId", "occurredAt");

-- CreateIndex
CREATE INDEX "RenderEvent_decisionId_occurredAt_idx" ON "RenderEvent"("decisionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderEvent_merchantId_eventId_key" ON "RenderEvent"("merchantId", "eventId");

-- CreateIndex
CREATE INDEX "CommerceEvent_merchantId_eventType_occurredAt_idx" ON "CommerceEvent"("merchantId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "CommerceEvent_merchantId_shopifyOrderId_idx" ON "CommerceEvent"("merchantId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEvent_merchantId_eventId_key" ON "CommerceEvent"("merchantId", "eventId");

-- CreateIndex
CREATE INDEX "StoreOrder_merchantId_occurredAt_idx" ON "StoreOrder"("merchantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOrder_merchantId_shopifyOrderId_key" ON "StoreOrder"("merchantId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "StoreRefund_orderId_occurredAt_idx" ON "StoreRefund"("orderId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreRefund_merchantId_shopifyRefundId_key" ON "StoreRefund"("merchantId", "shopifyRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttribution_orderId_key" ON "OrderAttribution"("orderId");

-- CreateIndex
CREATE INDEX "OrderAttribution_merchantId_joinedAt_idx" ON "OrderAttribution"("merchantId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementSyncState_merchantId_key" ON "MeasurementSyncState"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "RuntimeControl_merchantId_key" ON "RuntimeControl"("merchantId");

-- CreateIndex
CREATE INDEX "Incident_merchantId_status_detectedAt_idx" ON "Incident"("merchantId", "status", "detectedAt");

-- CreateIndex
CREATE INDEX "Incident_experimentId_detectedAt_idx" ON "Incident"("experimentId", "detectedAt");

-- CreateIndex
CREATE INDEX "Confounder_experimentId_occurredAt_idx" ON "Confounder"("experimentId", "occurredAt");

-- CreateIndex
CREATE INDEX "SafetyEvaluation_experimentId_evaluatedAt_idx" ON "SafetyEvaluation"("experimentId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_shopHash_requestedAt_idx" ON "PrivacyRequest"("shopHash", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotSettings_merchantId_key" ON "PilotSettings"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductQualification_productId_key" ON "ProductQualification"("productId");

-- CreateIndex
CREATE INDEX "ProductQualification_merchantId_status_idx" ON "ProductQualification"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeActivation_productId_key" ON "ThemeActivation"("productId");

-- CreateIndex
CREATE INDEX "ThemeActivation_merchantId_activeOnPublishedTheme_idx" ON "ThemeActivation"("merchantId", "activeOnPublishedTheme");

-- CreateIndex
CREATE INDEX "PilotQaCheck_merchantId_status_idx" ON "PilotQaCheck"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PilotQaCheck_productId_key_key" ON "PilotQaCheck"("productId", "key");

-- CreateIndex
CREATE INDEX "PilotRole_merchantId_role_active_idx" ON "PilotRole"("merchantId", "role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PilotRole_merchantId_actorKey_key" ON "PilotRole"("merchantId", "actorKey");

-- CreateIndex
CREATE INDEX "OperationalAlert_merchantId_status_openedAt_idx" ON "OperationalAlert"("merchantId", "status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalAlert_merchantId_fingerprint_key" ON "OperationalAlert"("merchantId", "fingerprint");

-- CreateIndex
CREATE INDEX "AutomationRun_jobType_startedAt_idx" ON "AutomationRun"("jobType", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationRun_merchantId_startedAt_idx" ON "AutomationRun"("merchantId", "startedAt");

-- CreateIndex
CREATE INDEX "ProductCandidateScore_merchantId_createdAt_idx" ON "ProductCandidateScore"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductCandidateScore_merchantId_qualificationBand_totalSco_idx" ON "ProductCandidateScore"("merchantId", "qualificationBand", "totalScore");

-- CreateIndex
CREATE INDEX "ProductCandidateScore_productId_createdAt_idx" ON "ProductCandidateScore"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotPlan_planHash_key" ON "AutopilotPlan"("planHash");

-- CreateIndex
CREATE INDEX "AutopilotPlan_merchantId_state_updatedAt_idx" ON "AutopilotPlan"("merchantId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "AutopilotPlan_aaExperimentId_idx" ON "AutopilotPlan"("aaExperimentId");

-- CreateIndex
CREATE INDEX "AutopilotPlan_realExperimentId_idx" ON "AutopilotPlan"("realExperimentId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotPlan_merchantId_productId_version_key" ON "AutopilotPlan"("merchantId", "productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotTransition_idempotencyKey_key" ON "AutopilotTransition"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutopilotTransition_planId_occurredAt_idx" ON "AutopilotTransition"("planId", "occurredAt");

-- CreateIndex
CREATE INDEX "AutopilotTransition_merchantId_occurredAt_idx" ON "AutopilotTransition"("merchantId", "occurredAt");

-- CreateIndex
CREATE INDEX "MerchantNotice_merchantId_status_createdAt_idx" ON "MerchantNotice"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantNotice_planId_status_idx" ON "MerchantNotice"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantNotice_merchantId_dedupeKey_key" ON "MerchantNotice"("merchantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDiagnosis_publicLookupHash_key" ON "MessageDiagnosis"("publicLookupHash");

-- CreateIndex
CREATE INDEX "MessageDiagnosis_merchantId_productId_createdAt_idx" ON "MessageDiagnosis"("merchantId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageDiagnosis_expiresAt_idx" ON "MessageDiagnosis"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationSnapshot_snapshotHash_key" ON "QualificationSnapshot"("snapshotHash");

-- CreateIndex
CREATE INDEX "QualificationSnapshot_merchantId_productId_createdAt_idx" ON "QualificationSnapshot"("merchantId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "DeploymentVersion_merchantId_state_createdAt_idx" ON "DeploymentVersion"("merchantId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "DeploymentVersion_experimentId_idx" ON "DeploymentVersion"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentVersion_merchantId_productId_revision_key" ON "DeploymentVersion"("merchantId", "productId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveDeployment_productId_key" ON "ActiveDeployment"("productId");

-- CreateIndex
CREATE INDEX "ActiveDeployment_merchantId_updatedAt_idx" ON "ActiveDeployment"("merchantId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveDeployment_merchantId_productId_key" ON "ActiveDeployment"("merchantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorOutcome_assignmentId_key" ON "VisitorOutcome"("assignmentId");

-- CreateIndex
CREATE INDEX "VisitorOutcome_merchantId_experimentId_idx" ON "VisitorOutcome"("merchantId", "experimentId");

-- CreateIndex
CREATE INDEX "WebhookInbox_processingState_nextAttemptAt_idx" ON "WebhookInbox"("processingState", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookInbox_merchantId_topic_receivedAt_idx" ON "WebhookInbox"("merchantId", "topic", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookInbox_merchantId_shopifyEventId_key" ON "WebhookInbox"("merchantId", "shopifyEventId");

-- CreateIndex
CREATE INDEX "OrderLedger_merchantId_sourceUpdatedAt_idx" ON "OrderLedger"("merchantId", "sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "OrderLedger_merchantId_reconciliationState_updatedAt_idx" ON "OrderLedger"("merchantId", "reconciliationState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLedger_merchantId_shopifyOrderId_key" ON "OrderLedger"("merchantId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "OrderLedgerLine_shopifyProductId_idx" ON "OrderLedgerLine"("shopifyProductId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLedgerLine_orderId_shopifyLineItemId_key" ON "OrderLedgerLine"("orderId", "shopifyLineItemId");

-- CreateIndex
CREATE INDEX "RefundLedger_merchantId_shopifyOrderId_sourceOccurredAt_idx" ON "RefundLedger"("merchantId", "shopifyOrderId", "sourceOccurredAt");

-- CreateIndex
CREATE INDEX "RefundLedger_allocationState_createdAt_idx" ON "RefundLedger"("allocationState", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundLedger_merchantId_shopifyRefundId_shopifyTransactionI_key" ON "RefundLedger"("merchantId", "shopifyRefundId", "shopifyTransactionId", "shopifyLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundLedger_merchantId_sourceKey_key" ON "RefundLedger"("merchantId", "sourceKey");

-- CreateIndex
CREATE INDEX "AttributionV2_merchantId_experimentId_status_idx" ON "AttributionV2"("merchantId", "experimentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionV2_orderLineId_experimentId_key" ON "AttributionV2"("orderLineId", "experimentId");

-- CreateIndex
CREATE INDEX "QaEvidence_merchantId_productId_checkKey_capturedAt_idx" ON "QaEvidence"("merchantId", "productId", "checkKey", "capturedAt");

-- CreateIndex
CREATE INDEX "QaEvidence_expiresAt_idx" ON "QaEvidence"("expiresAt");

-- CreateIndex
CREATE INDEX "Job_status_nextRunAt_leaseUntil_idx" ON "Job"("status", "nextRunAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "Job_merchantId_type_createdAt_idx" ON "Job"("merchantId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_merchantId_idempotencyKey_key" ON "Job"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextRunAt_leaseUntil_idx" ON "OutboxEvent"("status", "nextRunAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "OutboxEvent_merchantId_aggregateType_aggregateId_idx" ON "OutboxEvent"("merchantId", "aggregateType", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_merchantId_idempotencyKey_key" ON "OutboxEvent"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionState_merchantId_key" ON "SubscriptionState"("merchantId");

-- CreateIndex
CREATE INDEX "ActionReceipt_merchantId_action_createdAt_idx" ON "ActionReceipt"("merchantId", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionReceipt_merchantId_idempotencyKey_key" ON "ActionReceipt"("merchantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BetaEntitlement" ADD CONSTRAINT "BetaEntitlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObject" ADD CONSTRAINT "EvidenceObject_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObject" ADD CONSTRAINT "EvidenceObject_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObject" ADD CONSTRAINT "EvidenceObject_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionAngle" ADD CONSTRAINT "AcquisitionAngle_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMapping" ADD CONSTRAINT "CampaignMapping_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMapping" ADD CONSTRAINT "CampaignMapping_angleId_fkey" FOREIGN KEY ("angleId") REFERENCES "AcquisitionAngle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceVersion" ADD CONSTRAINT "ExperienceVersion_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceVersion" ADD CONSTRAINT "ExperienceVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperienceVersion" ADD CONSTRAINT "ExperienceVersion_angleId_fkey" FOREIGN KEY ("angleId") REFERENCES "AcquisitionAngle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_experienceVersionId_fkey" FOREIGN KEY ("experienceVersionId") REFERENCES "ExperienceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_experienceVersionId_fkey" FOREIGN KEY ("experienceVersionId") REFERENCES "ExperienceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixelCredential" ADD CONSTRAINT "PixelCredential_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentRegistration" ADD CONSTRAINT "ExperimentRegistration_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentResultSnapshot" ADD CONSTRAINT "ExperimentResultSnapshot_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_experienceVersionId_fkey" FOREIGN KEY ("experienceVersionId") REFERENCES "ExperienceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_deploymentVersionId_fkey" FOREIGN KEY ("deploymentVersionId") REFERENCES "DeploymentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderEvent" ADD CONSTRAINT "RenderEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderEvent" ADD CONSTRAINT "RenderEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEvent" ADD CONSTRAINT "CommerceEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOrder" ADD CONSTRAINT "StoreOrder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreRefund" ADD CONSTRAINT "StoreRefund_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreRefund" ADD CONSTRAINT "StoreRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementSyncState" ADD CONSTRAINT "MeasurementSyncState_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuntimeControl" ADD CONSTRAINT "RuntimeControl_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Confounder" ADD CONSTRAINT "Confounder_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Confounder" ADD CONSTRAINT "Confounder_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvaluation" ADD CONSTRAINT "SafetyEvaluation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvaluation" ADD CONSTRAINT "SafetyEvaluation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotSettings" ADD CONSTRAINT "PilotSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQualification" ADD CONSTRAINT "ProductQualification_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductQualification" ADD CONSTRAINT "ProductQualification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeActivation" ADD CONSTRAINT "ThemeActivation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThemeActivation" ADD CONSTRAINT "ThemeActivation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotQaCheck" ADD CONSTRAINT "PilotQaCheck_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotQaCheck" ADD CONSTRAINT "PilotQaCheck_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotRole" ADD CONSTRAINT "PilotRole_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidateScore" ADD CONSTRAINT "ProductCandidateScore_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidateScore" ADD CONSTRAINT "ProductCandidateScore_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotPlan" ADD CONSTRAINT "AutopilotPlan_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotPlan" ADD CONSTRAINT "AutopilotPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotPlan" ADD CONSTRAINT "AutopilotPlan_candidateScoreId_fkey" FOREIGN KEY ("candidateScoreId") REFERENCES "ProductCandidateScore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotTransition" ADD CONSTRAINT "AutopilotTransition_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotTransition" ADD CONSTRAINT "AutopilotTransition_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutopilotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantNotice" ADD CONSTRAINT "MerchantNotice_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantNotice" ADD CONSTRAINT "MerchantNotice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutopilotPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDiagnosis" ADD CONSTRAINT "MessageDiagnosis_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDiagnosis" ADD CONSTRAINT "MessageDiagnosis_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationSnapshot" ADD CONSTRAINT "QualificationSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationSnapshot" ADD CONSTRAINT "QualificationSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVersion" ADD CONSTRAINT "DeploymentVersion_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVersion" ADD CONSTRAINT "DeploymentVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVersion" ADD CONSTRAINT "DeploymentVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AutopilotPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentVersion" ADD CONSTRAINT "DeploymentVersion_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveDeployment" ADD CONSTRAINT "ActiveDeployment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveDeployment" ADD CONSTRAINT "ActiveDeployment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveDeployment" ADD CONSTRAINT "ActiveDeployment_deploymentVersionId_fkey" FOREIGN KEY ("deploymentVersionId") REFERENCES "DeploymentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorOutcome" ADD CONSTRAINT "VisitorOutcome_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorOutcome" ADD CONSTRAINT "VisitorOutcome_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorOutcome" ADD CONSTRAINT "VisitorOutcome_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookInbox" ADD CONSTRAINT "WebhookInbox_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLedger" ADD CONSTRAINT "OrderLedger_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLedgerLine" ADD CONSTRAINT "OrderLedgerLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLedger" ADD CONSTRAINT "RefundLedger_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundLedger" ADD CONSTRAINT "RefundLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionV2" ADD CONSTRAINT "AttributionV2_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionV2" ADD CONSTRAINT "AttributionV2_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLedgerLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionV2" ADD CONSTRAINT "AttributionV2_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionV2" ADD CONSTRAINT "AttributionV2_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaEvidence" ADD CONSTRAINT "QaEvidence_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionState" ADD CONSTRAINT "SubscriptionState_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionReceipt" ADD CONSTRAINT "ActionReceipt_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

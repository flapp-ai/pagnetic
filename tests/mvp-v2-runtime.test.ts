import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { createCampaignMapping, GOVERNANCE_POLICY_VERSION, hashValue } from "../app/services/governance.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../app/services/mvp-v2";
import { installV2Deployment, pauseV2Deployment, StaleDeploymentRevisionError } from "../app/services/v2-deployment.server";
import { loadV2BaselineCapture, parseDecisionRequestV2, resolveV2Decision, verifyV2MeasurementReference, V2DecisionRequestError } from "../app/services/v2-decision.server";
import { ADAPTIVE_EXPERIMENT_QUESTIONS, campaignSignature } from "../app/services/adaptive-contracts";
import { registerAdaptiveExperiment } from "../app/services/adaptive-experiment.server";
import { approveAdaptivePackageReview, buildAdaptiveApprovedPackage, createAdaptivePackageReview, installAdaptiveApprovedPackage } from "../app/services/adaptive-package.server";
import { loadAdaptiveCoverage } from "../app/services/experiment-report-v2.server";
import { hashPixelToken, ingestPixelEvent } from "../app/services/measurement.server";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-v2-runtime-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return { db, async close() { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

async function seedRuntime(db: PrismaClient, suffix: string) {
  const merchant = await db.merchant.create({ data: { shop: `v2-${suffix}.myshopify.com` } });
  const product = await db.product.create({ data: {
    merchantId: merchant.id, shopifyProductId: `gid://shopify/Product/${suffix}`,
    title: "Trail Runner", handle: `trail-runner-${suffix}`, status: "ACTIVE",
    sourceVersion: "source-v1", sourceHash: hashValue(`source-${suffix}`), sourceSnapshot: "{}",
  } });
  const source = await db.sourceDocument.create({ data: {
    merchantId: merchant.id, productId: product.id, sourceType: "SHOPIFY_PRODUCT",
    sourceId: `source-${suffix}`, sourceVersion: "source-v1", payloadJson: "{}",
    contentHash: `document-${suffix}`,
  } });
  const benefits = [
    "Soft knit supports comfortable daily movement.",
    "Responsive foam supports steady movement.",
    "Durable rubber provides grip on city streets.",
  ];
  const headline = "Comfort for everyday movement";
  const content = { headline, supportingLine: null, benefits, proofItems: [] as string[], reassurance: null };
  const experience = await db.experienceVersion.create({ data: {
    merchantId: merchant.id, productId: product.id, version: 1, status: "APPROVED_ACTIVE",
    headline, benefitsJson: JSON.stringify(benefits), proofItemsJson: "[]",
    contentHash: hashValue(content), sourceSnapshotHash: `authority-${suffix}`,
    promptVersion: "deterministic-v1", rawOutputJson: "{}", publishedAt: new Date("2026-09-01T00:00:00.000Z"),
  } });
  for (const [index, claimText] of [headline, ...benefits].entries()) {
    const evidence = await db.evidenceObject.create({ data: {
      merchantId: merchant.id, productId: product.id, sourceDocumentId: source.id,
      sourceType: "SHOPIFY_PRODUCT_FIELD", sourceId: `claim-${suffix}-${index}`,
      sourceVersion: "source-v1", verbatimText: claimText,
      productScope: product.shopifyProductId, merchantStatus: "APPROVED", sourceHash: hashValue(claimText),
    } });
    await db.claim.create({ data: {
      experienceVersionId: experience.id, claimText, claimType: "PRODUCT_FACT",
      transformationType: "VERBATIM", scopeJson: "{}",
      evidenceLinks: { create: { evidenceId: evidence.id } },
    } });
  }
  await db.approval.create({ data: {
    merchantId: merchant.id, experienceVersionId: experience.id, approver: "merchant:test",
    contentHash: experience.contentHash, evidenceSnapshotHash: experience.sourceSnapshotHash,
    policyVersion: GOVERNANCE_POLICY_VERSION,
  } });
  return { merchant, product, experience };
}

async function seedExperiment(db: PrismaClient, fixture: Awaited<ReturnType<typeof seedRuntime>>, key: string, control = "ORIGINAL", treatment = "UNIVERSAL") {
  return db.experiment.create({ data: {
    merchantId: fixture.merchant.id, productId: fixture.product.id, key,
    salt: `salt-${key}`, controlPolicy: control, treatmentPolicy: treatment,
    enrollmentStartedAt: new Date("2026-09-01T00:00:00.000Z"), lifecycleVersion: 2,
    registration: { create: {
      protocolVersion: MVP_V2_PROTOCOL_VERSION, hypothesis: "A sourced message changes selected-product sales.",
      primaryMetric: MVP_V2_PRIMARY_METRIC, revenueDefinition: "NET_FOCAL_MERCHANDISE",
      minimumMeaningfulLift: 0.05, alpha: 0.05, power: 0.8, targetSampleSize: 2000,
      minimumDurationDays: 14, maximumDurationDays: 42,
      randomizationUnit: "CONSENTED_PERSISTENT_VISITOR", eligibilityJson: "{}",
      exclusionsJson: "[]", covariatesJson: "[]", stoppingRule: "FIXED_COHORT_V2",
      analysisVersion: "visitor-revenue-v2", contentVersionsJson: JSON.stringify([{
        id: fixture.experience.id,
        contentHash: fixture.experience.contentHash,
      }]),
      mappingVersionsJson: "[]", guardrailsJson: "{}", dataMaturityLagDays: 7,
      registrationHash: hashValue({ key, productId: fixture.product.id }),
    } },
  } });
}

const environment = {
  PAGNETIC_V2_ENABLED: "true",
  PAGNETIC_V2_ENABLED_SHOPS: [
    "2001", "adaptive-protocols", "1001", "1001-atomic", "1001-entitlement",
    "1002", "1006", "1007", "1008", "1003", "1004", "1005",
  ].map((suffix) => `v2-${suffix}.myshopify.com`).join(","),
  ASSIGNMENT_SECRET: "a-secure-test-secret-that-is-at-least-32-characters",
};
function request(
  productId: string,
  requestId = "request_0001",
  visitorToken = "visitor_token_0001",
  sessionId = "session_token_0001",
  campaignRef?: string,
) {
  return parseDecisionRequestV2({ schemaVersion: 2, requestId, productId,
    visitorToken, sessionId,
    consent: { analytics: true, preferences: true, policyVersion: "shopify-consent-v1" },
    blockVersion: "adaptive-panel-v2", ...(campaignRef ? { campaignRef } : {}),
  });
}

test("adaptive deployment resolves an approved campaign bundle for treatment and keeps unknown context Original", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "2001");
    const angle = await fixture.db.acquisitionAngle.create({ data: { merchantId: seeded.merchant.id, key: "commute", label: "Commute" } });
    const second = await fixture.db.experienceVersion.create({ data: {
      merchantId: seeded.merchant.id, productId: seeded.product.id, version: 2, status: "APPROVED_ACTIVE",
      headline: "Organization for every commute", benefitsJson: JSON.stringify(["Multiple compartments keep essentials organized.", "Durable fabric supports daily commuting.", "A padded sleeve protects everyday devices."]), proofItemsJson: "[]",
      contentHash: hashValue({ headline: "Organization for every commute", supportingLine: null, benefits: ["Multiple compartments keep essentials organized.", "Durable fabric supports daily commuting.", "A padded sleeve protects everyday devices."], proofItems: [], reassurance: null }), sourceSnapshotHash: seeded.experience.sourceSnapshotHash,
      promptVersion: "deterministic-v1", rawOutputJson: "{}", publishedAt: new Date("2026-09-02T00:00:00.000Z"),
    } });
    await fixture.db.experienceVersion.update({ where: { id: second.id }, data: { angleId: angle.id } });
    for (const [index, claimText] of [second.headline, "Multiple compartments keep essentials organized.", "Durable fabric supports daily commuting.", "A padded sleeve protects everyday devices."].entries()) {
      const evidence = await fixture.db.evidenceObject.create({ data: {
        merchantId: seeded.merchant.id, productId: seeded.product.id, sourceDocumentId: (await fixture.db.sourceDocument.findFirstOrThrow({ where: { productId: seeded.product.id } })).id,
        sourceType: "SHOPIFY_PRODUCT_FIELD", sourceId: `adaptive-claim-${index}`, sourceVersion: "source-v1", verbatimText: claimText,
        productScope: seeded.product.shopifyProductId, merchantStatus: "APPROVED", sourceHash: hashValue(claimText),
      } });
      await fixture.db.claim.create({ data: { experienceVersionId: second.id, claimText, claimType: "PRODUCT_FACT", transformationType: "VERBATIM", scopeJson: "{}", evidenceLinks: { create: { evidenceId: evidence.id } } } });
    }
    await fixture.db.approval.create({ data: { merchantId: seeded.merchant.id, experienceVersionId: second.id, approver: "merchant:test", contentHash: second.contentHash, evidenceSnapshotHash: second.sourceSnapshotHash, policyVersion: GOVERNANCE_POLICY_VERSION } });
    const experiment = await seedExperiment(fixture.db, seeded, "adaptive-effect-2001", "ORIGINAL", "MATCHED");
    await fixture.db.experimentRegistration.update({ where: { experimentId: experiment.id }, data: { contentVersionsJson: JSON.stringify([{ id: seeded.experience.id, contentHash: seeded.experience.contentHash }, { id: second.id, contentHash: second.contentHash }]) } });
    const signature = campaignSignature({ source: "instagram", campaign: "commute" });
    const campaignEvidenceText = "Keep a commuter's everyday cables and devices organized.";
    const campaignEvidenceHash = hashValue(campaignEvidenceText);
    const campaignDocument = await fixture.db.sourceDocument.create({ data: {
      merchantId: seeded.merchant.id, sourceType: "MERCHANT_CAMPAIGN_TEXT",
      sourceId: `campaign:${signature}`, sourceVersion: campaignEvidenceHash,
      payloadJson: JSON.stringify({ text: campaignEvidenceText, locale: "en" }),
      contentHash: campaignEvidenceHash,
    } });
    await fixture.db.campaignMapping.create({ data: { merchantId: seeded.merchant.id, angleId: angle.id, version: 1, signature, utmSource: "instagram", utmCampaign: "commute", utmContent: "", campaignEvidenceRef: campaignDocument.id, campaignEvidenceHash, campaignLocale: "en", status: "ACTIVE", fallback: "ORIGINAL", createdBy: "merchant:test" } });
    const adaptivePackage = await buildAdaptiveApprovedPackage({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id });
    assert.equal(adaptivePackage.reviewPayload.protocolVersion, "adaptive-owner-review-a1");
    assert.equal(adaptivePackage.reviewPayload.mappings[0]?.campaignEvidenceText, campaignEvidenceText);
    assert.equal(adaptivePackage.reviewPayload.mappings[0]?.headline, second.headline);
    assert.equal(adaptivePackage.reviewPayload.experimentQuestions.ORIGINAL_MATCHED.protocolVersion, "adaptive-original-vs-matched-a1");
    assert.equal(adaptivePackage.reviewPayload.experimentQuestions.UNIVERSAL_MATCHED.protocolVersion, "adaptive-universal-vs-matched-a1");
    const review = await createAdaptivePackageReview({ db: fixture.db, package: adaptivePackage, actor: "merchant:test" });
    await approveAdaptivePackageReview({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id, reviewId: review.id, actor: "merchant:test" });
    const deployed = await installAdaptiveApprovedPackage({ package: adaptivePackage, db: fixture.db, experimentId: experiment.id, reviewId: review.id, contentVersionId: seeded.experience.id, expectedRevision: 0, idempotencyKey: "adaptive-install-2001", actor: "merchant:test" });
    let matched: Awaited<ReturnType<typeof resolveV2Decision>> | null = null;
    let matchedIndex = -1;
    for (let index = 0; index < 20 && !matched; index += 1) {
      const result = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop, request: request(seeded.product.shopifyProductId, `request_adaptive_${index}`, `visitor_adaptive_${index}`, `session_adaptive_${index}`, signature), environment });
      if (result.serving === "MATCHED") {
        matched = result;
        matchedIndex = index;
      }
    }
    assert.ok(matched);
    assert.equal(matched.content?.headline, second.headline);
    assert.equal((matched as NonNullable<typeof matched>).assignmentArm, "MATCHED");
    assert.equal((await fixture.db.decision.findFirstOrThrow({ where: { merchantId: seeded.merchant.id, policy: "MATCHED" } })).mappingVersion, 1);
    const coverage = await loadAdaptiveCoverage({ db: fixture.db, merchantId: seeded.merchant.id, experimentId: experiment.id });
    assert.ok(coverage.assignedEligibleVisitors >= 1);
    assert.equal(coverage.mappedAssignedVisitors, coverage.assignedEligibleVisitors);
    assert.ok(coverage.missingRenderOutcomeVisitors >= 1);
    if (matched.decisionId) {
      await fixture.db.renderEvent.create({ data: { merchantId: seeded.merchant.id, eventId: "adaptive-render-failure-1", decisionId: matched.decisionId, status: "ERROR", errorCode: "TEST_FAILURE", occurredAt: new Date() } });
      const withFailure = await loadAdaptiveCoverage({ db: fixture.db, merchantId: seeded.merchant.id, experimentId: experiment.id });
      assert.equal(withFailure.renderFailureVisitors, 1);
    }
    const retained = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop, request: request(seeded.product.shopifyProductId, "request_adaptive_retained", `visitor_adaptive_${matchedIndex}`, "session_adaptive_retained", "not-mapped"), environment });
    assert.equal(retained.assignmentId, matched.assignmentId);
    assert.equal(retained.serving, "ORIGINAL");
    const retainedCoverage = await loadAdaptiveCoverage({ db: fixture.db, merchantId: seeded.merchant.id, experimentId: experiment.id });
    assert.equal(retainedCoverage.assignedEligibleVisitors, coverage.assignedEligibleVisitors);
    assert.equal(retainedCoverage.mappedAssignedVisitors, coverage.mappedAssignedVisitors);
    const updatedMapping = await createCampaignMapping({
      db: fixture.db, merchantId: seeded.merchant.id, angleId: angle.id,
      utmSource: "instagram", utmCampaign: "commute", utmContent: "",
      campaignAdText: "A newly supplied commute promise requires a new package review.",
      campaignLocale: "en", fallback: "ORIGINAL", actor: "merchant:test",
    });
    assert.equal(updatedMapping.version, 2);
    assert.equal((await fixture.db.adaptivePackageReview.findUniqueOrThrow({ where: { id: review.id } })).status, "INVALIDATED");
    const frozenAfterMappingUpdate = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop, request: request(seeded.product.shopifyProductId, "request_adaptive_frozen_mapping", `visitor_adaptive_${matchedIndex}`, "session_adaptive_frozen_mapping", signature), environment });
    assert.equal(frozenAfterMappingUpdate.assignmentId, matched.assignmentId);
    assert.equal(frozenAfterMappingUpdate.serving, "MATCHED");
    const evidenceId = (await fixture.db.claim.findFirstOrThrow({ where: { experienceVersionId: second.id }, include: { evidenceLinks: true } })).evidenceLinks[0]!.evidenceId;
    await fixture.db.experienceVersion.update({ where: { id: second.id }, data: { rawOutputJson: JSON.stringify({ faq: [{ question: "What is it for?", answer: "It supports organized commuting.", evidenceIds: [evidenceId] }] }) } });
    const authorityFailure = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop, request: request(seeded.product.shopifyProductId, "request_adaptive_authority_drift", "visitor_adaptive_authority_drift", "session_adaptive_authority_drift", signature), environment });
    assert.equal(authorityFailure.serving, "ORIGINAL");
    assert.equal(authorityFailure.reason, "CONTENT_AUTHORITY_INVALID");
    await fixture.db.experienceVersion.update({ where: { id: second.id }, data: { rawOutputJson: "{}" } });
    const assignmentsBeforeUnknown = await fixture.db.assignment.count({ where: { experimentId: experiment.id } });
    const unknown = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop, request: request(seeded.product.shopifyProductId, "request_unknown_1", "visitor_unknown_1", "session_unknown_1", "not-mapped"), environment });
    assert.equal(unknown.serving, "ORIGINAL");
    assert.equal(await fixture.db.assignment.count({ where: { experimentId: experiment.id } }), assignmentsBeforeUnknown);
    assert.equal((await loadAdaptiveCoverage({ db: fixture.db, merchantId: seeded.merchant.id, experimentId: experiment.id })).unmatchedContextVisits, 1);
    const secondSignature = campaignSignature({ source: "email", campaign: "commute" });
    const secondCampaignText = "Keep everyday travel accessories organized.";
    const secondCampaignHash = hashValue(secondCampaignText);
    const secondCampaignDocument = await fixture.db.sourceDocument.create({ data: {
      merchantId: seeded.merchant.id, sourceType: "MERCHANT_CAMPAIGN_TEXT",
      sourceId: `campaign:${secondSignature}`, sourceVersion: secondCampaignHash,
      payloadJson: JSON.stringify({ text: secondCampaignText, locale: "en" }),
      contentHash: secondCampaignHash,
    } });
    await fixture.db.campaignMapping.create({ data: { merchantId: seeded.merchant.id, angleId: angle.id, version: 1, signature: secondSignature, utmSource: "email", utmCampaign: "commute", utmContent: "", campaignEvidenceRef: secondCampaignDocument.id, campaignEvidenceHash: secondCampaignHash, campaignLocale: "en", status: "ACTIVE", fallback: "ORIGINAL", createdBy: "merchant:test" } });
    const staleReviewPackage = await buildAdaptiveApprovedPackage({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id });
    const staleReview = await createAdaptivePackageReview({ db: fixture.db, package: staleReviewPackage, actor: "merchant:test" });
    await fixture.db.product.update({ where: { id: seeded.product.id }, data: { sourceVersion: "source-v2", sourceHash: "e".repeat(64) } });
    await assert.rejects(approveAdaptivePackageReview({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id, reviewId: staleReview.id, actor: "merchant:test" }), /package changed/);
    assert.equal(deployed.deployment.policy, "MATCHED");
  } finally { await fixture.close(); }
});

test("adaptive experiment registrations keep total-policy and matching-specific questions separate", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "adaptive-protocols");
    const content = { id: seeded.experience.id, contentHash: seeded.experience.contentHash };
    const totalPolicy = await registerAdaptiveExperiment({
      db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id,
      key: "adaptive-total-policy", comparison: "ORIGINAL_MATCHED",
      minimumMeaningfulLift: .05, alpha: .05, power: .8, targetSampleSize: 2000,
      minimumDurationDays: 14, maximumDurationDays: 42, dataMaturityLagDays: 7,
      contentVersions: [content], mappingVersions: [{ mappingVersion: 1 }],
      guardrails: {}, approvedAuthorityHash: "a".repeat(64),
    });
    assert.equal(totalPolicy.controlPolicy, "ORIGINAL");
    assert.equal(totalPolicy.treatmentPolicy, "MATCHED");
    assert.equal(totalPolicy.registration?.hypothesis, ADAPTIVE_EXPERIMENT_QUESTIONS.ORIGINAL_MATCHED.question);
    const second = await fixture.db.experienceVersion.create({ data: {
      merchantId: seeded.merchant.id, productId: seeded.product.id, version: 2,
      status: "DRAFT", headline: "A second frozen bundle", benefitsJson: "[]",
      proofItemsJson: "[]", contentHash: "b".repeat(64), sourceSnapshotHash: "c".repeat(64),
      promptVersion: "test", rawOutputJson: "{}",
    } });
    const matchingSpecific = await registerAdaptiveExperiment({
      db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id,
      key: "adaptive-matching-specific", comparison: "UNIVERSAL_MATCHED",
      minimumMeaningfulLift: .05, alpha: .05, power: .8, targetSampleSize: 2000,
      minimumDurationDays: 14, maximumDurationDays: 42, dataMaturityLagDays: 7,
      contentVersions: [content, { id: second.id, contentHash: second.contentHash }],
      mappingVersions: [{ mappingVersion: 1 }], guardrails: {}, approvedAuthorityHash: "b".repeat(64),
    });
    assert.equal(matchingSpecific.controlPolicy, "UNIVERSAL");
    assert.equal(matchingSpecific.treatmentPolicy, "MATCHED");
    assert.equal(matchingSpecific.registration?.hypothesis, ADAPTIVE_EXPERIMENT_QUESTIONS.UNIVERSAL_MATCHED.question);
    await assert.rejects(registerAdaptiveExperiment({
      db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id,
      key: "adaptive-missing-universal", comparison: "UNIVERSAL_MATCHED",
      minimumMeaningfulLift: .05, alpha: .05, power: .8, targetSampleSize: 2000,
      minimumDurationDays: 14, maximumDurationDays: 42, dataMaturityLagDays: 7,
      contentVersions: [content], mappingVersions: [{ mappingVersion: 1 }],
      guardrails: {}, approvedAuthorityHash: "c".repeat(64),
    }), /UNIVERSAL_CONTROL_REQUIRED/);
  } finally { await fixture.close(); }
});

test("one product pointer advances idempotently and rejects stale revisions", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1001");
    const aa = await seedExperiment(fixture.db, seeded, "aa-1001", "ORIGINAL", "ORIGINAL");
    const first = await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: aa.id, policy: "ORIGINAL",
      approvedAuthorityHash: "a".repeat(64), expectedRevision: 0, idempotencyKey: "aa-start" });
    const replay = await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: aa.id, policy: "ORIGINAL",
      approvedAuthorityHash: "a".repeat(64), expectedRevision: 0, idempotencyKey: "aa-start" });
    assert.equal(replay.deployment.id, first.deployment.id);
    assert.equal(replay.replayed, true);
    assert.equal(await fixture.db.activeDeployment.count(), 1);
    assert.equal(await fixture.db.outboxEvent.count(), 1);
    const effect = await seedExperiment(fixture.db, seeded, "effect-1001");
    await fixture.db.experimentRegistration.update({
      where: { experimentId: effect.id },
      data: { contentVersionsJson: "[]" },
    });
    await assert.rejects(installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: effect.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "b".repeat(64), expectedRevision: 1,
      idempotencyKey: "effect-unregistered" }), /not frozen in the experiment registration/);
    await fixture.db.experimentRegistration.update({
      where: { experimentId: effect.id },
      data: { contentVersionsJson: JSON.stringify([{
        id: seeded.experience.id,
        contentHash: seeded.experience.contentHash,
      }]) },
    });
    const advanced = await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: effect.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "b".repeat(64), expectedRevision: 1,
      idempotencyKey: "effect-start" });
    assert.equal(advanced.pointer.revision, 2);
    assert.equal(await fixture.db.activeDeployment.count(), 1);
    assert.equal(await fixture.db.deploymentVersion.count(), 2);
    assert.equal(await fixture.db.outboxEvent.count(), 2);
    assert.deepEqual(
      (await fixture.db.evaluationConsumption.findMany({
        where: { merchantId: seeded.merchant.id },
        orderBy: { allowanceKey: "asc" },
        select: { allowanceKey: true },
      })).map((item) => item.allowanceKey),
      ["MEASUREMENT_CHECK_V1", "MESSAGE_TEST_V1"],
    );
    await assert.rejects(installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: effect.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "c".repeat(64), expectedRevision: 1,
      idempotencyKey: "stale-advance" }), StaleDeploymentRevisionError);
  } finally { await fixture.close(); }
});

test("deployment authority callback failure rolls back pointer, evaluation, receipt and outbox atomically", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1001-atomic");
    const experiment = await seedExperiment(
      fixture.db,
      seeded,
      "aa-1001-atomic",
      "ORIGINAL",
      "ORIGINAL",
    );
    await assert.rejects(
      installV2Deployment({
        db: fixture.db,
        merchantId: seeded.merchant.id,
        productId: seeded.product.id,
        experimentId: experiment.id,
        policy: "ORIGINAL",
        approvedAuthorityHash: "a".repeat(64),
        expectedRevision: 0,
        idempotencyKey: "aa-start-authority-changed",
        afterInstall: async () => {
          throw new Error("TEST_AUTHORITY_CHANGED");
        },
      }),
      /TEST_AUTHORITY_CHANGED/,
    );
    assert.equal(await fixture.db.activeDeployment.count(), 0);
    assert.equal(await fixture.db.deploymentVersion.count(), 0);
    assert.equal(await fixture.db.evaluationConsumption.count(), 0);
    assert.equal(await fixture.db.actionReceipt.count(), 0);
    assert.equal(await fixture.db.outboxEvent.count(), 0);
    assert.equal(await fixture.db.runtimeControl.count(), 0);
  } finally { await fixture.close(); }
});

test("free evaluation and its one eligible revision cannot reset across later experiment IDs", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1001-entitlement");
    const first = await seedExperiment(fixture.db, seeded, "effect-entitlement-1");
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: first.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "e".repeat(64), expectedRevision: 0,
      idempotencyKey: "effect-entitlement-1", now: new Date("2026-09-05T00:00:00.000Z") });
    await fixture.db.betaEntitlement.create({ data: {
      merchantId: seeded.merchant.id,
      status: "FREE_EXTENSION",
      offerVersion: "founding-beta-v1",
      lastResultSnapshotId: "frozen-negative-result",
      lastResultState: "NEGATIVE",
      freeExtensionUntil: new Date("2026-10-05T00:00:00.000Z"),
      revisedExperimentsRemaining: 1,
    } });
    const revision = await seedExperiment(fixture.db, seeded, "effect-entitlement-2");
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: revision.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "f".repeat(64), expectedRevision: 1,
      idempotencyKey: "effect-entitlement-2", now: new Date("2026-09-06T00:00:00.000Z") });
    assert.equal((await fixture.db.betaEntitlement.findUniqueOrThrow({
      where: { merchantId: seeded.merchant.id },
    })).revisedExperimentsRemaining, 0);
    assert.equal(await fixture.db.evaluationConsumption.count({
      where: { merchantId: seeded.merchant.id },
    }), 2);
    const repeated = await seedExperiment(fixture.db, seeded, "effect-entitlement-3");
    await assert.rejects(installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: repeated.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "1".repeat(64), expectedRevision: 2,
      idempotencyKey: "effect-entitlement-3", now: new Date("2026-09-07T00:00:00.000Z") }),
    /MESSAGE_EVALUATION_ALREADY_CONSUMED/);
    assert.equal((await fixture.db.activeDeployment.findUniqueOrThrow({
      where: { productId: seeded.product.id },
    })).revision, 2);
  } finally { await fixture.close(); }
});

test("v2 decision is visitor-sticky, idempotent and tamper-evident", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1002");
    const experiment = await seedExperiment(fixture.db, seeded, "effect-1002");
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: experiment.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "d".repeat(64), expectedRevision: 0,
      idempotencyKey: "effect-start" });
    const now = new Date("2026-09-05T00:00:00.000Z");
    const input = request(seeded.product.shopifyProductId);
    const first = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop, request: input, environment, now });
    const replay = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: input, environment, now: new Date(now.getTime() + 1_000) });
    assert.equal(replay.decisionId, first.decisionId);
    assert.equal(replay.assignmentId, first.assignmentId);
    assert.equal(await fixture.db.assignment.count(), 1);
    assert.equal(await fixture.db.decision.count(), 1);
    const assignment = await fixture.db.assignment.findFirstOrThrow();
    const decision = await fixture.db.decision.findFirstOrThrow();
    assert.equal(assignment.randomizationUnitType, "CONSENTED_PERSISTENT_VISITOR");
    assert.notEqual(assignment.randomizationUnitId, input.visitorToken);
    assert.notEqual(decision.sessionId, input.sessionId);
    assert.equal(assignment.expiresAt.toISOString(), "2026-09-12T00:00:00.000Z");
    assert.ok(first.measurementReference);
    assert.equal(verifyV2MeasurementReference(first.measurementReference!, environment.ASSIGNMENT_SECRET)?.assignmentId, assignment.id);
    assert.equal(verifyV2MeasurementReference(`${first.measurementReference!.slice(0, -1)}x`, environment.ASSIGNMENT_SECRET), null);
    assert.equal(first.content === null, first.serving === "ORIGINAL");
  } finally { await fixture.close(); }
});

test("control assignments use the frozen policy and receive the signed order bridge", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1006");
    const experiment = await seedExperiment(
      fixture.db,
      seeded,
      "effect-1006",
      "UNIVERSAL",
      "MATCHED",
    );
    await fixture.db.experiment.update({
      where: { id: experiment.id },
      data: { controlPercentage: 100 },
    });
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: experiment.id,
      contentVersionId: seeded.experience.id, policy: "MATCHED",
      approvedAuthorityHash: "6".repeat(64), expectedRevision: 0,
      idempotencyKey: "universal-matched-start" });
    const result = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId), environment,
      now: new Date("2026-09-05T00:00:00.000Z") });
    assert.equal(result.serving, "UNIVERSAL");
    assert.ok(result.content);
    assert.ok(result.measurementReference);
    assert.ok(result.decisionId);
    assert.equal((await fixture.db.assignment.findFirstOrThrow()).arm, "ORIGINAL");
  } finally { await fixture.close(); }
});

test("closed enrollment preserves an existing cohort and gives new visitors baseline", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1007");
    const experiment = await seedExperiment(fixture.db, seeded, "effect-1007");
    await fixture.db.experiment.update({
      where: { id: experiment.id },
      data: { controlPercentage: 0 },
    });
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: experiment.id,
      contentVersionId: seeded.experience.id, policy: "UNIVERSAL",
      approvedAuthorityHash: "7".repeat(64), expectedRevision: 0,
      idempotencyKey: "effect-start" });
    const assignedAt = new Date("2026-09-05T00:00:00.000Z");
    const first = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId), environment, now: assignedAt });
    assert.equal(first.serving, "UNIVERSAL");
    await fixture.db.experiment.update({
      where: { id: experiment.id },
      data: { enrollmentClosedAt: new Date("2026-09-06T00:00:00.000Z"), status: "COMPLETED" },
    });
    const existing = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId, "request_0002"), environment,
      now: new Date("2026-09-06T12:00:00.000Z") });
    assert.equal(existing.serving, "UNIVERSAL");
    assert.equal(existing.assignmentId, first.assignmentId);
    assert.ok(existing.measurementReference);
    const newcomer = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId, "request_0003", "visitor_token_0002", "session_token_0002"),
      environment, now: new Date("2026-09-06T12:00:00.000Z") });
    assert.equal(newcomer.serving, "ORIGINAL");
    assert.equal(newcomer.reason, "EXPERIMENT_NOT_ENROLLING");
    assert.equal(newcomer.assignmentId, null);
    assert.equal(await fixture.db.assignment.count(), 1);
  } finally { await fixture.close(); }
});

test("an idempotent replay after assignment expiry returns baseline without renewal", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1008");
    const experiment = await seedExperiment(
      fixture.db,
      seeded,
      "effect-1008",
      "UNIVERSAL",
      "MATCHED",
    );
    await fixture.db.experiment.update({ where: { id: experiment.id }, data: { controlPercentage: 0 } });
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: experiment.id,
      contentVersionId: seeded.experience.id, policy: "MATCHED",
      approvedAuthorityHash: "8".repeat(64), expectedRevision: 0,
      idempotencyKey: "effect-start" });
    const input = request(seeded.product.shopifyProductId);
    const first = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: input, environment, now: new Date("2026-09-05T00:00:00.000Z") });
    assert.ok(first.measurementReference);
    const expired = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: input, environment, now: new Date("2026-09-12T00:00:00.000Z") });
    assert.equal(expired.serving, "UNIVERSAL");
    assert.equal(expired.reason, "ASSIGNMENT_EXPIRED");
    assert.equal(expired.assignmentId, null);
    assert.equal(expired.measurementReference, null);
    assert.ok(expired.content);
    assert.equal(await fixture.db.assignment.count(), 1);
    assert.equal((await fixture.db.assignment.findFirstOrThrow()).expiresAt.toISOString(), "2026-09-12T00:00:00.000Z");
  } finally { await fixture.close(); }
});

test("pause and enrollment deadline fail immediately to Original without enrollment", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1003");
    const experiment = await seedExperiment(fixture.db, seeded, "effect-1003");
    await installV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id,
      productId: seeded.product.id, experimentId: experiment.id, contentVersionId: seeded.experience.id,
      policy: "UNIVERSAL", approvedAuthorityHash: "e".repeat(64), expectedRevision: 0, idempotencyKey: "start" });
    const deadline = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId), environment, now: new Date("2026-10-20T00:00:00.000Z") });
    assert.equal(deadline.reason, "EXPERIMENT_ENROLLMENT_DEADLINE");
    assert.equal(await fixture.db.assignment.count(), 0);
    await pauseV2Deployment({ db: fixture.db, merchantId: seeded.merchant.id, productId: seeded.product.id,
      approvedAuthorityHash: "f".repeat(64), expectedRevision: 1, idempotencyKey: "pause" });
    const paused = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId, "request_0002"), environment,
      now: new Date("2026-09-05T00:00:00.000Z") });
    assert.equal(paused.serving, "ORIGINAL");
    assert.equal(paused.reason, "DEPLOYMENT_PAUSED");
  } finally { await fixture.close(); }
});

test("baseline counts consented product visitors before decisions once", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1004");
    const start = new Date("2026-09-01T00:00:00.000Z");
    const end = new Date("2026-09-08T00:00:00.000Z");
    await fixture.db.commerceEvent.createMany({ data: [
      { merchantId: seeded.merchant.id, eventId: "view-before", source: "SHOPIFY_PIXEL", eventType: "product_viewed", occurredAt: start, clientId: "client-a", productId: seeded.product.shopifyProductId, consentState: "analytics_and_preferences_allowed" },
      { merchantId: seeded.merchant.id, eventId: "view-repeat", source: "SHOPIFY_PIXEL", eventType: "product_viewed", occurredAt: new Date(start.getTime() + 1000), clientId: "client-a", productId: seeded.product.shopifyProductId, consentState: "analytics_and_preferences_allowed" },
      { merchantId: seeded.merchant.id, eventId: "view-second", source: "SHOPIFY_PIXEL", eventType: "product_viewed", occurredAt: new Date(start.getTime() + 2000), clientId: "client-b", productId: seeded.product.shopifyProductId, consentState: "analytics_and_preferences_allowed" },
      { merchantId: seeded.merchant.id, eventId: "analytics-only", source: "SHOPIFY_PIXEL", eventType: "product_viewed", occurredAt: new Date(start.getTime() + 3000), clientId: "client-c", productId: seeded.product.shopifyProductId, consentState: "analytics_allowed" },
    ] });
    const capture = await loadV2BaselineCapture({ db: fixture.db, merchantId: seeded.merchant.id,
      shopifyProductId: seeded.product.shopifyProductId, observationStart: start, observationEnd: end });
    assert.equal(capture.uniqueEvents, 3);
    assert.equal(capture.eligibleVisitors, 2);
    assert.equal(capture.eligibleSessions, 0);
    assert.equal(capture.missingSessionEvents, 3);
    assert.equal(capture.qualificationUsable, false);
    assert.equal(capture.decisionsObserved, 0);
  } finally { await fixture.close(); }
});

test("invalid consent and disabled v2 never persist shopper identity", async () => {
  assert.throws(() => parseDecisionRequestV2({ ...request("gid://shopify/Product/1005"),
    consent: { analytics: true, preferences: false, policyVersion: "v1" } }), V2DecisionRequestError);
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "1005");
    const result = await resolveV2Decision({ db: fixture.db, shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId), environment: { PAGNETIC_V2_ENABLED: "false" } });
    assert.equal(result.reason, "V2_DISABLED");
    assert.equal(await fixture.db.decision.count(), 0);
    assert.equal(await fixture.db.assignment.count(), 0);
    assert.equal(await fixture.db.actionReceipt.count(), 0);
  } finally { await fixture.close(); }
});

test("global v2 remains disabled outside the exact runtime shop allowlist", async () => {
  const fixture = testDatabase();
  try {
    const seeded = await seedRuntime(fixture.db, "9999");
    const result = await resolveV2Decision({
      db: fixture.db,
      shop: seeded.merchant.shop,
      request: request(seeded.product.shopifyProductId, "request_not_allowlisted"),
      environment,
    });
    assert.equal(result.reason, "V2_DISABLED");
  } finally { await fixture.close(); }
});

test("runtime shop allowlist scopes unversioned ingestion without weakening explicit v2 consent", async () => {
  const fixture = testDatabase();
  try {
    const selected = await seedRuntime(fixture.db, "9101");
    const other = await seedRuntime(fixture.db, "9102");
    const selectedToken = "selected-pixel-token-at-least-32-characters";
    const otherToken = "other-pixel-token-at-least-32-characters";
    await fixture.db.pixelCredential.createMany({ data: [
      { merchantId: selected.merchant.id, tokenHash: hashPixelToken(selectedToken), endpoint: "https://example.test/events", status: "ACTIVE" },
      { merchantId: other.merchant.id, tokenHash: hashPixelToken(otherToken), endpoint: "https://example.test/events", status: "ACTIVE" },
    ] });
    const scopedEnvironment = {
      PAGNETIC_V2_ENABLED: "true",
      PAGNETIC_V2_ENABLED_SHOPS: selected.merchant.shop,
      ASSIGNMENT_SECRET: "a".repeat(64),
    };
    const now = new Date("2026-09-12T00:01:00.000Z");
    const base = {
      schemaVersion: 1,
      eventType: "product_viewed",
      occurredAt: "2026-09-12T00:00:00.000Z",
      consentState: "analytics_allowed",
      clientId: "shopify-client-ingestion-scope",
      data: {},
    };
    const legacyOther = await ingestPixelEvent({
      db: fixture.db,
      now,
      environment: scopedEnvironment,
      payload: { ...base, shop: other.merchant.shop, token: otherToken, eventId: "legacy-other" },
    });
    assert.equal(legacyOther.accepted, true, JSON.stringify(legacyOther));

    const explicitV2Other = await ingestPixelEvent({
      db: fixture.db,
      now,
      environment: scopedEnvironment,
      payload: { ...base, schemaVersion: 2, shop: other.merchant.shop, token: otherToken, eventId: "explicit-v2-other" },
    });
    assert.equal(explicitV2Other.reason, "consent_not_allowed");

    const selectedUnversioned = await ingestPixelEvent({
      db: fixture.db,
      now,
      environment: scopedEnvironment,
      payload: { ...base, shop: selected.merchant.shop, token: selectedToken, eventId: "selected-unversioned" },
    });
    assert.equal(selectedUnversioned.reason, "consent_not_allowed");
  } finally { await fixture.close(); }
});

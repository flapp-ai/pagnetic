import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { resumeAutopilotPlan } from "../app/services/autopilot-orchestrator.server";
import { reconcileBetaEntitlement } from "../app/services/beta-entitlement.server";
import {
  loadV2ExperimentAnalysis,
  snapshotV2ExperimentReport,
} from "../app/services/experiment-report-v2.server";
import { closeV2EnrollmentIfDue } from "../app/services/experiment-lifecycle-v2.server";
import {
  enqueueV2LifecycleJobs,
  runV2LifecycleJobs,
} from "../app/services/lifecycle-worker-v2.server";
import {
  invalidateExperimentsForPrivacy,
  PrivacyAnalysisRestrictedError,
} from "../app/services/privacy-analysis.server";
import {
  keepV2Message,
  reviseV2Result,
} from "../app/services/result-actions-v2.server";
import {
  MVP_V2_PRIMARY_METRIC,
  MVP_V2_PROTOCOL_VERSION,
} from "../app/services/mvp-v2";

const now = new Date("2026-09-05T12:00:00.000Z");

function testDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-analysis-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort())
    execFileSync("sqlite3", [database], {
      input: readFileSync(
        join("prisma/migrations", migration, "migration.sql"),
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function registeredExperiment(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  suffix: string;
  status: string;
  finalized?: boolean;
}) {
  const experiment = await args.db.experiment.create({
    data: {
      merchantId: args.merchantId,
      productId: args.productId,
      key: `privacy-analysis-${args.suffix}`,
      salt: `privacy-analysis-salt-${args.suffix}`,
      lifecycleVersion: 2,
      controlPolicy: "ORIGINAL",
      treatmentPolicy: "UNIVERSAL",
      status: args.status,
      enrollmentStartedAt: new Date("2026-08-01T00:00:00.000Z"),
      enrollmentClosedAt: args.finalized
        ? new Date("2026-08-15T00:00:00.000Z")
        : null,
      attributionClosesAt: args.finalized
        ? new Date("2026-08-22T00:00:00.000Z")
        : null,
      financialMaturityAt: args.finalized
        ? new Date("2026-08-29T00:00:00.000Z")
        : null,
      finalizedAt: args.finalized ? new Date("2026-08-29T00:01:00.000Z") : null,
      registration: {
        create: {
          protocolVersion: MVP_V2_PROTOCOL_VERSION,
          hypothesis: "Synthetic privacy-analysis fixture.",
          primaryMetric: MVP_V2_PRIMARY_METRIC,
          revenueDefinition: "NET_FOCAL_MERCHANDISE",
          minimumMeaningfulLift: 0.05,
          alpha: 0.05,
          power: 0.8,
          targetSampleSize: 2_000,
          minimumDurationDays: 7,
          maximumDurationDays: 42,
          randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
          eligibilityJson: "{}",
          exclusionsJson: "[]",
          covariatesJson: "[]",
          stoppingRule: "FIXED_COHORT_V2",
          analysisVersion: "visitor-revenue-v2",
          contentVersionsJson: "[]",
          mappingVersionsJson: "[]",
          guardrailsJson: "{}",
          registrationHash: `privacy-analysis-registration-${args.suffix}`,
        },
      },
    },
  });
  if (!args.finalized) return { experiment, snapshot: null };
  const snapshot = await args.db.experimentResultSnapshot.create({
    data: {
      experimentId: experiment.id,
      analysisVersion: "visitor-revenue-v2",
      resultState: "POSITIVE",
      dataMaturityAt: new Date("2026-08-29T00:00:00.000Z"),
      dataHash: `privacy-analysis-result-${args.suffix}`,
      payloadJson: JSON.stringify({
        analysis: {
          resultState: "POSITIVE",
          estimatedAdditionalSalesMinor: "12345",
        },
      }),
      reportMarkdown: "# Immutable positive result",
    },
  });
  const current = await args.db.experiment.update({
    where: { id: experiment.id },
    data: { finalResultSnapshotId: snapshot.id },
  });
  return { experiment: current, snapshot };
}

test("privacy invalidation preserves frozen evidence while stopping serving, automation and result consumption", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "privacy-analysis.myshopify.com" },
    });
    const product = await fixture.db.product.create({
      data: {
        merchantId: merchant.id,
        shopifyProductId: "gid://shopify/Product/501",
        title: "Privacy analysis product",
        handle: "privacy-analysis-product",
        status: "ACTIVE",
        sourceVersion: "1",
        sourceHash: "privacy-analysis-source",
        sourceSnapshot: "{}",
      },
    });
    const final = await registeredExperiment({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      suffix: "final",
      status: "COMPLETED",
      finalized: true,
    });
    assert.ok(final.snapshot);
    const unfinished = await registeredExperiment({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      suffix: "unfinished",
      status: "ACTIVE",
    });
    const score = await fixture.db.productCandidateScore.create({
      data: {
        merchantId: merchant.id,
        productId: product.id,
        scoringVersion: "candidate-v1",
        inputAvailabilityJson: "{}",
        componentScoresJson: "{}",
        totalScore: 90,
        qualificationBand: "READY",
        durationBand: "DAYS_14_TO_30",
      },
    });
    const plan = await fixture.db.autopilotPlan.create({
      data: {
        merchantId: merchant.id,
        productId: product.id,
        candidateScoreId: score.id,
        version: 1,
        state: "RESULT_READY",
        planHash: "privacy-analysis-plan-hash",
        candidateScoreSnapshotJson: "{}",
        contentVersionIdsJson: "[]",
        contentHashesJson: "[]",
        evidenceSnapshotHash: "privacy-analysis-evidence",
        aaProtocolJson: "{}",
        realExperimentProtocolJson: "{}",
        safetyPolicyVersion: "privacy-analysis-safety",
        authorizedTransitionsJson: "[]",
        realExperimentId: final.experiment.id,
        resultSnapshotId: final.snapshot.id,
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      },
    });
    const deployment = await fixture.db.deploymentVersion.create({
      data: {
        merchantId: merchant.id,
        productId: product.id,
        planId: plan.id,
        experimentId: final.experiment.id,
        revision: 1,
        protocolVersion: MVP_V2_PROTOCOL_VERSION,
        policy: "UNIVERSAL",
        contentSetHash: "a".repeat(64),
        state: "ACTIVE",
        approvedAuthorityHash: "b".repeat(64),
        canonicalPayload: "{}",
      },
    });
    await fixture.db.activeDeployment.create({
      data: {
        merchantId: merchant.id,
        productId: product.id,
        deploymentVersionId: deployment.id,
        revision: 1,
      },
    });
    await fixture.db.betaEntitlement.create({
      data: {
        merchantId: merchant.id,
        status: "CONTINUATION_OFFER",
        firstValidResultAt: final.snapshot.createdAt,
        firstValidResultState: "POSITIVE",
        firstValidResultSnapshotId: final.snapshot.id,
        lastResultSnapshotId: final.snapshot.id,
        lastResultState: "POSITIVE",
      },
    });
    const originalPayload = final.snapshot.payloadJson;
    const result = await fixture.db.$transaction((tx) =>
      invalidateExperimentsForPrivacy(tx, {
        merchantId: merchant.id,
        experimentIds: [final.experiment.id, unfinished.experiment.id],
        now,
      }),
    );
    assert.equal(result.newlyRestricted, 2);
    assert.equal(result.pausedExperiments, 1);
    assert.deepEqual(result.pausedPlanIds, [plan.id]);
    assert.equal(result.stoppedDeploymentIds.length, 1);

    const savedFinal = await fixture.db.experiment.findUniqueOrThrow({
      where: { id: final.experiment.id },
    });
    const savedUnfinished = await fixture.db.experiment.findUniqueOrThrow({
      where: { id: unfinished.experiment.id },
    });
    assert.equal(savedFinal.status, "COMPLETED");
    assert.equal(savedFinal.finalResultSnapshotId, final.snapshot.id);
    assert.equal(
      savedFinal.privacyAffectedAt?.toISOString(),
      now.toISOString(),
    );
    assert.equal(savedUnfinished.status, "PAUSED");
    assert.equal(
      savedUnfinished.privacyAffectedAt?.toISOString(),
      now.toISOString(),
    );
    assert.equal(
      (
        await fixture.db.experimentResultSnapshot.findUniqueOrThrow({
          where: { id: final.snapshot.id },
        })
      ).payloadJson,
      originalPayload,
    );
    const pointer = await fixture.db.activeDeployment.findUniqueOrThrow({
      where: { productId: product.id },
      include: { deploymentVersion: true },
    });
    assert.equal(pointer.revision, 2);
    assert.equal(pointer.deploymentVersion.policy, "ORIGINAL");
    assert.equal(pointer.deploymentVersion.state, "STOPPED");
    assert.equal(
      (
        await fixture.db.runtimeControl.findUniqueOrThrow({
          where: { merchantId: merchant.id },
        })
      ).killSwitch,
      true,
    );
    assert.equal(
      (
        await fixture.db.autopilotPlan.findUniqueOrThrow({
          where: { id: plan.id },
        })
      ).state,
      "PAUSED",
    );
    const entitlement = await fixture.db.betaEntitlement.findUniqueOrThrow({
      where: { merchantId: merchant.id },
    });
    assert.equal(entitlement.status, "FREE_UNTIL_VALID_RESULT");
    assert.equal(entitlement.firstValidResultSnapshotId, null);
    assert.equal(entitlement.lastResultSnapshotId, null);
    assert.equal(entitlement.lastResultState, "PRIVACY_REVIEW_REQUIRED");

    await assert.rejects(
      loadV2ExperimentAnalysis({
        db: fixture.db,
        merchantId: merchant.id,
        experimentId: final.experiment.id,
        healthState: "READY",
        now,
      }),
      PrivacyAnalysisRestrictedError,
    );
    await assert.rejects(
      snapshotV2ExperimentReport({
        db: fixture.db,
        merchantId: merchant.id,
        experimentId: final.experiment.id,
        healthState: "READY",
        now,
      }),
      PrivacyAnalysisRestrictedError,
    );
    await assert.rejects(
      keepV2Message({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "owner",
        resultSnapshotId: final.snapshot.id,
        contentVersionId: "withheld-content",
        expectedRevision: 2,
        idempotencyKey: "privacy-keep-result",
        now,
      }),
      PrivacyAnalysisRestrictedError,
    );
    await assert.rejects(
      reviseV2Result({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "owner",
        resultSnapshotId: final.snapshot.id,
        reason: "Do not reuse a privacy-restricted result.",
        idempotencyKey: "privacy-revise-result",
      }),
      PrivacyAnalysisRestrictedError,
    );
    await assert.rejects(
      reconcileBetaEntitlement({
        db: fixture.db,
        merchantId: merchant.id,
        snapshotId: final.snapshot.id,
      }),
      PrivacyAnalysisRestrictedError,
    );
    await assert.rejects(
      resumeAutopilotPlan({
        db: fixture.db,
        merchantId: merchant.id,
        planId: plan.id,
        actor: "owner",
      }),
      /PRIVACY_ANALYSIS_REVIEW_REQUIRED/,
    );
    await assert.rejects(
      closeV2EnrollmentIfDue({
        db: fixture.db,
        merchantId: merchant.id,
        experimentId: unfinished.experiment.id,
        now,
        stopReason: "SAFETY_STOP",
      }),
      PrivacyAnalysisRestrictedError,
    );

    await fixture.db.job.create({
      data: {
        merchantId: merchant.id,
        type: "CLOSE_ENROLLMENT",
        idempotencyKey: `privacy-analysis-close-${unfinished.experiment.id}`,
        inputHash: "privacy-analysis-close-input",
        payloadSchemaVersion: 2,
        payloadJson: JSON.stringify({ experimentId: unfinished.experiment.id }),
        status: "PENDING",
        nextRunAt: now,
      },
    });
    const lifecycle = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: merchant.id,
      workerId: "privacy-analysis-worker",
      now,
    });
    assert.equal(lifecycle[0]?.resultRef, "SKIPPED_PRIVACY_ANALYSIS_REVIEW");
    assert.deepEqual(
      await enqueueV2LifecycleJobs({
        db: fixture.db,
        merchantId: merchant.id,
        now,
      }),
      [],
    );

    const replayAt = new Date(now.getTime() + 60_000);
    const replay = await fixture.db.$transaction((tx) =>
      invalidateExperimentsForPrivacy(tx, {
        merchantId: merchant.id,
        experimentIds: [final.experiment.id, unfinished.experiment.id],
        now: replayAt,
      }),
    );
    assert.equal(replay.newlyRestricted, 0);
    assert.equal(replay.stoppedDeploymentIds.length, 0);
    assert.equal(
      (
        await fixture.db.experiment.findUniqueOrThrow({
          where: { id: final.experiment.id },
        })
      ).privacyAffectedAt?.toISOString(),
      now.toISOString(),
    );
    assert.equal(
      await fixture.db.deploymentVersion.count({
        where: { productId: product.id },
      }),
      2,
    );
  } finally {
    await fixture.close();
  }
});

test("privacy analysis invalidation rejects duplicate, oversized and cross-tenant scopes atomically", async () => {
  const fixture = testDatabase();
  try {
    const firstMerchant = await fixture.db.merchant.create({
      data: { shop: "privacy-analysis-scope.myshopify.com" },
    });
    const secondMerchant = await fixture.db.merchant.create({
      data: { shop: "privacy-analysis-foreign.myshopify.com" },
    });
    const product = await fixture.db.product.create({
      data: {
        merchantId: secondMerchant.id,
        shopifyProductId: "gid://shopify/Product/991",
        title: "Foreign privacy product",
        handle: "foreign-privacy-product",
        status: "ACTIVE",
        sourceVersion: "1",
        sourceHash: "foreign-source",
        sourceSnapshot: "{}",
      },
    });
    const foreign = await registeredExperiment({
      db: fixture.db,
      merchantId: secondMerchant.id,
      productId: product.id,
      suffix: "foreign",
      status: "ACTIVE",
    });
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        invalidateExperimentsForPrivacy(tx, {
          merchantId: firstMerchant.id,
          experimentIds: [foreign.experiment.id],
          now,
        }),
      ),
      /PRIVACY_ANALYSIS_EXPERIMENT_NOT_FOUND/,
    );
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        invalidateExperimentsForPrivacy(tx, {
          merchantId: secondMerchant.id,
          experimentIds: [foreign.experiment.id, foreign.experiment.id],
          now,
        }),
      ),
      /PRIVACY_ANALYSIS_SCOPE_INVALID/,
    );
    await assert.rejects(
      fixture.db.$transaction((tx) =>
        invalidateExperimentsForPrivacy(tx, {
          merchantId: secondMerchant.id,
          experimentIds: Array.from(
            { length: 101 },
            (_, index) => `experiment-${index}`,
          ),
          now,
        }),
      ),
      /PRIVACY_ANALYSIS_SCOPE_INVALID/,
    );
    assert.equal(await fixture.db.runtimeControl.count(), 0);
    assert.equal(
      (
        await fixture.db.experiment.findUniqueOrThrow({
          where: { id: foreign.experiment.id },
        })
      ).privacyAffectedAt,
      null,
    );
  } finally {
    await fixture.close();
  }
});

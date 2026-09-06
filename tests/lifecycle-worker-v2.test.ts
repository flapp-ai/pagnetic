import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  enqueueV2LifecycleJobs,
  runV2LifecycleJobs,
} from "../app/services/lifecycle-worker-v2.server";
import { enqueueJob } from "../app/services/job-outbox.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../app/services/mvp-v2";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-lifecycle-worker-v2-"));
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

async function seedExperiment(db: PrismaClient, suffix: string, startedAt: Date, maximumDurationDays = 42) {
  const merchant = await db.merchant.create({ data: { shop: `lifecycle-${suffix}.myshopify.com` } });
  const product = await db.product.create({ data: {
    merchantId: merchant.id,
    shopifyProductId: `gid://shopify/Product/${suffix}`,
    title: "Trail Runner",
    handle: `trail-runner-${suffix}`,
    status: "ACTIVE",
    sourceVersion: "source-v1",
    sourceHash: `source-${suffix}`,
    sourceSnapshot: "{}",
  } });
  const experiment = await db.experiment.create({ data: {
    merchantId: merchant.id,
    productId: product.id,
    key: `lifecycle-${suffix}`,
    salt: `salt-${suffix}`,
    controlPolicy: "ORIGINAL",
    treatmentPolicy: "UNIVERSAL",
    startedAt,
    enrollmentStartedAt: startedAt,
    lifecycleVersion: 2,
    registration: { create: {
      protocolVersion: MVP_V2_PROTOCOL_VERSION,
      hypothesis: "A source-backed message changes focal revenue.",
      primaryMetric: MVP_V2_PRIMARY_METRIC,
      revenueDefinition: "NET_FOCAL_MERCHANDISE",
      minimumMeaningfulLift: 0.05,
      alpha: 0.05,
      power: 0.8,
      targetSampleSize: 2_000,
      minimumDurationDays: 7,
      maximumDurationDays,
      randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
      eligibilityJson: "{}",
      exclusionsJson: "[]",
      covariatesJson: "[]",
      stoppingRule: "FIXED_COHORT_V2",
      analysisVersion: "welch-assigned-visitor-v2.1",
      contentVersionsJson: "[]",
      mappingVersionsJson: "[]",
      guardrailsJson: "{}",
      dataMaturityLagDays: 0,
      registrationHash: `registration-${suffix}`,
    } },
  } });
  return { merchant, experiment };
}

test("durable lifecycle jobs close at the deadline then persist one final report", async () => {
  const fixture = testDatabase();
  try {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const startedAt = new Date(now.getTime() - 42 * 86_400_000);
    const seeded = await seedExperiment(fixture.db, "deadline", startedAt);
    await enqueueV2LifecycleJobs({ db: fixture.db, merchantId: seeded.merchant.id, now });
    const close = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      workerId: "lifecycle-worker-a",
      now,
    });
    assert.equal(close.length, 1);
    assert.equal(close[0]?.resultRef, "CLOSED");
    assert.equal((await fixture.db.experiment.findUniqueOrThrow({
      where: { id: seeded.experiment.id },
    })).enrollmentClosedAt?.toISOString(), now.toISOString());

    const finalize = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      workerId: "lifecycle-worker-b",
      now,
    });
    assert.equal(finalize.length, 1);
    assert.equal(finalize[0]?.ok, true);
    const completed = await fixture.db.experiment.findUniqueOrThrow({
      where: { id: seeded.experiment.id },
    });
    assert.ok(completed.finalResultSnapshotId);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(await fixture.db.experimentResultSnapshot.count({
      where: { experimentId: seeded.experiment.id },
    }), 1);
    assert.ok(await fixture.db.betaEntitlement.findUnique({
      where: { merchantId: seeded.merchant.id },
    }));
    assert.deepEqual(await enqueueV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      now,
    }), []);
  } finally {
    await fixture.close();
  }
});

test("an early under-target lifecycle check completes and schedules one bounded successor", async () => {
  const fixture = testDatabase();
  try {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const seeded = await seedExperiment(
      fixture.db,
      "early",
      new Date(now.getTime() - 8 * 86_400_000),
    );
    const other = await seedExperiment(
      fixture.db,
      "other-tenant",
      new Date(now.getTime() - 8 * 86_400_000),
    );
    await enqueueV2LifecycleJobs({ db: fixture.db, merchantId: seeded.merchant.id, now });
    await enqueueV2LifecycleJobs({ db: fixture.db, merchantId: other.merchant.id, now });
    await enqueueV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      now: new Date(now.getTime() + 60_000),
    });
    assert.equal(await fixture.db.job.count({
      where: { merchantId: seeded.merchant.id, type: "CLOSE_ENROLLMENT" },
    }), 1);
    const result = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      workerId: "lifecycle-worker-tenant",
      now,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.resultRef, "ENROLLING");
    assert.equal(await fixture.db.job.count({
      where: { merchantId: seeded.merchant.id, type: "CLOSE_ENROLLMENT", status: "COMPLETED" },
    }), 1);
    const successor = await fixture.db.job.findFirstOrThrow({
      where: { merchantId: seeded.merchant.id, type: "CLOSE_ENROLLMENT", status: "PENDING" },
    });
    assert.equal(successor.nextRunAt.toISOString(), new Date(now.getTime() + 6 * 60 * 60_000).toISOString());
    await enqueueV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      now: new Date(now.getTime() + 2 * 60_000),
    });
    assert.equal(await fixture.db.job.count({
      where: { merchantId: seeded.merchant.id, type: "CLOSE_ENROLLMENT" },
    }), 2, "maintenance must not create a parallel lifecycle chain");
    assert.equal(await fixture.db.job.count({
      where: { merchantId: other.merchant.id, status: "PENDING" },
    }), 1);
  } finally {
    await fixture.close();
  }
});

test("dead-lettered lifecycle chains require operator retry and pause closes without blocking maturity", async () => {
  const fixture = testDatabase();
  try {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const seeded = await seedExperiment(
      fixture.db,
      "dead-letter",
      new Date(now.getTime() - 8 * 86_400_000),
    );
    await enqueueV2LifecycleJobs({ db: fixture.db, merchantId: seeded.merchant.id, now });
    const rootJob = await fixture.db.job.findFirstOrThrow({
      where: { merchantId: seeded.merchant.id, type: "CLOSE_ENROLLMENT" },
    });
    await fixture.db.job.update({
      where: { id: rootJob.id },
      data: { status: "DEAD_LETTER", attempts: 48, lastErrorCode: "ATTEMPTS_EXHAUSTED" },
    });
    await enqueueV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      now: new Date(now.getTime() + 86_400_000),
    });
    assert.equal(await fixture.db.job.count({
      where: { merchantId: seeded.merchant.id, type: "CLOSE_ENROLLMENT" },
    }), 1);

    const paused = await seedExperiment(
      fixture.db,
      "paused",
      new Date(now.getTime() - 42 * 86_400_000),
    );
    const pausedJob = await enqueueJob({
      db: fixture.db,
      merchantId: paused.merchant.id,
      type: "CLOSE_ENROLLMENT",
      idempotencyKey: `v2-close:${paused.experiment.id}:root`,
      payloadSchemaVersion: 2,
      payload: { experimentId: paused.experiment.id },
      nextRunAt: now,
    });
    await fixture.db.experiment.update({
      where: { id: paused.experiment.id },
      data: { status: "PAUSED", endedAt: now },
    });
    await fixture.db.runtimeControl.create({
      data: {
        merchantId: paused.merchant.id,
        killSwitch: true,
        reason: "Merchant paused Pagnetic",
        activatedAt: now,
      },
    });
    const skipped = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: paused.merchant.id,
      workerId: "lifecycle-worker-paused",
      now,
    });
    assert.equal(skipped[0]?.resultRef, "CLOSED");
    assert.equal((await fixture.db.job.findUniqueOrThrow({ where: { id: pausedJob.id } })).status, "COMPLETED");
    const interrupted = await fixture.db.experiment.findUniqueOrThrow({
      where: { id: paused.experiment.id },
    });
    assert.equal(interrupted.enrollmentClosedAt?.toISOString(), now.toISOString());
    assert.equal(interrupted.stopReason, "MERCHANT_PAUSE");
    assert.equal(interrupted.status, "ENROLLMENT_CLOSED");
    assert.equal(await fixture.db.job.count({
      where: { merchantId: paused.merchant.id, type: "FINALIZE_RESULT", status: "PENDING" },
    }), 1, "pause must keep financial maturation/finalization scheduled");
    await enqueueV2LifecycleJobs({
      db: fixture.db,
      merchantId: paused.merchant.id,
      now: new Date(now.getTime() + 86_400_000),
    });
    assert.equal(await fixture.db.job.count({
      where: { merchantId: paused.merchant.id, type: "FINALIZE_RESULT" },
    }), 1);
    const finalized = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: paused.merchant.id,
      workerId: "lifecycle-worker-paused-finalize",
      now,
    });
    assert.equal(finalized[0]?.ok, true);
    const finalExperiment = await fixture.db.experiment.findUniqueOrThrow({
      where: { id: paused.experiment.id },
    });
    assert.equal(finalExperiment.status, "COMPLETED");
    assert.ok(finalExperiment.finalResultSnapshotId);
    assert.equal((await fixture.db.experimentResultSnapshot.findUniqueOrThrow({
      where: { id: finalExperiment.finalResultSnapshotId! },
    })).resultState, "INTERRUPTED");
  } finally {
    await fixture.close();
  }
});

test("malformed lifecycle work is retried without mutating an experiment", async () => {
  const fixture = testDatabase();
  try {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const seeded = await seedExperiment(
      fixture.db,
      "malformed",
      new Date(now.getTime() - 42 * 86_400_000),
    );
    const job = await enqueueJob({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      type: "CLOSE_ENROLLMENT",
      idempotencyKey: "malformed-lifecycle-job",
      payloadSchemaVersion: 2,
      payload: { experimentId: seeded.experiment.id, injected: true },
      nextRunAt: now,
    });
    const outcome = await runV2LifecycleJobs({
      db: fixture.db,
      merchantId: seeded.merchant.id,
      workerId: "lifecycle-worker-malformed",
      now,
    });
    assert.equal(outcome[0]?.ok, false);
    const failed = await fixture.db.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(failed.status, "RETRY");
    assert.equal(failed.lastErrorCode, "V2_LIFECYCLE_JOB_PAYLOAD_INVALID");
    assert.equal((await fixture.db.experiment.findUniqueOrThrow({
      where: { id: seeded.experiment.id },
    })).enrollmentClosedAt, null);
  } finally {
    await fixture.close();
  }
});

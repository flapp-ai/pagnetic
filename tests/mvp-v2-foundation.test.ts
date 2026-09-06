import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  claimJobs,
  claimOutboxEvents,
  completeJob,
  enqueueJob,
  enqueueOutboxEvent,
  markOutboxDelivered,
  QueueIdempotencyConflictError,
} from "../app/services/job-outbox.server";
import {
  MVP_V2_PRIMARY_METRIC,
  MVP_V2_PROTOCOL_VERSION,
  mvpV2Config,
} from "../app/services/mvp-v2";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-v2-foundation-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((entry) => /^\d/.test(entry))
    .sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("additive migration preserves legacy registration and assignment semantics", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-v2-upgrade-"));
  const databasePath = path.join(directory, "upgrade.sqlite");
  const migrations = readdirSync("prisma/migrations")
    .filter((entry) => /^\d/.test(entry))
    .sort();
  try {
    for (const migration of migrations.filter(
      (entry) => entry < "20260905120000_mvp_v2_foundation",
    )) {
      execFileSync("sqlite3", [databasePath], {
        input: readFileSync(
          path.join("prisma/migrations", migration, "migration.sql"),
        ),
      });
    }
    execFileSync("sqlite3", [databasePath], {
      input: `
        INSERT INTO "Merchant" ("id","shop","createdAt","updatedAt","installedAt","apiVersion","grantedScopesJson")
        VALUES ('legacy-m','legacy.myshopify.com',1788220800000,1788220800000,1788220800000,'2026-07','[]');
        INSERT INTO "Product" ("id","merchantId","shopifyProductId","title","handle","status","sourceVersion","sourceHash","sourceSnapshot","syncedAt","updatedAt")
        VALUES ('legacy-p','legacy-m','gid://shopify/Product/1','Legacy','legacy','ACTIVE','v1','source-hash','{}',1788220800000,1788220800000);
        INSERT INTO "Experiment" ("id","merchantId","productId","key","version","status","salt","saltVersion","controlPercentage","controlPolicy","treatmentPolicy","attributionWindowDays","startedAt","createdAt")
        VALUES ('legacy-e','legacy-m','legacy-p','legacy-rps',1,'ACTIVE','salt',1,50,'ORIGINAL','UNIVERSAL',7,1788220800000,1788220800000);
        INSERT INTO "ExperimentRegistration" ("id","experimentId","protocolVersion","hypothesis","primaryMetric","revenueDefinition","minimumMeaningfulLift","alpha","power","targetSampleSize","minimumDurationDays","maximumDurationDays","randomizationUnit","eligibilityJson","exclusionsJson","covariatesJson","stoppingRule","analysisVersion","contentVersionsJson","mappingVersionsJson","guardrailsJson","dataMaturityLagDays","registrationHash","registeredAt")
        VALUES ('legacy-r','legacy-e','pilot-rps-v1','legacy hypothesis','REVENUE_PER_SESSION','NET',0.05,0.05,0.8,1000,14,42,'SESSION','{}','[]','[]','FIXED','cluster-rps-v1','[]','[]','{}',7,'legacy-registration-hash',1788220800000);
        INSERT INTO "Assignment" ("id","merchantId","experimentId","randomizationUnitId","randomizationUnitType","arm","bucket","saltVersion","consentState","assignedAt","expiresAt")
        VALUES ('legacy-a','legacy-m','legacy-e','session-1','SESSION','ORIGINAL',1,1,'ANALYTICS_ALLOWED',1788220800000,1788825600000);
      `,
    });
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(
        "prisma/migrations/20260905120000_mvp_v2_foundation/migration.sql",
      ),
    });
    for (const migration of migrations.filter(
      (entry) => entry > "20260905120000_mvp_v2_foundation",
    )) {
      execFileSync("sqlite3", [databasePath], {
        input: readFileSync(
          path.join("prisma/migrations", migration, "migration.sql"),
        ),
      });
    }
    const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
    try {
      const experiment = await db.experiment.findUniqueOrThrow({
        where: { id: "legacy-e" },
        include: { registration: true, assignments: true },
      });
      assert.equal(experiment.registration?.protocolVersion, "pilot-rps-v1");
      assert.equal(experiment.registration?.primaryMetric, "REVENUE_PER_SESSION");
      assert.equal(
        experiment.registration?.registrationHash,
        "legacy-registration-hash",
      );
      assert.equal(experiment.lifecycleVersion, 1);
      assert.equal(experiment.enrollmentClosedAt, null);
      assert.equal(experiment.assignments[0]?.randomizationUnitType, "SESSION");
      assert.equal(experiment.assignments[0]?.eligibilityVersion, "legacy-v1");
      assert.equal(experiment.assignments[0]?.consentPolicyVersion, "legacy-v1");
      assert.equal(experiment.assignments[0]?.visitorHash, null);
    } finally {
      await db.$disconnect();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v2 protocol, model, offer, shadow and billing features default closed", () => {
  const defaults = mvpV2Config({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.shadowEnabled, false);
  assert.equal(defaults.billingEnabled, false);
  assert.equal(defaults.modelEnabled, false);
  assert.equal(defaults.offerPublishable, false);
  assert.equal(defaults.protocolVersion, MVP_V2_PROTOCOL_VERSION);
  assert.equal(defaults.primaryMetric, MVP_V2_PRIMARY_METRIC);

  const shadow = mvpV2Config({
    PAGNETIC_V2_ENABLED: "false",
    PAGNETIC_V2_SHADOW_ENABLED: "true",
    PAGNETIC_V2_MODEL_ENABLED: "true",
  });
  assert.equal(shadow.shadowEnabled, true);
  assert.equal(shadow.modelEnabled, false);

  const live = mvpV2Config({
    PAGNETIC_V2_ENABLED: "true",
    PAGNETIC_V2_SHADOW_ENABLED: "true",
    PAGNETIC_V2_MODEL_ENABLED: "true",
    PAGNETIC_V2_MODEL_PROVIDER: "fixture-provider",
    PAGNETIC_V2_OFFER_PUBLISHABLE: "true",
    SHOPIFY_BILLING_ENABLED: "true",
  });
  assert.equal(live.enabled, true);
  assert.equal(live.shadowEnabled, false);
  assert.equal(live.modelEnabled, true);
  assert.equal(live.offerPublishable, true);
  assert.equal(live.billingEnabled, true);
});

test("job and outbox foundations are tenant-scoped, idempotent and lease-safe", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "v2-foundation.myshopify.com" },
    });
    const dueAt = new Date("2026-09-05T12:00:00.000Z");
    const job = await enqueueJob({
      db: fixture.db,
      merchantId: merchant.id,
      type: "DIAGNOSIS_PREPARE",
      idempotencyKey: "diagnosis:product-1:v1",
      payload: { productId: "product-1", nested: { b: 2, a: 1 } },
      nextRunAt: dueAt,
    });
    const replay = await enqueueJob({
      db: fixture.db,
      merchantId: merchant.id,
      type: "DIAGNOSIS_PREPARE",
      idempotencyKey: "diagnosis:product-1:v1",
      payload: { nested: { a: 1, b: 2 }, productId: "product-1" },
      nextRunAt: dueAt,
    });
    assert.equal(replay.id, job.id);
    assert.equal(await fixture.db.job.count(), 1);
    await assert.rejects(
      enqueueJob({
        db: fixture.db,
        merchantId: merchant.id,
        type: "DIAGNOSIS_PREPARE",
        idempotencyKey: "diagnosis:product-1:v1",
        payload: { productId: "different" },
      }),
      QueueIdempotencyConflictError,
    );

    const claimed = await claimJobs({
      db: fixture.db,
      workerId: "test-worker",
      now: dueAt,
    });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0]!.attempts, 1);
    assert.ok(claimed[0]!.leaseToken);
    assert.equal(
      (await claimJobs({ db: fixture.db, workerId: "other", now: dueAt })).length,
      0,
    );
    await assert.rejects(
      completeJob({
        db: fixture.db,
        merchantId: merchant.id,
        jobId: job.id,
        leaseToken: "wrong-lease",
        now: dueAt,
      }),
      /STALE_JOB_LEASE/,
    );
    await completeJob({
      db: fixture.db,
      merchantId: merchant.id,
      jobId: job.id,
      leaseToken: claimed[0]!.leaseToken!,
      resultRef: "diagnosis-1",
      now: dueAt,
    });
    assert.equal(
      (await fixture.db.job.findUniqueOrThrow({ where: { id: job.id } })).status,
      "COMPLETED",
    );

    const event = await enqueueOutboxEvent({
      db: fixture.db,
      merchantId: merchant.id,
      type: "DEPLOYMENT_ADVANCED",
      aggregateType: "DEPLOYMENT",
      aggregateId: "deployment-1",
      idempotencyKey: "deployment-1:revision-2",
      payload: { revision: 2 },
      nextRunAt: dueAt,
    });
    const events = await claimOutboxEvents({
      db: fixture.db,
      workerId: "outbox-test",
      now: dueAt,
    });
    assert.deepEqual(events.map((item) => item.id), [event.id]);
    await markOutboxDelivered({
      db: fixture.db,
      merchantId: merchant.id,
      eventId: event.id,
      leaseToken: events[0]!.leaseToken!,
      deliveredAt: dueAt,
    });
    assert.equal(
      (
        await fixture.db.outboxEvent.findUniqueOrThrow({ where: { id: event.id } })
      ).status,
      "DELIVERED",
    );
  } finally {
    await fixture.close();
  }
});

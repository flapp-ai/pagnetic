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
  failJob,
  failOutboxEvent,
  markOutboxDelivered,
} from "../app/services/job-outbox.server";

async function fixture() {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pagnetic-queue-recovery-"),
  );
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(
        path.join("prisma/migrations", migration, "migration.sql"),
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  const merchant = await db.merchant.create({
    data: { shop: "queue-recovery.myshopify.com" },
  });
  const now = new Date("2026-09-05T12:00:00Z");
  const job = await enqueueJob({
    db,
    merchantId: merchant.id,
    type: "RECONCILE_ORDER",
    idempotencyKey: "order:1",
    payload: { orderId: "1" },
    nextRunAt: now,
  });
  const event = await enqueueOutboxEvent({
    db,
    merchantId: merchant.id,
    type: "ORDER_RECONCILED",
    aggregateType: "ORDER",
    aggregateId: "1",
    idempotencyKey: "order:1",
    payload: { orderId: "1" },
    nextRunAt: now,
  });
  return {
    db,
    merchant,
    job,
    event,
    now,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("expired worker leases cannot complete or fail jobs or acknowledge delivery", async () => {
  const f = await fixture();
  try {
    const [job] = await claimJobs({
      db: f.db,
      workerId: "old",
      now: f.now,
      leaseMs: 1000,
    });
    const [event] = await claimOutboxEvents({
      db: f.db,
      workerId: "old",
      now: f.now,
      leaseMs: 1000,
    });
    const expiredAt = new Date(f.now.getTime() + 1000);
    await assert.rejects(
      completeJob({
        db: f.db,
        merchantId: f.merchant.id,
        jobId: job!.id,
        leaseToken: job!.leaseToken!,
        now: expiredAt,
      }),
      /STALE_JOB_LEASE/,
    );
    await assert.rejects(
      failJob({
        db: f.db,
        merchantId: f.merchant.id,
        jobId: job!.id,
        leaseToken: job!.leaseToken!,
        errorCode: "LATE_FAILURE",
        now: expiredAt,
      }),
      /STALE_JOB_LEASE/,
    );
    await assert.rejects(
      markOutboxDelivered({
        db: f.db,
        merchantId: f.merchant.id,
        eventId: event!.id,
        leaseToken: event!.leaseToken!,
        deliveredAt: expiredAt,
      }),
      /STALE_OUTBOX_LEASE/,
    );
    await assert.rejects(
      failOutboxEvent({
        db: f.db,
        merchantId: f.merchant.id,
        eventId: event!.id,
        leaseToken: event!.leaseToken!,
        errorCode: "LATE_FAILURE",
        now: expiredAt,
      }),
      /STALE_OUTBOX_LEASE/,
    );
    const [replacement] = await claimJobs({
      db: f.db,
      workerId: "new",
      now: expiredAt,
      leaseMs: 1000,
    });
    assert.notEqual(replacement!.leaseToken, job!.leaseToken);
    await assert.rejects(
      failJob({
        db: f.db,
        merchantId: f.merchant.id,
        jobId: job!.id,
        leaseToken: job!.leaseToken!,
        errorCode: "STALE_FAILURE",
        now: expiredAt,
      }),
      /STALE_JOB_LEASE/,
    );
    await completeJob({
      db: f.db,
      merchantId: f.merchant.id,
      jobId: replacement!.id,
      leaseToken: replacement!.leaseToken!,
      now: expiredAt,
    });
    assert.equal(
      (await f.db.job.findUniqueOrThrow({ where: { id: job!.id } })).status,
      "COMPLETED",
    );
  } finally {
    await f.close();
  }
});

test("failed delivery backs off without claiming success and reaches a bounded dead letter", async () => {
  const f = await fixture();
  try {
    const [first] = await claimOutboxEvents({
      db: f.db,
      workerId: "sender",
      now: f.now,
      maxAttempts: 2,
    });
    await assert.rejects(
      failOutboxEvent({
        db: f.db,
        merchantId: "wrong-merchant",
        eventId: first!.id,
        leaseToken: first!.leaseToken!,
        errorCode: "HTTP_500",
        now: f.now,
        maxAttempts: 2,
      }),
      /STALE_OUTBOX_LEASE/,
    );
    const retry = await failOutboxEvent({
      db: f.db,
      merchantId: f.merchant.id,
      eventId: first!.id,
      leaseToken: first!.leaseToken!,
      errorCode: "HTTP_500",
      now: f.now,
      maxAttempts: 2,
    });
    assert.equal(retry.status, "RETRY");
    assert.equal(retry.deliveredAt, null);
    assert.equal(retry.nextRunAt.getTime(), f.now.getTime() + 2000);
    assert.equal(
      (
        await claimOutboxEvents({
          db: f.db,
          workerId: "too-early",
          now: new Date(retry.nextRunAt.getTime() - 1),
          maxAttempts: 2,
        })
      ).length,
      0,
    );
    const [second] = await claimOutboxEvents({
      db: f.db,
      workerId: "retry-sender",
      now: retry.nextRunAt,
      maxAttempts: 2,
    });
    await assert.rejects(
      markOutboxDelivered({
        db: f.db,
        merchantId: f.merchant.id,
        eventId: first!.id,
        leaseToken: first!.leaseToken!,
        deliveredAt: retry.nextRunAt,
      }),
      /STALE_OUTBOX_LEASE/,
    );
    const dead = await failOutboxEvent({
      db: f.db,
      merchantId: f.merchant.id,
      eventId: second!.id,
      leaseToken: second!.leaseToken!,
      errorCode: "HTTP_500",
      now: retry.nextRunAt,
      maxAttempts: 2,
    });
    assert.equal(dead.status, "DEAD_LETTER");
    assert.equal(dead.deliveredAt, null);
    assert.equal(dead.lastErrorCode, "HTTP_500");
    assert.equal(
      (
        await claimOutboxEvents({
          db: f.db,
          workerId: "later",
          now: new Date(f.now.getTime() + 86_400_000),
          maxAttempts: 2,
        })
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("aborted business transaction leaves no queued job or outbox event", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.db.$transaction(async (tx) => {
        await enqueueJob({
          db: tx,
          merchantId: f.merchant.id,
          type: "FINALIZE_RESULT",
          idempotencyKey: "rollback",
          payload: { result: "r1" },
        });
        await enqueueOutboxEvent({
          db: tx,
          merchantId: f.merchant.id,
          type: "RESULT_READY",
          aggregateType: "RESULT",
          aggregateId: "r1",
          idempotencyKey: "rollback",
          payload: { result: "r1" },
        });
        throw new Error("BUSINESS_TRANSACTION_ABORTED");
      }),
      /BUSINESS_TRANSACTION_ABORTED/,
    );
    assert.equal(
      await f.db.job.count({ where: { idempotencyKey: "rollback" } }),
      0,
    );
    assert.equal(
      await f.db.outboxEvent.count({ where: { idempotencyKey: "rollback" } }),
      0,
    );
  } finally {
    await f.close();
  }
});

test("repeated worker crashes exhaust retries for jobs and outbox events", async () => {
  const f = await fixture();
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const now = new Date(f.now.getTime() + attempt * 1000);
      const jobs = await claimJobs({
        db: f.db,
        workerId: "crashing",
        now,
        leaseMs: 1000,
      });
      const events = await claimOutboxEvents({
        db: f.db,
        workerId: "crashing",
        now,
        leaseMs: 1000,
      });
      assert.equal(jobs.length, 1);
      assert.equal(events.length, 1);
      assert.equal(jobs[0]!.attempts, attempt + 1);
    }
    const now = new Date(f.now.getTime() + 8000);
    assert.equal(
      (await claimJobs({ db: f.db, workerId: "ninth", now })).length,
      0,
    );
    assert.equal(
      (await claimOutboxEvents({ db: f.db, workerId: "ninth", now })).length,
      0,
    );
    const job = await f.db.job.findUniqueOrThrow({ where: { id: f.job.id } });
    const event = await f.db.outboxEvent.findUniqueOrThrow({
      where: { id: f.event.id },
    });
    assert.equal(job.status, "DEAD_LETTER");
    assert.equal(event.status, "DEAD_LETTER");
    assert.equal(job.attempts, 8);
    assert.equal(event.deliveredAt, null);
    assert.equal(job.leaseToken, null);
    assert.equal(event.leaseToken, null);
  } finally {
    await f.close();
  }
});

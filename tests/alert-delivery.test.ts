import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { deliverOperationalAlerts } from "../app/services/alert-delivery.server";
import { runMerchantAutomation } from "../app/services/automation.server";
import { enqueueOutboxEvent } from "../app/services/job-outbox.server";

async function fixture() {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pagnetic-alert-delivery-"),
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
    data: { shop: "alert-tests.myshopify.com" },
  });
  const now = new Date("2026-09-05T12:00:00Z");
  const alert = await db.operationalAlert.create({
    data: {
      merchantId: merchant.id,
      fingerprint: "health:1",
      severity: "SEV2",
      kind: "MEASUREMENT_HEALTH",
      summary: "Measurement needs repair",
      openedAt: now,
    },
  });
  const environment = {
    PAGNETIC_V2_ENABLED: "true",
    ALERT_WEBHOOK_URL: "https://alerts.example.test/receive",
  };
  return {
    db,
    merchantId: merchant.id,
    alert,
    environment,
    now,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("maintenance failure still delivers its alert and recovery resolves the incident", async (context) => {
  const f = await fixture();
  const priorEndpoint = process.env.ALERT_WEBHOOK_URL;
  const priorV2 = process.env.PAGNETIC_V2_ENABLED;
  process.env.ALERT_WEBHOOK_URL = f.environment.ALERT_WEBHOOK_URL;
  process.env.PAGNETIC_V2_ENABLED = "true";
  const sent: Array<{ alerts: Array<{ kind: string }> }> = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    },
  );
  try {
    const failingDb = f.db.$extends({
      query: {
        measurementSyncState: {
          async upsert() {
            throw new Error("SIMULATED_RECOVERY_FAILURE");
          },
        },
      },
    }) as unknown as PrismaClient;
    const graphql = async () =>
      Response.json({
        data: {
          orders: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    await assert.rejects(
      runMerchantAutomation({
        db: failingDb,
        merchantId: f.merchantId,
        shop: "alert-tests.myshopify.com",
        graphql,
      }),
      /SIMULATED_RECOVERY_FAILURE/,
    );
    assert.ok(
      sent.some((body) =>
        body.alerts.some((alert) => alert.kind === "AUTOMATION_FAILURE"),
      ),
    );
    const incident = await f.db.operationalAlert.findFirstOrThrow({
      where: { fingerprint: "automation-failure" },
    });
    assert.equal(incident.status, "OPEN");
    assert.equal(
      (
        await f.db.outboxEvent.findFirstOrThrow({
          where: { aggregateId: incident.id },
        })
      ).status,
      "DELIVERED",
    );
    await runMerchantAutomation({
      db: f.db,
      merchantId: f.merchantId,
      shop: "alert-tests.myshopify.com",
      graphql,
    });
    assert.equal(
      (
        await f.db.operationalAlert.findUniqueOrThrow({
          where: { id: incident.id },
        })
      ).status,
      "RESOLVED",
    );
    assert.equal(
      sent.filter((body) =>
        body.alerts.some((alert) => alert.kind === "AUTOMATION_FAILURE"),
      ).length,
      1,
    );
  } finally {
    if (priorEndpoint === undefined) delete process.env.ALERT_WEBHOOK_URL;
    else process.env.ALERT_WEBHOOK_URL = priorEndpoint;
    if (priorV2 === undefined) delete process.env.PAGNETIC_V2_ENABLED;
    else process.env.PAGNETIC_V2_ENABLED = priorV2;
    await f.close();
  }
});

test("HTTP 500 retries the same incident and marks delivery only after 2xx", async () => {
  const f = await fixture();
  try {
    const deliveryIds: string[] = [];
    let status = 500;
    const fetchImpl: typeof fetch = async (_input, init) => {
      deliveryIds.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return new Response("fixture", { status });
    };
    const first = await deliverOperationalAlerts({
      ...f,
      alerts: [f.alert],
      fetchImpl,
    });
    assert.equal(first.failed, 1);
    assert.equal(first.delivered, 0);
    const retry = await f.db.outboxEvent.findFirstOrThrow();
    assert.equal(retry.status, "RETRY");
    assert.equal(retry.lastErrorCode, "ALERT_HTTP_500");
    assert.equal(retry.deliveredAt, null);
    status = 204;
    const successFetch: typeof fetch = async (_input, init) => {
      deliveryIds.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return new Response(null, { status });
    };
    const changed = await f.db.operationalAlert.update({
      where: { id: f.alert.id },
      data: { summary: "New detail, same incident" },
    });
    const sent = await deliverOperationalAlerts({
      ...f,
      now: retry.nextRunAt,
      alerts: [changed],
      fetchImpl: successFetch,
    });
    assert.equal(sent.delivered, 1);
    assert.deepEqual(deliveryIds, [retry.id, retry.id]);
    await deliverOperationalAlerts({
      ...f,
      now: new Date(f.now.getTime() + 5000),
      alerts: [changed],
      fetchImpl: successFetch,
    });
    assert.equal(deliveryIds.length, 2);
    assert.equal(await f.db.outboxEvent.count(), 1);
    assert.equal(
      (await f.db.outboxEvent.findFirstOrThrow()).status,
      "DELIVERED",
    );
  } finally {
    await f.close();
  }
});

test("resolved incidents are skipped and a reopened incident gets a new delivery identity", async () => {
  const f = await fixture();
  try {
    await deliverOperationalAlerts({
      ...f,
      alerts: [f.alert],
      fetchImpl: async () => new Response(null, { status: 500 }),
    });
    const retry = await f.db.outboxEvent.findFirstOrThrow();
    await f.db.operationalAlert.update({
      where: { id: f.alert.id },
      data: { status: "RESOLVED", resolvedAt: f.now },
    });
    let sends = 0;
    const fetchImpl: typeof fetch = async () => {
      sends += 1;
      return new Response(null, { status: 204 });
    };
    const result = await deliverOperationalAlerts({
      ...f,
      now: retry.nextRunAt,
      alerts: [],
      fetchImpl,
    });
    assert.equal(result.skipped, 1);
    assert.equal(sends, 0);
    assert.equal((await f.db.outboxEvent.findFirstOrThrow()).deliveredAt, null);
    const reopenedAt = new Date(f.now.getTime() + 5000);
    const reopened = await f.db.operationalAlert.update({
      where: { id: f.alert.id },
      data: { status: "OPEN", openedAt: reopenedAt, resolvedAt: null },
    });
    await deliverOperationalAlerts({
      ...f,
      now: reopenedAt,
      alerts: [reopened],
      fetchImpl,
    });
    assert.equal(sends, 1);
    assert.equal(await f.db.outboxEvent.count(), 2);
  } finally {
    await f.close();
  }
});

test("alert worker leaves other tenants and other outbox types untouched", async () => {
  const f = await fixture();
  try {
    const other = await f.db.merchant.create({
      data: { shop: "other-alert-tests.myshopify.com" },
    });
    for (const [merchantId, type] of [
      [other.id, "NOTIFY_ALERT"],
      [f.merchantId, "DEPLOYMENT_ADVANCED"],
    ]) {
      await enqueueOutboxEvent({
        db: f.db,
        merchantId: merchantId!,
        type: type!,
        aggregateType: "FIXTURE",
        aggregateId: "1",
        idempotencyKey: "unrelated",
        payload: {},
        nextRunAt: f.now,
      });
    }
    const result = await deliverOperationalAlerts({
      ...f,
      alerts: [f.alert],
      fetchImpl: async () => new Response(null, { status: 204 }),
    });
    assert.equal(result.delivered, 1);
    const untouched = await f.db.outboxEvent.findMany({
      where: { idempotencyKey: "unrelated" },
    });
    assert.equal(untouched.length, 2);
    assert.ok(
      untouched.every(
        (event) => event.status === "PENDING" && event.attempts === 0,
      ),
    );
  } finally {
    await f.close();
  }
});

test("missing endpoint is explicit and legacy HTTP failure is not success", async () => {
  const f = await fixture();
  try {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("unexpected network access");
    };
    const missing = await deliverOperationalAlerts({
      ...f,
      environment: {},
      alerts: [f.alert],
      fetchImpl,
    });
    assert.equal(missing.status, "NOT_CONFIGURED");
    await assert.rejects(
      deliverOperationalAlerts({
        ...f,
        environment: { ALERT_WEBHOOK_URL: f.environment.ALERT_WEBHOOK_URL },
        alerts: [f.alert],
        fetchImpl: async () => new Response(null, { status: 500 }),
      }),
      /ALERT_HTTP_500/,
    );
  } finally {
    await f.close();
  }
});

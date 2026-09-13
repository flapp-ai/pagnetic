import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { PrismaClient } from "@prisma/client";

import { loadV2ExperimentAnalysis } from "../../app/services/experiment-report-v2.server";
import { hashValue } from "../../app/services/governance.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../../app/services/mvp-v2";
import { installV2Deployment } from "../../app/services/v2-deployment.server";
import {
  originalDecisionV2,
  parseDecisionRequestV2,
  resolveV2Decision,
} from "../../app/services/v2-decision.server";
import { acceptFinancialWebhookV2 } from "../../app/services/webhook-inbox-v2.server";

const ASSIGNMENT_SECRET = "mixed-load-rehearsal-assignment-secret-v2";

export type MixedLoadForecast = {
  storefrontDecisionsPerSecond: number;
  financialWebhooksPerSecond: number;
  reportReadsPerSecond: number;
};

export type MixedLoadRehearsalOptions = {
  tenantCount?: number;
  durationSeconds?: number;
  multiplier?: number;
  forecast?: MixedLoadForecast;
  mobileFaultCount?: number;
  mobileRenderDeadlineMs?: number;
  mobileDeliveryDelayMs?: number;
};

type OperationKind = "decision" | "webhook" | "report";
type OperationResult = {
  kind: OperationKind;
  tenantIndex: number;
  latencyMs: number;
  dispatchLagMs: number;
  fallback: boolean;
  error: string | null;
};

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return Number(sorted[index]!.toFixed(3));
}

function latencySummary(values: number[]) {
  return {
    count: values.length,
    p50Ms: percentile(values, .5),
    p95Ms: percentile(values, .95),
    p99Ms: percentile(values, .99),
    maxMs: values.length ? Number(Math.max(...values).toFixed(3)) : null,
  };
}

function fileHash(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function createDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-mixed-load-"));
  const databasePath = path.join(directory, "load.sqlite");
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

async function seedTenant(db: PrismaClient, tenantIndex: number) {
  const merchant = await db.merchant.create({
    data: { shop: `mixed-load-${tenantIndex}.myshopify.com` },
  });
  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      shopifyProductId: `gid://shopify/Product/88${tenantIndex}`,
      title: `Mixed load product ${tenantIndex}`,
      handle: `mixed-load-product-${tenantIndex}`,
      status: "ACTIVE",
      sourceVersion: "mixed-load-source-v1",
      sourceHash: hashValue({ tenantIndex, source: "mixed-load-source-v1" }),
      sourceSnapshot: "{}",
    },
  });
  const key = `mixed-load-aa-${tenantIndex}`;
  const experiment = await db.experiment.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      key,
      salt: hashValue({ tenantIndex, salt: "mixed-load" }),
      controlPercentage: 50,
      controlPolicy: "ORIGINAL",
      treatmentPolicy: "ORIGINAL",
      attributionWindowDays: 7,
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
      enrollmentStartedAt: new Date("2026-09-01T00:00:00.000Z"),
      lifecycleVersion: 2,
      status: "ACTIVE",
      registration: {
        create: {
          protocolVersion: MVP_V2_PROTOCOL_VERSION,
          hypothesis: "Mixed-load instrumentation validates tenant-isolated serving.",
          primaryMetric: MVP_V2_PRIMARY_METRIC,
          revenueDefinition: "NET_FOCAL_MERCHANDISE",
          minimumMeaningfulLift: .05,
          alpha: .05,
          power: .8,
          targetSampleSize: 2_000,
          minimumDurationDays: 14,
          maximumDurationDays: 14,
          randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
          eligibilityJson: "{}",
          exclusionsJson: "[]",
          covariatesJson: "[]",
          stoppingRule: "FIXED_COHORT_V2",
          analysisVersion: "assigned-visitor-welch-v2.3",
          contentVersionsJson: "[]",
          mappingVersionsJson: "[]",
          guardrailsJson: "{}",
          dataMaturityLagDays: 7,
          registrationHash: hashValue({ tenantIndex, key, version: MVP_V2_PROTOCOL_VERSION }),
        },
      },
    },
  });
  await installV2Deployment({
    db,
    merchantId: merchant.id,
    productId: product.id,
    experimentId: experiment.id,
    policy: "ORIGINAL",
    approvedAuthorityHash: hashValue({ tenantIndex, authority: "mixed-load" }),
    expectedRevision: 0,
    idempotencyKey: `mixed-load-install-${tenantIndex}`,
    now: new Date("2026-09-05T00:00:00.000Z"),
  });
  return { merchant, product, experiment };
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function runMixedLoadRehearsal(options: MixedLoadRehearsalOptions = {}) {
  const tenantCount = positiveInteger(options.tenantCount ?? 4, "tenantCount");
  const durationSeconds = positiveInteger(options.durationSeconds ?? 5, "durationSeconds");
  const multiplier = positiveInteger(options.multiplier ?? 2, "multiplier");
  const forecast = options.forecast ?? {
    storefrontDecisionsPerSecond: 8,
    financialWebhooksPerSecond: 2,
    reportReadsPerSecond: 1,
  };
  for (const [name, value] of Object.entries(forecast)) positiveInteger(value, name);
  const mobileFaultCount = positiveInteger(options.mobileFaultCount ?? 4, "mobileFaultCount");
  const mobileRenderDeadlineMs = positiveInteger(
    options.mobileRenderDeadlineMs ?? 1_500,
    "mobileRenderDeadlineMs",
  );
  const mobileDeliveryDelayMs = positiveInteger(
    options.mobileDeliveryDelayMs ?? 1_600,
    "mobileDeliveryDelayMs",
  );
  if (mobileDeliveryDelayMs <= mobileRenderDeadlineMs)
    throw new Error("mobileDeliveryDelayMs must exceed the render deadline.");

  const database = createDatabase();
  try {
    const tenants: Array<Awaited<ReturnType<typeof seedTenant>>> = [];
    for (let index = 0; index < tenantCount; index += 1)
      tenants.push(await seedTenant(database.db, index));
    const enabledShops = tenants.map((tenant) => tenant.merchant.shop).join(",");

    const rates = {
      decision: forecast.storefrontDecisionsPerSecond * multiplier,
      webhook: forecast.financialWebhooksPerSecond * multiplier,
      report: forecast.reportReadsPerSecond * multiplier,
    };
    const plan: Array<{ kind: OperationKind; tenantIndex: number; sequence: number; offsetMs: number }> = [];
    let sequence = 0;
    for (let second = 0; second < durationSeconds; second += 1) {
      for (const kind of ["decision", "webhook", "report"] as const) {
        for (let index = 0; index < rates[kind]; index += 1) {
          plan.push({
            kind,
            tenantIndex: sequence % tenantCount,
            sequence,
            offsetMs: second * 1_000 + Math.floor((index / rates[kind]) * 1_000),
          });
          sequence += 1;
        }
      }
    }
    plan.sort((left, right) => left.offsetMs - right.offsetMs || left.sequence - right.sequence);

    const results: OperationResult[] = [];
    const startedAt = performance.now();
    const rssStartBytes = process.memoryUsage().rss;
    let rssPeakBytes = rssStartBytes;
    const rssSampler = setInterval(() => {
      rssPeakBytes = Math.max(rssPeakBytes, process.memoryUsage().rss);
    }, 25);
    await Promise.all(plan.map(async (operation) => {
      const delay = Math.max(0, startedAt + operation.offsetMs - performance.now());
      if (delay > 0) await wait(delay);
      const operationStartedAt = performance.now();
      let fallback = false;
      let error: string | null = null;
      const tenant = tenants[operation.tenantIndex]!;
      try {
        if (operation.kind === "decision") {
          const response = await resolveV2Decision({
            db: database.db,
            shop: tenant.merchant.shop,
            request: parseDecisionRequestV2({
              schemaVersion: 2,
              requestId: `request_${String(operation.sequence).padStart(8, "0")}`,
              productId: tenant.product.shopifyProductId,
              visitorToken: `visitor_${String(operation.sequence).padStart(8, "0")}`,
              sessionId: `session_${String(operation.sequence).padStart(8, "0")}`,
              consent: { analytics: true, preferences: true, policyVersion: "shopify-consent-v1" },
              blockVersion: "adaptive-panel-v2",
            }),
            environment: {
              PAGNETIC_V2_ENABLED: "true",
              PAGNETIC_V2_ENABLED_SHOPS: enabledShops,
              ASSIGNMENT_SECRET,
            },
            now: new Date("2026-09-05T00:00:00.000Z"),
          });
          fallback = response.reason !== "V2_EXPERIMENT_ASSIGNMENT";
        } else if (operation.kind === "webhook") {
          await acceptFinancialWebhookV2({
            db: database.db,
            shop: tenant.merchant.shop,
            topic: "orders/create",
            shopifyEventId: `mixed-load-event-${operation.sequence}`,
            payload: {
              id: String(9_000_000 + operation.sequence),
              updated_at: "2026-09-05T00:00:00.000Z",
            },
            receivedAt: new Date(),
          });
        } else {
          await loadV2ExperimentAnalysis({
            db: database.db,
            merchantId: tenant.merchant.id,
            experimentId: tenant.experiment.id,
            healthState: "INSUFFICIENT",
            now: new Date("2026-09-05T00:00:00.000Z"),
          });
        }
      } catch (caught) {
        error = boundedError(caught);
      }
      results.push({
        kind: operation.kind,
        tenantIndex: operation.tenantIndex,
        latencyMs: performance.now() - operationStartedAt,
        dispatchLagMs: Math.max(0, operationStartedAt - (startedAt + operation.offsetMs)),
        fallback,
        error,
      });
    }));
    clearInterval(rssSampler);

    const mobileFaults = await Promise.all(
      Array.from({ length: mobileFaultCount }, async (_, index) => {
        const tenant = tenants[index % tenantCount]!;
        const server = resolveV2Decision({
          db: database.db,
          shop: tenant.merchant.shop,
          request: parseDecisionRequestV2({
            schemaVersion: 2,
            requestId: `mobile_fault_request_${String(index).padStart(4, "0")}`,
            productId: tenant.product.shopifyProductId,
            visitorToken: `mobile_fault_visitor_${String(index).padStart(4, "0")}`,
            sessionId: `mobile_fault_session_${String(index).padStart(4, "0")}`,
            consent: { analytics: true, preferences: true, policyVersion: "shopify-consent-v1" },
            blockVersion: "adaptive-panel-v2",
          }),
          environment: {
            PAGNETIC_V2_ENABLED: "true",
            PAGNETIC_V2_ENABLED_SHOPS: enabledShops,
            ASSIGNMENT_SECRET,
          },
          now: new Date("2026-09-05T00:00:00.000Z"),
        });
        const delayedDelivery = server.then(async (response) => {
          await wait(mobileDeliveryDelayMs);
          return response;
        });
        const clientResult = await Promise.race([
          delayedDelivery,
          wait(mobileRenderDeadlineMs).then(() => originalDecisionV2("CLIENT_RENDER_DEADLINE")),
        ]);
        await server;
        return {
          tenantIndex: index % tenantCount,
          serving: clientResult.serving,
          reason: clientResult.reason,
        };
      }),
    );

    const finishedAt = performance.now();
    const errors = results.filter((result) => result.error);
    const decisions = results.filter((result) => result.kind === "decision");
    const queue = await database.db.job.aggregate({
      where: { status: { in: ["PENDING", "RETRY", "RUNNING"] } },
      _count: true,
      _min: { createdAt: true },
    });
    const measuredAt = new Date();
    const queueAgeMs = queue._min.createdAt
      ? Math.max(0, measuredAt.getTime() - queue._min.createdAt.getTime())
      : 0;
    const perTenant = tenants.map((tenant, tenantIndex) => {
      const own = decisions.filter((result) => result.tenantIndex === tenantIndex);
      return {
        tenantIndex,
        shop: tenant.merchant.shop,
        attempted: own.length,
        succeeded: own.filter((result) => !result.error).length,
        decisionLatency: latencySummary(own.map((result) => result.latencyMs)),
      };
    });
    const decisionLatency = latencySummary(decisions.map((result) => result.latencyMs));
    const fallbackCount = decisions.filter((result) => result.fallback).length;
    const result = {
      schemaVersion: 1,
      recordedAt: measuredAt.toISOString(),
      environment: {
        database: "isolated SQLite single-writer fixture",
        runtime: process.version,
        tenantCount,
        durationSeconds,
        productionCapacityClaim: false,
      },
      implementationHashes: {
        harness: fileHash("scripts/lib/mixed-load-v2.ts"),
        decisionService: fileHash("app/services/v2-decision.server.ts"),
        webhookInbox: fileHash("app/services/webhook-inbox-v2.server.ts"),
        reportService: fileHash("app/services/experiment-report-v2.server.ts"),
        storefrontRuntime: fileHash("extensions/adaptive-panel/assets/adaptive-panel-v2.js"),
      },
      declaredForecastPerSecond: forecast,
      exercisedMultiplier: multiplier,
      scheduledPerSecond: rates,
      totals: {
        attempted: results.length,
        decisions: decisions.length,
        webhooks: results.filter((item) => item.kind === "webhook").length,
        reportReads: results.filter((item) => item.kind === "report").length,
        errors: errors.length,
      },
      latency: {
        decision: decisionLatency,
        webhook: latencySummary(results.filter((item) => item.kind === "webhook").map((item) => item.latencyMs)),
        report: latencySummary(results.filter((item) => item.kind === "report").map((item) => item.latencyMs)),
        schedulerDispatchLag: latencySummary(results.map((item) => item.dispatchLagMs)),
      },
      fallback: {
        count: fallbackCount,
        percent: Number(((fallbackCount / Math.max(1, decisions.length)) * 100).toFixed(3)),
      },
      queue: { pending: queue._count, oldestAgeMs: queueAgeMs },
      memory: {
        rssStartBytes,
        rssPeakBytes,
        rssEndBytes: process.memoryUsage().rss,
      },
      tenantFairness: {
        everyTenantSucceeded: perTenant.every((tenant) => tenant.succeeded === tenant.attempted),
        perTenant,
      },
      mobileLatencyFault: {
        deadlineMs: mobileRenderDeadlineMs,
        injectedDeliveryDelayMs: mobileDeliveryDelayMs,
        attempts: mobileFaults.length,
        originalFallbacks: mobileFaults.filter(
          (item) => item.serving === "ORIGINAL" && item.reason === "CLIENT_RENDER_DEADLINE",
        ).length,
      },
      serverDecisionBudget: {
        prospectiveP95Ms: 150,
        passed: errors.length === 0 && decisionLatency.p95Ms != null && decisionLatency.p95Ms <= 150,
      },
      limitations: [
        "Synthetic rates are declared test inputs, not observed cohort traffic or a merchant-cap estimate.",
        "Prisma does not expose database lock-wait duration; DB wait instrumentation remains unavailable in this fixture.",
        "The mobile delivery fault applies the production 1500ms fallback contract at the client boundary; supported-device/browser timing remains S10 evidence.",
        "SQLite on one local host does not establish PostgreSQL provider, Fly region, Shopify proxy or population Core Web Vitals capacity.",
      ],
      elapsedMs: Number((finishedAt - startedAt).toFixed(3)),
      errors: errors.slice(0, 20).map((item) => ({ kind: item.kind, tenantIndex: item.tenantIndex, error: item.error })),
    };
    if (result.totals.errors !== 0) throw new Error(`MIXED_LOAD_ERRORS:${JSON.stringify(result)}`);
    if (!result.tenantFairness.everyTenantSucceeded) throw new Error(`MIXED_LOAD_TENANT_STARVATION:${JSON.stringify(result)}`);
    if (result.mobileLatencyFault.originalFallbacks !== result.mobileLatencyFault.attempts)
      throw new Error(`MIXED_LOAD_MOBILE_FALLBACK_FAILED:${JSON.stringify(result)}`);
    return result;
  } finally {
    await database.close();
  }
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  enqueueAutopilotPreparation,
  runAutopilotPreparationJobs,
} from "../app/services/autopilot-preparation-worker.server";
import {
  AUTOPILOT_PREPARATION_REFRESH_LIMIT,
  shouldRefreshAutopilotPreparation,
} from "../app/services/autopilot-preparation-refresh";
import { claimJobs, enqueueJob } from "../app/services/job-outbox.server";
import {
  buildDraftLibrary,
  syncProducts,
} from "../app/services/governance.server";
import { disableMerchantAfterUninstall } from "../app/services/uninstall.server";
import { approveAutopilotPlan } from "../app/services/autopilot-preparation.server";
import { MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION } from "../app/services/mvp-v2";
import { beginSelectedTestStoreV2Cutover } from "../app/services/test-store-cutover.server";

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-preparation-worker-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
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

function shopifyGraphql() {
  const calls: string[] = [];
  const graphql = async (query: string) => {
    calls.push(query);
    if (query.includes("AdaptiveStorefrontProducts")) {
      return Response.json({
        data: {
          products: {
            nodes: [{
              id: "gid://shopify/Product/101",
              title: "Trail Runner",
              handle: "trail-runner",
              status: "ACTIVE",
              description: "Soft recycled knit supports comfortable daily movement. Responsive foam supports steady movement. Durable rubber provides grip on city streets.",
              productType: "Shoes",
              vendor: "Fixture",
              templateSuffix: null,
              updatedAt: "2026-09-05T10:00:00Z",
              featuredImage: null,
              variants: {
                nodes: [{
                  id: "gid://shopify/ProductVariant/201",
                  title: "Default",
                  sku: "TRAIL-1",
                  price: "120.00",
                  availableForSale: true,
                }],
              },
            }],
          },
        },
      });
    }
    if (query.includes("CurrentAdaptivePixel"))
      return Response.json({ data: { webPixel: null } });
    if (query.includes("CreateAdaptivePixel")) {
      return Response.json({
        data: {
          webPixelCreate: {
            userErrors: [],
            webPixel: { id: "gid://shopify/WebPixel/301" },
          },
        },
      });
    }
    throw new Error("UNEXPECTED_GRAPHQL_OPERATION");
  };
  return { calls, graphql };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("preparation refresh is visible, idle, edit-safe, bounded, and stops when terminal", () => {
  const ready = {
    pending: true,
    visible: true,
    busy: false,
    revalidatorIdle: true,
    editableFocused: false,
    attempts: 0,
  };
  assert.equal(shouldRefreshAutopilotPreparation(ready), true);
  assert.equal(shouldRefreshAutopilotPreparation({ ...ready, visible: false }), false);
  assert.equal(shouldRefreshAutopilotPreparation({ ...ready, busy: true }), false);
  assert.equal(shouldRefreshAutopilotPreparation({ ...ready, revalidatorIdle: false }), false);
  assert.equal(shouldRefreshAutopilotPreparation({ ...ready, editableFocused: true }), false);
  assert.equal(shouldRefreshAutopilotPreparation({ ...ready, pending: false }), false);
  assert.equal(shouldRefreshAutopilotPreparation({
    ...ready,
    attempts: AUTOPILOT_PREPARATION_REFRESH_LIMIT,
  }), false);
});

test("catalog persistence is a short transaction that rolls back with lost worker authority", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "prepare-catalog-authority.myshopify.com" },
    });
    let checks = 0;
    await assert.rejects(
      syncProducts({
        db: fixture.db,
        shop: merchant.shop,
        actor: "system:test",
        graphql: shopifyGraphql().graphql,
        assertActive: async (authorityDb) => {
          checks += 1;
          if (checks === 3) {
            assert.equal(
              "$transaction" in authorityDb,
              false,
              "the product write must be guarded inside a transaction client",
            );
            throw new Error("STALE_JOB_LEASE");
          }
        },
      }),
      /STALE_JOB_LEASE/,
    );
    assert.equal(checks, 3);
    assert.equal(
      await fixture.db.product.count({ where: { merchantId: merchant.id } }),
      0,
    );
    assert.equal(
      await fixture.db.sourceDocument.count({ where: { merchantId: merchant.id } }),
      0,
    );
    assert.equal(
      await fixture.db.evidenceObject.count({ where: { merchantId: merchant.id } }),
      0,
    );
  } finally {
    await fixture.close();
  }
});

test("diagnosis and draft persistence recheck worker authority inside each transaction", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "prepare-draft-authority.myshopify.com" },
    });
    await syncProducts({
      db: fixture.db,
      shop: merchant.shop,
      actor: "system:test",
      graphql: shopifyGraphql().graphql,
    });
    const product = await fixture.db.product.findFirstOrThrow({
      where: { merchantId: merchant.id },
    });
    let checks = 0;
    await assert.rejects(
      buildDraftLibrary({
        db: fixture.db,
        merchantId: merchant.id,
        productId: product.id,
        actor: "system:test",
        assertActive: async (authorityDb) => {
          checks += 1;
          assert.equal("$transaction" in authorityDb, false);
          if (checks === 3) throw new Error("STALE_JOB_LEASE");
        },
      }),
      /STALE_JOB_LEASE/,
    );
    assert.equal(checks, 3);
    assert.equal(
      await fixture.db.messageDiagnosis.count({ where: { merchantId: merchant.id } }),
      1,
      "the earlier authority-checked diagnosis unit may commit",
    );
    assert.equal(
      await fixture.db.experienceVersion.count({ where: { merchantId: merchant.id } }),
      0,
      "the draft/claim unit must roll back after authority loss",
    );
  } finally {
    await fixture.close();
  }
});

test("concurrent onboarding refreshes enqueue one tenant job and the offline worker completes it once", async () => {
  const fixture = testDatabase();
  try {
    const [merchant, other] = await Promise.all([
      fixture.db.merchant.create({ data: { shop: "prepare-one.myshopify.com" } }),
      fixture.db.merchant.create({ data: { shop: "prepare-two.myshopify.com" } }),
    ]);
    const now = new Date("2026-09-05T12:00:00Z");
    const request = {
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint: "https://pagnetic.example/storefront/events",
      now,
    };
    const [first, replay] = await Promise.all([
      enqueueAutopilotPreparation(request),
      enqueueAutopilotPreparation(request),
    ]);
    assert.equal(first.id, replay.id);
    assert.equal(await fixture.db.job.count({ where: { merchantId: merchant.id } }), 1);
    await enqueueAutopilotPreparation({
      ...request,
      merchantId: other.id,
      shop: other.shop,
    });

    const mock = shopifyGraphql();
    const outcome = await runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql: mock.graphql,
      workerId: "preparation-worker-one",
      now,
      clock: () => now,
    });
    assert.equal(outcome.length, 1);
    assert.equal(outcome[0]?.ok, true);
    assert.equal((await fixture.db.job.findUniqueOrThrow({ where: { id: first.id } })).status, "COMPLETED");
    assert.equal(await fixture.db.product.count({ where: { merchantId: merchant.id } }), 1);
    assert.equal(await fixture.db.autopilotPlan.count({ where: { merchantId: merchant.id } }), 1);
    assert.equal((await fixture.db.pixelCredential.findUniqueOrThrow({ where: { merchantId: merchant.id } })).status, "ACTIVE");
    assert.equal((await fixture.db.job.findFirstOrThrow({ where: { merchantId: other.id } })).status, "PENDING");

    const completedReplay = await enqueueAutopilotPreparation(request);
    assert.equal(completedReplay.status, "COMPLETED");
    assert.equal(await fixture.db.job.count({ where: { merchantId: merchant.id } }), 1);
    assert.equal(
      await fixture.db.auditLog.count({
        where: { merchantId: merchant.id, action: "autopilot_preparation_started" },
      }),
      1,
    );
    assert.ok(mock.calls.some((query) => query.includes("AdaptiveStorefrontProducts")));
    assert.ok(mock.calls.some((query) => query.includes("CreateAdaptivePixel")));
  } finally {
    await fixture.close();
  }
});

test("a receipt-bound cutover job refreshes catalog and cannot be raced by an unbound loader job", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "prepare-cutover.myshopify.com" },
    });
    const endpoint = "https://pagnetic.example/storefront/events";
    const firstMock = shopifyGraphql();
    await enqueueAutopilotPreparation({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint,
    });
    const first = await runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql: firstMock.graphql,
      workerId: "cutover-bootstrap",
    });
    assert.equal(first[0]?.ok, true);
    const legacy = await fixture.db.autopilotPlan.findFirstOrThrow({
      where: { merchantId: merchant.id, state: { not: "INVALIDATED" } },
    });
    const approved = await approveAutopilotPlan({
      db: fixture.db,
      merchantId: merchant.id,
      planId: legacy.id,
      planHash: legacy.planHash,
      actor: "owner:test",
      mediumRiskAcknowledged: true,
    });
    const product = await fixture.db.product.findUniqueOrThrow({
      where: { id: approved.productId },
    });
    const cutover = await beginSelectedTestStoreV2Cutover({
      db: fixture.db,
      merchantId: merchant.id,
      productId: product.id,
      legacyPlanId: approved.id,
      expectedSourceVersion: product.sourceVersion,
      expectedSourceHash: product.sourceHash,
      actor: "operator:test",
      idempotencyKey: "cutover:preparation-worker",
    });

    // The ordinary loader may still have a completed legacy slot, but even an
    // explicit retry must not create a new legacy plan after a cutover receipt.
    await enqueueAutopilotPreparation({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint,
      explicitRetry: true,
    });
    const bound = await enqueueAutopilotPreparation({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint,
      preferredProductId: product.id,
      cutoverReceiptId: cutover.receipt.id,
      explicitRetry: true,
    });
    const cutoverMock = shopifyGraphql();
    const outcomes = await runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql: cutoverMock.graphql,
      workerId: "cutover-preparation",
      limit: 3,
    });
    assert.equal(outcomes.every((outcome) => outcome.ok), true);
    assert.equal(
      cutoverMock.calls.filter((query) =>
        query.includes("AdaptiveStorefrontProducts"),
      ).length,
      1,
      "only the receipt-bound job forces a current Shopify catalog read",
    );
    const v2 = await fixture.db.autopilotPlan.findFirstOrThrow({
      where: {
        merchantId: merchant.id,
        state: { not: "INVALIDATED" },
      },
    });
    assert.equal(v2.orchestrationProtocolVersion, MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION);
    assert.equal(v2.cutoverReceiptId, cutover.receipt.id);
    assert.equal(
      (await fixture.db.job.findUniqueOrThrow({ where: { id: bound.id } })).status,
      "COMPLETED",
    );
  } finally {
    await fixture.close();
  }
});

test("failed onboarding retries the same lease chain and only explicit action reopens a terminal slot", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "prepare-retry.myshopify.com" },
    });
    const startedAt = new Date("2026-09-05T12:00:00Z");
    const request = {
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint: "https://pagnetic.example/storefront/events",
      now: startedAt,
    };
    const job = await enqueueAutopilotPreparation(request);
    const failed = await runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql: async () => { throw new Error("SHOPIFY_TEMPORARY_FAILURE"); },
      workerId: "preparation-worker-failure",
      now: startedAt,
      clock: () => startedAt,
    });
    assert.deepEqual(failed.map((item) => item.ok), [false]);
    const retry = await fixture.db.job.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(retry.status, "RETRY");
    assert.equal(retry.attempts, 1);
    assert.equal((await fixture.db.merchantNotice.findFirstOrThrow({
      where: { merchantId: merchant.id, kind: "PREPARATION_FAILED" },
    })).status, "OPEN");

    const recoveredAt = new Date(startedAt.getTime() + 3_000);
    const mock = shopifyGraphql();
    const recovered = await runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql: mock.graphql,
      workerId: "preparation-worker-retry",
      now: recoveredAt,
      clock: () => recoveredAt,
    });
    assert.deepEqual(recovered.map((item) => item.ok), [true]);
    assert.equal((await fixture.db.job.findUniqueOrThrow({ where: { id: job.id } })).status, "COMPLETED");
    assert.equal((await fixture.db.merchantNotice.findFirstOrThrow({
      where: { merchantId: merchant.id, kind: "PREPARATION_FAILED" },
    })).status, "RESOLVED");

    await fixture.db.job.update({
      where: { id: job.id },
      data: { status: "DEAD_LETTER", attempts: 5, lastErrorCode: "ATTEMPTS_EXHAUSTED" },
    });
    assert.equal((await enqueueAutopilotPreparation({
      ...request,
      now: new Date(recoveredAt.getTime() + 1_000),
    })).status, "DEAD_LETTER", "ordinary refresh must not reset terminal work");
    const explicit = await enqueueAutopilotPreparation({
      ...request,
      now: new Date(recoveredAt.getTime() + 1_000),
      explicitRetry: true,
    });
    assert.equal(explicit.status, "RETRY");
    assert.equal(explicit.attempts, 0);
  } finally {
    await fixture.close();
  }
});

test("a reclaimed preparation lease cannot persist catalog, plan, or pixel work", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "prepare-reclaimed.myshopify.com" },
    });
    const startedAt = new Date("2026-09-05T12:00:00Z");
    const job = await enqueueAutopilotPreparation({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint: "https://pagnetic.example/storefront/events",
      now: startedAt,
    });
    const productRequest = deferred<void>();
    const productResponse = deferred<Response>();
    const running = runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql: async (query) => {
        assert.match(query, /AdaptiveStorefrontProducts/);
        productRequest.resolve();
        return productResponse.promise;
      },
      workerId: "preparation-worker-stale",
      now: startedAt,
      clock: () => startedAt,
    });
    await productRequest.promise;
    const firstLease = (await fixture.db.job.findUniqueOrThrow({
      where: { id: job.id },
    })).leaseToken;
    const reclaimedAt = new Date(startedAt.getTime() + 5 * 60_000 + 1);
    const reclaimed = await claimJobs({
      db: fixture.db,
      merchantId: merchant.id,
      workerId: "preparation-worker-successor",
      types: ["AUTOPILOT_PREPARATION"],
      now: reclaimedAt,
      maxAttempts: 5,
    });
    assert.equal(reclaimed.length, 1);
    assert.notEqual(reclaimed[0]?.leaseToken, firstLease);
    productResponse.resolve(await shopifyGraphql().graphql(
      "query AdaptiveStorefrontProducts",
    ));
    const outcome = await running;
    assert.deepEqual(outcome.map((item) => item.ok), [false]);
    assert.equal(await fixture.db.product.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal(await fixture.db.autopilotPlan.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal(await fixture.db.pixelCredential.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal((await fixture.db.job.findUniqueOrThrow({ where: { id: job.id } })).leaseToken, reclaimed[0]?.leaseToken);
  } finally {
    await fixture.close();
  }
});

test("uninstall cancels deferred preparation before pixel activation and prevents re-enqueue", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "prepare-uninstalled.myshopify.com" },
    });
    const startedAt = new Date("2026-09-05T12:00:00Z");
    const job = await enqueueAutopilotPreparation({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      endpoint: "https://pagnetic.example/storefront/events",
      now: startedAt,
    });
    const finalization = await enqueueJob({
      db: fixture.db,
      merchantId: merchant.id,
      type: "FINALIZE_RESULT",
      idempotencyKey: "finalize-after-uninstall",
      payload: { experimentId: "fixture-experiment" },
      nextRunAt: startedAt,
    });
    const privacy = await enqueueJob({
      db: fixture.db,
      merchantId: merchant.id,
      type: "PRIVACY_REQUEST",
      idempotencyKey: "privacy-after-uninstall",
      payload: { requestId: "fixture-request" },
      nextRunAt: startedAt,
    });
    const pixelRequest = deferred<void>();
    const pixelResponse = deferred<Response>();
    const mock = shopifyGraphql();
    const graphql = async (query: string) => {
      if (query.includes("CurrentAdaptivePixel")) {
        pixelRequest.resolve();
        return pixelResponse.promise;
      }
      return mock.graphql(query);
    };
    const running = runAutopilotPreparationJobs({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      graphql,
      workerId: "preparation-worker-uninstall",
      now: startedAt,
      clock: () => startedAt,
    });
    await pixelRequest.promise;
    await disableMerchantAfterUninstall({
      db: fixture.db,
      merchantId: merchant.id,
      shop: merchant.shop,
      shopHash: "prepare-uninstalled-hash",
      now: new Date(startedAt.getTime() + 1_000),
    });
    pixelResponse.resolve(Response.json({ data: { webPixel: null } }));
    const outcome = await running;
    assert.deepEqual(outcome.map((item) => item.ok), [false]);
    assert.equal((await fixture.db.job.findUniqueOrThrow({ where: { id: job.id } })).status, "CANCELLED");
    assert.equal(
      (await fixture.db.job.findUniqueOrThrow({ where: { id: finalization.id } })).status,
      "PENDING",
      "financial finalization remains eligible after uninstall",
    );
    assert.equal(
      (await fixture.db.job.findUniqueOrThrow({ where: { id: privacy.id } })).status,
      "PENDING",
      "privacy work remains eligible after uninstall",
    );
    assert.equal(
      await fixture.db.autopilotPlan.count({
        where: { merchantId: merchant.id, state: { not: "INVALIDATED" } },
      }),
      0,
    );
    assert.equal(await fixture.db.pixelCredential.count({ where: { merchantId: merchant.id } }), 0);
    assert.equal(mock.calls.some((query) => query.includes("CreateAdaptivePixel")), false);
    await assert.rejects(
      enqueueAutopilotPreparation({
        db: fixture.db,
        merchantId: merchant.id,
        shop: merchant.shop,
        endpoint: "https://pagnetic-new.example/storefront/events",
        now: new Date(startedAt.getTime() + 2_000),
      }),
      /AUTOPILOT_PREPARATION_INACTIVE/,
    );
  } finally {
    await fixture.close();
  }
});

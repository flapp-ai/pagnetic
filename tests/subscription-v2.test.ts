import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import {
  createShopifyAppPricingProviderV2,
  loadShopifyShopIdV2,
  shopifyAppPricingUrlV2,
} from "../app/services/shopify-app-pricing-v2.server";
import {
  ACTIVE_OFFER_VERSION_V2,
  mapProviderSubscriptionStateV2,
  offerCatalogV2,
  subscriptionAllowsApprovedServingV2,
  verifySubscriptionV2,
} from "../app/services/subscription-v2.server";

const partnerEnvironment = {
  SHOPIFY_PARTNER_ORGANIZATION_ID: "12345",
  SHOPIFY_PARTNER_API_TOKEN: "partner-token",
  SHOPIFY_PARTNER_APP_ID: "gid://shopify/App/99",
  SHOPIFY_APP_PRICING_PLAN_HANDLE: "founding_beta",
  SHOPIFY_APP_PRICING_NO_CHARGE_SHOPS: "billing-v2.myshopify.com",
};

function partnerResponse(activeSubscription: unknown, status = 200) {
  return new Response(JSON.stringify({ data: { activeSubscription } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-subscription-v2-"));
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

test("new pricing remains unpublished unless both commercial flags are explicit", () => {
  const closed = offerCatalogV2({});
  assert.equal(closed.find((offer) => offer.version === "founding-beta-v1")?.priceUsdMonthly, 49);
  assert.equal(closed.find((offer) => offer.version === ACTIVE_OFFER_VERSION_V2)?.priceUsdMonthly, 49);
  assert.equal(closed.find((offer) => offer.version === ACTIVE_OFFER_VERSION_V2)?.publishable, false);
  assert.equal(closed.find((offer) => offer.version === "pagnetic-core-99-v1")?.publishable, false);
  const open = offerCatalogV2({
    SHOPIFY_BILLING_ENABLED: "true",
    PAGNETIC_V2_OFFER_PUBLISHABLE: "true",
  });
  assert.equal(open.find((offer) => offer.version === ACTIVE_OFFER_VERSION_V2)?.publishable, true);
  assert.equal(open.find((offer) => offer.version === "pagnetic-core-99-v1")?.publishable, false);
});

test("provider states map explicitly and cancellation retains only its paid-through window", () => {
  const now = new Date("2026-09-05T00:00:00.000Z");
  assert.equal(mapProviderSubscriptionStateV2({ state: "ACTIVE", now }), "ACTIVE");
  assert.equal(mapProviderSubscriptionStateV2({ state: "DECLINED", now }), "CANCELED");
  assert.equal(mapProviderSubscriptionStateV2({
    state: "CANCELLED",
    periodEnd: new Date("2026-09-06T00:00:00.000Z"),
    now,
  }), "CANCEL_AT_PERIOD_END");
  assert.equal(mapProviderSubscriptionStateV2({ state: "unexpected", now }), "FROZEN");
  assert.equal(subscriptionAllowsApprovedServingV2({
    status: "CANCEL_AT_PERIOD_END",
    periodEnd: new Date("2026-09-06T00:00:00.000Z"),
    now,
  }), true);
  assert.equal(subscriptionAllowsApprovedServingV2({
    status: "CANCEL_AT_PERIOD_END",
    periodEnd: new Date("2026-09-04T00:00:00.000Z"),
    now,
  }), false);
});

test("authoritative verification is tenant-bound, idempotent and rejects out-of-order changes", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "subscription-v2.myshopify.com" },
    });
    const now = new Date("2026-09-05T01:00:00.000Z");
    const active = {
      shop: merchant.shop,
      subscriptionId: "gid://shopify/AppSubscription/1",
      offerVersion: "pagnetic-core-99-v1",
      state: "ACTIVE",
      sourceVersion: "provider-event-2",
      updatedAt: new Date("2026-09-05T00:30:00.000Z"),
      periodEnd: new Date("2026-10-05T00:30:00.000Z"),
    };
    const first = await verifySubscriptionV2({
      db: fixture.db,
      merchantId: merchant.id,
      provider: { verify: async () => active },
      now,
    });
    const replay = await verifySubscriptionV2({
      db: fixture.db,
      merchantId: merchant.id,
      provider: { verify: async () => active },
      now,
    });
    assert.equal(first.id, replay.id);
    assert.equal(replay.authoritativeStatus, "ACTIVE");
    const stale = await verifySubscriptionV2({
      db: fixture.db,
      merchantId: merchant.id,
      provider: {
        verify: async () => ({
          ...active,
          state: "CANCELLED",
          sourceVersion: "provider-event-1",
          updatedAt: new Date("2026-09-04T00:30:00.000Z"),
        }),
      },
      now,
    });
    assert.equal(stale.authoritativeStatus, "ACTIVE");
    assert.equal(stale.providerPayloadHash, first.providerPayloadHash);
    await assert.rejects(
      verifySubscriptionV2({
        db: fixture.db,
        merchantId: merchant.id,
        provider: { verify: async () => ({ ...active, shop: "attacker.myshopify.com" }) },
        now,
      }),
      /SUBSCRIPTION_TENANT_MISMATCH/,
    );
  } finally {
    await fixture.close();
  }
});

test("same-watermark conflicting provider facts freeze access without selecting either change", async () => {
  const fixture = testDatabase();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "subscription-conflict.myshopify.com" },
    });
    const updatedAt = new Date("2026-09-05T00:30:00.000Z");
    const provider = (state: string) => ({
      verify: async () => ({
        shop: merchant.shop,
        subscriptionId: "gid://shopify/AppSubscription/2",
        offerVersion: "pagnetic-core-99-v1",
        state,
        sourceVersion: `event-${state}`,
        updatedAt,
      }),
    });
    await verifySubscriptionV2({
      db: fixture.db,
      merchantId: merchant.id,
      provider: provider("ACTIVE"),
      now: new Date("2026-09-05T01:00:00.000Z"),
    });
    const conflict = await verifySubscriptionV2({
      db: fixture.db,
      merchantId: merchant.id,
      provider: provider("CANCELLED"),
      now: new Date("2026-09-05T01:01:00.000Z"),
    });
    assert.equal(conflict.authoritativeStatus, "FROZEN");
    assert.equal(
      await fixture.db.auditLog.count({ where: { action: "SUBSCRIPTION_SOURCE_CONFLICT" } }),
      1,
    );
  } finally {
    await fixture.close();
  }
});

test("Shopify App Pricing provider verifies an active or no-charge contract without creating a charge", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const observedAt = new Date("2026-09-05T04:00:00.000Z");
  const provider = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/7",
    environment: partnerEnvironment,
    now: () => observedAt,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return partnerResponse({
        shop: {
          id: "gid://shopify/Shop/7",
          myshopifyDomain: "billing-v2.myshopify.com",
        },
        billingPeriod: "EVERY_30_DAYS",
        cancelAtEndOfCycle: false,
        trialEndsAt: null,
        currentBillingCycle: {
          startTime: "2026-09-01T00:00:00.000Z",
          endTime: "2026-10-01T00:00:00.000Z",
        },
        items: [{
          handle: "founding_beta",
          price: {
            __typename: "FlatRatePrice",
            active: true,
            currency: "USD",
            amount: "0.00",
          },
        }],
        legacySubscriptionId: null,
      });
    },
  });
  const result = await provider.verify("billing-v2.myshopify.com");
  assert.equal(result.state, "ACTIVE");
  assert.equal(result.offerVersion, ACTIVE_OFFER_VERSION_V2);
  assert.equal(result.periodEnd?.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.match(result.subscriptionId ?? "", /^partner:[a-f0-9]{64}$/);
  assert.equal(requests[0]?.url, "https://partners.shopify.com/12345/api/2026-07/graphql.json");
  assert.equal(new Headers(requests[0]?.init?.headers).get("X-Shopify-Access-Token"), "partner-token");
  const body = JSON.parse(String(requests[0]?.init?.body)) as {
    variables: { appId: string; shopId: string };
  };
  assert.deepEqual(body.variables, {
    appId: "gid://shopify/App/99",
    shopId: "gid://shopify/Shop/7",
  });
  assert.equal(
    shopifyAppPricingUrlV2({
      shop: "billing-v2.myshopify.com",
      appHandle: "pagnetic",
    }),
    "https://admin.shopify.com/store/billing-v2/charges/pagnetic/pricing_plans",
  );
});

test("missing active contract preserves the bounded free evaluation and provider failures fail closed", async () => {
  const observedAt = new Date("2026-09-05T04:00:00.000Z");
  const provider = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: partnerEnvironment,
    now: () => observedAt,
    fetchImpl: async () => partnerResponse(null),
  });
  const source = await provider.verify("free-v2.myshopify.com");
  assert.equal(source.state, "NO_ACTIVE_SUBSCRIPTION");
  assert.equal(source.offerVersion, ACTIVE_OFFER_VERSION_V2);
  assert.equal(mapProviderSubscriptionStateV2({ state: source.state, now: observedAt }), "FREE_EVALUATION");

  const graphqlFailure = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: partnerEnvironment,
    fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: "denied" }] }), { status: 200 }),
  });
  await assert.rejects(
    graphqlFailure.verify("free-v2.myshopify.com"),
    /SHOPIFY_APP_PRICING_GRAPHQL_FAILED/,
  );
  const spoofed = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: partnerEnvironment,
    fetchImpl: async () => partnerResponse({
      shop: { id: "gid://shopify/Shop/8", myshopifyDomain: "attacker.myshopify.com" },
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      trialEndsAt: "2026-09-10T00:00:00.000Z",
      currentBillingCycle: null,
      items: [{
        handle: "founding_beta",
        price: { __typename: "FlatRatePrice", active: true, currency: "USD", amount: "49.00" },
      }],
      legacySubscriptionId: "gid://shopify/AppSubscription/1",
    }),
  });
  await assert.rejects(
    spoofed.verify("free-v2.myshopify.com"),
    /SHOPIFY_APP_PRICING_RESPONSE_INVALID/,
  );
});

test("provider rejects a plan whose handle, cadence, currency or price differs from the approved offer", async () => {
  const provider = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: partnerEnvironment,
    fetchImpl: async () => partnerResponse({
      shop: { id: "gid://shopify/Shop/8", myshopifyDomain: "mismatch.myshopify.com" },
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      trialEndsAt: "2026-10-05T00:00:00.000Z",
      currentBillingCycle: null,
      items: [{
        handle: "founding_beta",
        price: { __typename: "FlatRatePrice", active: true, currency: "USD", amount: "99.00" },
      }],
      legacySubscriptionId: null,
    }),
  });
  await assert.rejects(
    provider.verify("mismatch.myshopify.com"),
    /SHOPIFY_APP_PRICING_OFFER_AMOUNT_MISMATCH/,
  );
});

test("provider accepts Shopify RFC3339 timestamps without fractional seconds", async () => {
  const provider = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: {
      ...partnerEnvironment,
      SHOPIFY_APP_PRICING_NO_CHARGE_SHOPS: "dev-v2.myshopify.com",
    },
    fetchImpl: async () => partnerResponse({
      shop: { id: "gid://shopify/Shop/8", myshopifyDomain: "dev-v2.myshopify.com" },
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      trialEndsAt: "2026-10-05T00:00:00Z",
      currentBillingCycle: null,
      items: [{
        handle: "founding_beta",
        price: { __typename: "FlatRatePrice", active: true, currency: "USD", amount: "0" },
      }],
      legacySubscriptionId: null,
    }),
  });
  const source = await provider.verify("dev-v2.myshopify.com");
  assert.equal(source.state, "ACTIVE");
  assert.equal(source.periodEnd?.toISOString(), "2026-10-05T00:00:00.000Z");
});

test("provider selects the active price when Shopify retains an inactive prior version", async () => {
  const provider = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: partnerEnvironment,
    fetchImpl: async () => partnerResponse({
      shop: { id: "gid://shopify/Shop/8", myshopifyDomain: "billing-v2.myshopify.com" },
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      trialEndsAt: "2026-10-05T00:00:00Z",
      currentBillingCycle: null,
      items: [
        { handle: "founding_beta", price: { __typename: "FlatRatePrice", active: false, currency: "USD", amount: "39.00" } },
        { handle: "founding_beta", price: { __typename: "FlatRatePrice", active: true, currency: "USD", amount: "49.00" } },
      ],
      legacySubscriptionId: null,
    }),
  });
  assert.equal((await provider.verify("billing-v2.myshopify.com")).state, "ACTIVE");
});

test("provider rejects no-charge subscriptions outside the explicit development-store allowlist", async () => {
  const provider = createShopifyAppPricingProviderV2({
    shopId: "gid://shopify/Shop/8",
    environment: partnerEnvironment,
    fetchImpl: async () => partnerResponse({
      shop: { id: "gid://shopify/Shop/8", myshopifyDomain: "public-v2.myshopify.com" },
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      trialEndsAt: "2026-10-05T00:00:00.000Z",
      currentBillingCycle: null,
      items: [{
        handle: "founding_beta",
        price: { __typename: "FlatRatePrice", active: true, currency: "USD", amount: "0.00" },
      }],
      legacySubscriptionId: null,
    }),
  });
  await assert.rejects(
    provider.verify("public-v2.myshopify.com"),
    /SHOPIFY_APP_PRICING_OFFER_AMOUNT_MISMATCH/,
  );
});

test("Admin shop identity parsing rejects errors and non-Shop identifiers", async () => {
  assert.equal(await loadShopifyShopIdV2(async () => new Response(JSON.stringify({
    data: { shop: { id: "gid://shopify/Shop/8" } },
  }), { status: 200 })), "gid://shopify/Shop/8");
  await assert.rejects(
    loadShopifyShopIdV2(async () => new Response(JSON.stringify({
      data: { shop: { id: "gid://shopify/App/8" } },
    }), { status: 200 })),
    /SHOPIFY_SHOP_ID_RESPONSE_INVALID/,
  );
});

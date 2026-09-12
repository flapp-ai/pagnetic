import { createHash } from "node:crypto";

import { canonicalQueuePayload } from "./job-outbox.server";
import type {
  ProviderSubscriptionV2,
  SubscriptionProviderV2,
} from "./subscription-v2.server";
import { ACTIVE_OFFER_VERSION_V2 } from "./subscription-v2.server";

const PARTNER_API_VERSION = "2026-07";
const RESPONSE_LIMIT_BYTES = 128 * 1024;
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const GID_PATTERN = /^gid:\/\/shopify\/(App|Shop)\/\d+$/;

const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query PagneticActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      shop { id myshopifyDomain }
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      currentBillingCycle { startTime endTime }
      items {
        handle
        price {
          __typename
          active
          currency
          ... on FlatRatePrice { amount }
        }
      }
      legacySubscriptionId
    }
  }
`;

type PartnerApiResponse = {
  data?: {
    activeSubscription?: null | {
      shop?: { id?: unknown; myshopifyDomain?: unknown };
      billingPeriod?: unknown;
      cancelAtEndOfCycle?: unknown;
      trialEndsAt?: unknown;
      currentBillingCycle?: null | { startTime?: unknown; endTime?: unknown };
      items?: unknown;
      legacySubscriptionId?: unknown;
    };
  };
  errors?: unknown;
};

function requiredEnvironment(
  environment: Record<string, string | undefined>,
  key: string,
) {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`SHOPIFY_APP_PRICING_${key}_MISSING`);
  return value;
}

function exactDate(value: unknown, code: string) {
  if (typeof value !== "string") throw new Error(code);
  // Shopify's DateTime scalar is RFC 3339, but it may omit fractional seconds.
  // Requiring byte-for-byte equality with Date#toISOString() rejects otherwise
  // valid values such as `2026-09-07T10:00:00Z` because JavaScript adds `.000`.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error(code);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(code);
  return date;
}

function optionalDate(value: unknown, code: string) {
  return value == null ? null : exactDate(value, code);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonicalQueuePayload(value)).digest("hex");
}

function decimalEquals(value: string | null, expected: string) {
  if (value == null) return false;
  const normalize = (candidate: string) => {
    const [whole, fraction = ""] = candidate.split(".");
    return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
  };
  return normalize(value) === normalize(expected);
}

export function shopifyAppPricingUrlV2(args: {
  shop: string;
  appHandle: string;
}) {
  const shop = args.shop.trim().toLowerCase();
  const appHandle = args.appHandle.trim().toLowerCase();
  if (!SHOP_PATTERN.test(shop)) throw new Error("SHOPIFY_APP_PRICING_SHOP_INVALID");
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(appHandle))
    throw new Error("SHOPIFY_APP_PRICING_APP_HANDLE_INVALID");
  return `https://admin.shopify.com/store/${shop.slice(0, -".myshopify.com".length)}/charges/${appHandle}/pricing_plans`;
}

export async function loadShopifyShopIdV2(
  graphql: (query: string) => Promise<Response>,
) {
  const response = await graphql(`#graphql
    query PagneticShopIdentity {
      shop { id }
    }
  `);
  if (!response.ok) throw new Error("SHOPIFY_SHOP_ID_HTTP_FAILED");
  const payload = await response.json() as {
    data?: { shop?: { id?: unknown } };
    errors?: unknown;
  };
  if (
    (Array.isArray(payload.errors) && payload.errors.length) ||
    typeof payload.data?.shop?.id !== "string" ||
    !GID_PATTERN.test(payload.data.shop.id) ||
    !payload.data.shop.id.includes("/Shop/")
  ) throw new Error("SHOPIFY_SHOP_ID_RESPONSE_INVALID");
  return payload.data.shop.id;
}

export function createShopifyAppPricingProviderV2(args: {
  shopId: string;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): SubscriptionProviderV2 {
  const environment = args.environment ?? process.env;
  const organizationId = requiredEnvironment(environment, "SHOPIFY_PARTNER_ORGANIZATION_ID");
  const accessToken = requiredEnvironment(environment, "SHOPIFY_PARTNER_API_TOKEN");
  const appId = requiredEnvironment(environment, "SHOPIFY_PARTNER_APP_ID");
  const planHandle = requiredEnvironment(
    environment,
    "SHOPIFY_APP_PRICING_PLAN_HANDLE",
  );
  const testPlanHandle = environment.SHOPIFY_APP_PRICING_TEST_PLAN_HANDLE?.trim() ?? "";
  const noChargeShops = new Set(
    (environment.SHOPIFY_APP_PRICING_NO_CHARGE_SHOPS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => SHOP_PATTERN.test(value)),
  );
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(organizationId))
    throw new Error("SHOPIFY_APP_PRICING_ORGANIZATION_ID_INVALID");
  if (!GID_PATTERN.test(appId) || !appId.includes("/App/"))
    throw new Error("SHOPIFY_APP_PRICING_APP_ID_INVALID");
  if (!GID_PATTERN.test(args.shopId) || !args.shopId.includes("/Shop/"))
    throw new Error("SHOPIFY_APP_PRICING_SHOP_ID_INVALID");
  if (accessToken.length > 500)
    throw new Error("SHOPIFY_APP_PRICING_ACCESS_TOKEN_INVALID");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(planHandle))
    throw new Error("SHOPIFY_APP_PRICING_PLAN_HANDLE_INVALID");
  if (testPlanHandle && !/^[A-Za-z0-9_-]{1,100}$/.test(testPlanHandle))
    throw new Error("SHOPIFY_APP_PRICING_TEST_PLAN_HANDLE_INVALID");
  const fetchImpl = args.fetchImpl ?? fetch;
  const now = args.now ?? (() => new Date());
  const endpoint = `https://partners.shopify.com/${organizationId}/api/${PARTNER_API_VERSION}/graphql.json`;

  return {
    async verify(requestedShop: string): Promise<ProviderSubscriptionV2> {
      const shop = requestedShop.trim().toLowerCase();
      if (!SHOP_PATTERN.test(shop)) throw new Error("SHOPIFY_APP_PRICING_SHOP_INVALID");
      const observedAt = now();
      if (!Number.isFinite(observedAt.getTime()))
        throw new Error("SHOPIFY_APP_PRICING_OBSERVATION_TIME_INVALID");
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: ACTIVE_SUBSCRIPTION_QUERY,
          variables: { appId, shopId: args.shopId },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("SHOPIFY_APP_PRICING_HTTP_FAILED");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > RESPONSE_LIMIT_BYTES)
        throw new Error("SHOPIFY_APP_PRICING_RESPONSE_TOO_LARGE");
      let payload: PartnerApiResponse;
      try {
        payload = JSON.parse(text) as PartnerApiResponse;
      } catch {
        throw new Error("SHOPIFY_APP_PRICING_RESPONSE_INVALID");
      }
      if (Array.isArray(payload.errors) && payload.errors.length)
        throw new Error("SHOPIFY_APP_PRICING_GRAPHQL_FAILED");
      if (!payload.data || !("activeSubscription" in payload.data))
        throw new Error("SHOPIFY_APP_PRICING_RESPONSE_INVALID");
      const active = payload.data.activeSubscription;
      if (active == null) {
        const sourceHash = digest({ appId, shopId: args.shopId, active: null });
        return {
          shop,
          subscriptionId: null,
          offerVersion: ACTIVE_OFFER_VERSION_V2,
          state: "NO_ACTIVE_SUBSCRIPTION",
          sourceVersion: `partner-${PARTNER_API_VERSION}:${sourceHash}`,
          updatedAt: observedAt,
          periodEnd: null,
          cancellationAt: null,
        };
      }
      if (
        typeof active.shop?.id !== "string" || active.shop.id !== args.shopId ||
        typeof active.shop.myshopifyDomain !== "string" ||
        active.shop.myshopifyDomain.toLowerCase() !== shop ||
        !["EVERY_30_DAYS", "ANNUAL"].includes(String(active.billingPeriod)) ||
        typeof active.cancelAtEndOfCycle !== "boolean" ||
        !Array.isArray(active.items) || active.items.length < 1 || active.items.length > 20
      ) throw new Error("SHOPIFY_APP_PRICING_RESPONSE_INVALID");
      const items = active.items.map((item) => {
        if (!item || typeof item !== "object")
          throw new Error("SHOPIFY_APP_PRICING_ITEM_INVALID");
        const record = item as Record<string, unknown>;
        const price = record.price;
        if (
          typeof record.handle !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(record.handle) ||
          !price || typeof price !== "object"
        ) throw new Error("SHOPIFY_APP_PRICING_ITEM_INVALID");
        const priceRecord = price as Record<string, unknown>;
        if (
          typeof priceRecord.__typename !== "string" ||
          typeof priceRecord.active !== "boolean" ||
          typeof priceRecord.currency !== "string" ||
          !/^[A-Z]{3}$/.test(priceRecord.currency) ||
          (priceRecord.amount != null &&
            (typeof priceRecord.amount !== "string" || !/^\d+(\.\d{1,6})?$/.test(priceRecord.amount)))
        ) throw new Error("SHOPIFY_APP_PRICING_ITEM_INVALID");
        return {
          handle: record.handle,
          type: priceRecord.__typename,
          active: priceRecord.active,
          currency: priceRecord.currency,
          amount: priceRecord.amount ?? null,
        };
      });
      const cycle = active.currentBillingCycle;
      const cycleStart = cycle
        ? exactDate(cycle.startTime, "SHOPIFY_APP_PRICING_CYCLE_INVALID")
        : null;
      const cycleEnd = cycle
        ? exactDate(cycle.endTime, "SHOPIFY_APP_PRICING_CYCLE_INVALID")
        : null;
      if (cycleStart && cycleEnd && cycleEnd <= cycleStart)
        throw new Error("SHOPIFY_APP_PRICING_CYCLE_INVALID");
      const trialEndsAt = optionalDate(
        active.trialEndsAt,
        "SHOPIFY_APP_PRICING_TRIAL_INVALID",
      );
      if (!cycleEnd && !trialEndsAt)
        throw new Error("SHOPIFY_APP_PRICING_PERIOD_MISSING");
      const legacyId = active.legacySubscriptionId;
      if (
        legacyId != null &&
        (typeof legacyId !== "string" || !/^gid:\/\/shopify\/AppSubscription\/\d+$/.test(legacyId))
      ) throw new Error("SHOPIFY_APP_PRICING_SUBSCRIPTION_ID_INVALID");
      const material = {
        appId,
        shopId: args.shopId,
        billingPeriod: active.billingPeriod,
        cancelAtEndOfCycle: active.cancelAtEndOfCycle,
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
        cycleStart: cycleStart?.toISOString() ?? null,
        cycleEnd: cycleEnd?.toISOString() ?? null,
        items,
        legacySubscriptionId: legacyId ?? null,
      };
      if (active.billingPeriod !== "EVERY_30_DAYS")
        throw new Error("SHOPIFY_APP_PRICING_OFFER_CADENCE_MISMATCH");
      const privateTestEligible = noChargeShops.has(shop);
      const allowedHandle = privateTestEligible && testPlanHandle
        ? [planHandle, testPlanHandle]
        : [planHandle];
      const matchingItems = items.filter((item) => allowedHandle.includes(item.handle));
      if (!matchingItems.length)
        throw new Error("SHOPIFY_APP_PRICING_OFFER_HANDLE_MISMATCH");
      // Shopify can retain an inactive prior price beside the current price when
      // a plan is updated. Select the active version of the approved handle.
      // Shopify owns eligibility for no-charge testing of a public plan and
      // returns its effective $0 price inside the canonical active contract.
      // The private test plan remains restricted to the explicit shop list.
      const expectedAmounts = ["49.00", "0.00"];
      const approvedItem = matchingItems.find((item) => item.active) ??
        matchingItems.find((item) =>
          expectedAmounts.some((amount) => decimalEquals(item.amount, amount))) ??
        matchingItems[0];
      if (approvedItem.type !== "FlatRatePrice")
        throw new Error("SHOPIFY_APP_PRICING_OFFER_TYPE_MISMATCH");
      if (approvedItem.currency !== "USD")
        throw new Error("SHOPIFY_APP_PRICING_OFFER_CURRENCY_MISMATCH");
      const approvedPublicPrice = approvedItem.handle === planHandle &&
        ["49.00", "0.00"].some((amount) => decimalEquals(approvedItem.amount, amount));
      const approvedTestPrice = privateTestEligible &&
        approvedItem.handle === testPlanHandle &&
        decimalEquals(approvedItem.amount, "0.00");
      if (!approvedPublicPrice && !approvedTestPrice)
        throw new Error("SHOPIFY_APP_PRICING_OFFER_AMOUNT_MISMATCH");
      const sourceHash = digest(material);
      return {
        shop,
        subscriptionId: typeof legacyId === "string"
          ? legacyId
          : `partner:${sourceHash}`,
        offerVersion: ACTIVE_OFFER_VERSION_V2,
        state: active.cancelAtEndOfCycle
            ? "CANCELLED"
            : "ACTIVE",
        sourceVersion: `partner-${PARTNER_API_VERSION}:${sourceHash}`,
        updatedAt: observedAt,
        periodEnd: cycleEnd ?? trialEndsAt,
        cancellationAt: active.cancelAtEndOfCycle
          ? cycleEnd ?? trialEndsAt ?? observedAt
          : null,
      };
    },
  };
}

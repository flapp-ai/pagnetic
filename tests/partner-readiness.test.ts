import assert from "node:assert/strict";
import test from "node:test";

import { actorKey } from "../app/services/access.server";
import { automationAuthorized } from "../app/services/automation-auth.server";
import {
  decryptField,
  encryptField,
} from "../app/services/field-encryption.server";
import {
  adaptivePanelActivation,
  assessPartnerReadiness,
  evaluateQualification,
  parseScopes,
  scopeHealth,
  themeEditorDeepLink,
} from "../app/services/pilot-setup";
import {
  consumeRateLimit,
  requestAddress,
} from "../app/services/rate-limit.server";
import { privacySecret } from "../app/services/privacy.server";

test("qualifies a product with adequate traffic, orders, and event coverage", () => {
  const result = evaluateQualification({
    windowStart: new Date("2026-07-01T00:00:00Z"),
    windowEnd: new Date("2026-08-01T00:00:00Z"),
    eligibleSessions: 3_100,
    orders: 100,
    revenueAmount: 12_500,
    currencyCode: "USD",
    eventCoverage: 0.98,
    targetSampleSize: 2_000,
    minimumDurationDays: 14,
    maximumDurationDays: 42,
  });
  assert.equal(result.status, "READY");
  assert.equal(Math.round(result.weeklyEligibleSessions), 700);
  assert.ok(result.expectedDurationDays >= 14);
});

test("rejects products that cannot produce a bounded pilot sample", () => {
  const result = evaluateQualification({
    windowStart: new Date("2026-07-01T00:00:00Z"),
    windowEnd: new Date("2026-08-01T00:00:00Z"),
    eligibleSessions: 0,
    orders: 0,
    revenueAmount: 0,
    currencyCode: "USD",
    eventCoverage: 0.95,
    targetSampleSize: 1_000,
    minimumDurationDays: 14,
    maximumDurationDays: 42,
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.equal(result.expectedDurationDays, Number.POSITIVE_INFINITY);
});

test("normalizes scopes and reports missing Shopify access", () => {
  const scopes = parseScopes("read_products, read_orders,read_products");
  assert.deepEqual(scopes, ["read_orders", "read_products"]);
  const health = scopeHealth(scopes);
  assert.equal(health.ready, false);
  assert.ok(health.missing.includes("write_pixels"));
});

test("detects Adaptive Panel activation from the Shopify App API response", () => {
  const status = adaptivePanelActivation([
    {
      type: "theme_app_extension",
      activations: [
        {
          handle: "adaptive-panel",
          status: "active",
          activations: [
            { target: "main", themeId: "gid://shopify/OnlineStoreTheme/1" },
          ],
        },
      ],
    },
  ]);
  assert.equal(status.active, true);
  assert.equal(status.target, "main");
});

test("builds an official published-theme editor deep link", () => {
  const url = new URL(
    themeEditorDeepLink("pilot-store.myshopify.com", "0123456789abcdef"),
  );
  assert.equal(
    url.searchParams.get("addAppBlockId"),
    "0123456789abcdef/adaptive-panel",
  );
  assert.equal(url.searchParams.get("target"), "mainSection");
  assert.equal(url.searchParams.get("template"), "product");
  const selected = new URL(
    themeEditorDeepLink(
      "pilot-store.myshopify.com",
      "0123456789abcdef",
      { handle: "trail-runner", templateSuffix: "campaign-pdp" },
    ),
  );
  assert.equal(selected.searchParams.get("template"), "product.campaign-pdp");
  assert.equal(selected.searchParams.get("previewPath"), "/products/trail-runner");
});

test("requires every partner readiness gate", () => {
  const result = assessPartnerReadiness({
    scopesReady: true,
    brandProfileApproved: true,
    qualificationReady: true,
    themeActive: true,
    qaPassed: 8,
    incidentContactConfigured: true,
    pixelActive: true,
    stableAppUrl: true,
    productionSecretsConfigured: true,
    automationConfigured: true,
    backupConfigured: true,
    alertDeliveryConfigured: true,
    durableDatabaseConfigured: true,
  });
  assert.equal(result.ready, false);
  assert.equal(
    result.checks.find((check) => check.key === "qa")?.passed,
    false,
  );
});

test("encrypts protected settings with authenticated encryption", () => {
  const encrypted = encryptField(
    { name: "Pilot owner", email: "owner@example.com" },
    "a-secure-test-key-that-is-long-enough",
  );
  assert.match(encrypted, /^enc:v1:/);
  assert.ok(!encrypted.includes("owner@example.com"));
  assert.deepEqual(
    decryptField(encrypted, "a-secure-test-key-that-is-long-enough"),
    {
      name: "Pilot owner",
      email: "owner@example.com",
    },
  );
  assert.equal(
    decryptField(encrypted, "the-wrong-key-that-is-also-long-enough"),
    null,
  );
});

test("rate limiting uses a fixed window and honors forwarded client IP", () => {
  const key = `test:${Date.now()}:${Math.random()}`;
  assert.equal(
    consumeRateLimit({ key, limit: 2, windowMilliseconds: 1_000, now: 100 })
      .allowed,
    true,
  );
  assert.equal(
    consumeRateLimit({ key, limit: 2, windowMilliseconds: 1_000, now: 101 })
      .allowed,
    true,
  );
  assert.equal(
    consumeRateLimit({ key, limit: 2, windowMilliseconds: 1_000, now: 102 })
      .allowed,
    false,
  );
  assert.equal(
    consumeRateLimit({ key, limit: 2, windowMilliseconds: 1_000, now: 1_100 })
      .allowed,
    true,
  );
  assert.equal(
    requestAddress(
      new Request("https://example.com", {
        headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
      }),
    ),
    "203.0.113.5",
  );
});

test("actor identifiers are scoped to shop and stripped of unsafe input", () => {
  assert.equal(
    actorKey("pilot.myshopify.com", "user:12/34"),
    "pilot.myshopify.com:user:user1234",
  );
});

test("automation endpoint requires the exact configured bearer secret", () => {
  const secret = "a-production-automation-secret-longer-than-32";
  assert.equal(
    automationAuthorized(
      new Request("https://example.com", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      secret,
    ),
    true,
  );
  assert.equal(
    automationAuthorized(
      new Request("https://example.com", {
        headers: {
          authorization: "Bearer wrong-secret-that-is-long-enough-to-check",
        },
      }),
      secret,
    ),
    false,
  );
  assert.equal(
    automationAuthorized(new Request("https://example.com"), secret),
    false,
  );
});

test("privacy processing refuses a missing production secret", () => {
  assert.throws(() => privacySecret({ NODE_ENV: "production" }), /required/);
  assert.equal(
    privacySecret({ NODE_ENV: "test" }),
    "development-privacy-secret",
  );
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import "@shopify/shopify-app-react-router/adapters/node";
import "@shopify/shopify-api/adapters/web-api";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";

import {
  authenticateAdminWithStaleRecovery,
  expiredRefreshableSession,
  validateWebhookWithoutAdmin,
} from "../app/services/shopify-auth-resilience.server";

function recoveryFixture(overrides: Record<string, unknown> = {}) {
  let attempts = 0;
  let deletes = 0;
  const dependencies = {
    authenticate: async () => {
      attempts += 1;
      if (attempts === 1) throw new Response(undefined, { status: 500 });
      return "authenticated";
    },
    decodeShop: async () => "reviewer.myshopify.com",
    offlineId: (shop: string) => `offline_${shop}`,
    load: async () => ({
      expires: new Date(Date.now() - 60_000),
      refreshToken: "refresh",
      accessToken: "access",
    }),
    deleteMatching: async () => {
      deletes += 1;
      return true;
    },
    ...overrides,
  };
  return { dependencies, counts: () => ({ attempts, deletes }) };
}

const validCheck = {
  valid: true as const,
  apiVersion: "2026-07",
  domain: "reviewer.myshopify.com",
  hmac: "verified",
  topic: "APP_UNINSTALLED",
  webhookId: "webhook-1",
  webhookType: "webhooks" as const,
};

test("validated uninstall webhook does not require an Admin session", async () => {
  let calls = 0;
  const request = new Request("https://pagnetic.com/webhooks/app/uninstalled", {
    method: "POST",
    body: JSON.stringify({ id: 1 }),
  });
  const context = await validateWebhookWithoutAdmin(request, async ({ rawBody }) => {
    calls += 1;
    assert.deepEqual(JSON.parse(rawBody), { id: 1 });
    return validCheck;
  });
  assert.equal(calls, 1);
  assert.equal(context.shop, "reviewer.myshopify.com");
  assert.deepEqual(context.payload, { id: 1 });
});

test("invalid webhook HMAC is rejected", async () => {
  const request = new Request("https://pagnetic.com/webhooks/shop/redact", {
    method: "POST",
    body: "{}",
  });
  await assert.rejects(
    validateWebhookWithoutAdmin(request, async () => ({
      valid: false as const,
      reason: "invalid_hmac" as const,
    })),
    (error: unknown) => error instanceof Response && error.status === 401,
  );
});

test("Shopify SDK HMAC validation accepts the signed body and rejects tampering", async () => {
  const secret = "integration-test-secret";
  const api = shopifyApi({
    apiKey: "integration-test-key",
    apiSecretKey: secret,
    apiVersion: ApiVersion.July26,
    hostName: "pagnetic.test",
    isEmbeddedApp: true,
  });
  const body = JSON.stringify({ shop_id: 42 });
  const headers = {
    "content-type": "application/json",
    "x-shopify-api-version": "2026-07",
    "x-shopify-hmac-sha256": createHmac("sha256", secret).update(body).digest("base64"),
    "x-shopify-shop-domain": "reviewer.myshopify.com",
    "x-shopify-topic": "app/uninstalled",
    "x-shopify-webhook-id": "sdk-webhook-1",
  };
  const valid = await validateWebhookWithoutAdmin(new Request("https://pagnetic.test/webhook", {
    method: "POST", headers, body,
  }), (input) => api.webhooks.validate(input));
  assert.equal(valid.shop, "reviewer.myshopify.com");

  await assert.rejects(validateWebhookWithoutAdmin(new Request("https://pagnetic.test/webhook", {
    method: "POST", headers, body: `${body} `,
  }), (input) => api.webhooks.validate(input)),
  (error: unknown) => error instanceof Response && error.status === 401);
});

test("stale-session recovery is limited to expired sessions with refresh credentials", () => {
  const now = Date.parse("2026-09-07T20:00:00Z");
  assert.equal(expiredRefreshableSession({
    expires: new Date(now - 1),
    refreshToken: "present",
  }, now), true);
  assert.equal(expiredRefreshableSession({
    expires: new Date(now + 1),
    refreshToken: "present",
  }, now), false);
  assert.equal(expiredRefreshableSession({ expires: new Date(now - 1) }, now), false);
});

test("verified expired session is conditionally removed and authentication retries once", async () => {
  const fixture = recoveryFixture();
  const request = new Request("https://pagnetic.com/app?id_token=signed-token");
  assert.equal(await authenticateAdminWithStaleRecovery(request, fixture.dependencies), "authenticated");
  assert.deepEqual(fixture.counts(), { attempts: 2, deletes: 1 });
});

test("invalid session token preserves the original 500 and does not delete", async () => {
  const fixture = recoveryFixture({ decodeShop: async () => { throw new Error("invalid JWT"); } });
  const request = new Request("https://pagnetic.com/app?id_token=invalid");
  await assert.rejects(authenticateAdminWithStaleRecovery(request, fixture.dependencies),
    (error: unknown) => error instanceof Response && error.status === 500);
  assert.deepEqual(fixture.counts(), { attempts: 1, deletes: 0 });
});

test("unexpired or concurrently refreshed session is preserved", async () => {
  const future = recoveryFixture({
    load: async () => ({ expires: new Date(Date.now() + 60_000), refreshToken: "refresh", accessToken: "access" }),
  });
  await assert.rejects(authenticateAdminWithStaleRecovery(
    new Request("https://pagnetic.com/app?id_token=signed"), future.dependencies));
  assert.deepEqual(future.counts(), { attempts: 1, deletes: 0 });

  const raced = recoveryFixture({ deleteMatching: async () => false });
  assert.equal(await authenticateAdminWithStaleRecovery(
    new Request("https://pagnetic.com/app?id_token=signed"), raced.dependencies), "authenticated");
  assert.deepEqual(raced.counts(), { attempts: 2, deletes: 0 });
});

test("a second 500 is returned after one bounded retry", async () => {
  const fixture = recoveryFixture({ authenticate: async () => { throw new Response(undefined, { status: 500 }); } });
  await assert.rejects(authenticateAdminWithStaleRecovery(
    new Request("https://pagnetic.com/app?id_token=signed"), fixture.dependencies),
  (error: unknown) => error instanceof Response && error.status === 500);
});

import assert from "node:assert/strict";
import test from "node:test";
import { verifyShopifyAccountOwner } from "../app/services/shopify-owner-authority.server";

const now = new Date("2026-09-05T12:00:00.000Z");
const args = { request: new Request("https://app.example/app/privacy/opaque", {
  headers: { Authorization: "Bearer authenticated-fixture-session-token" } }),
  shop: "owner-fixture.myshopify.com", subject: "123", tokenExpiresAt: now.getTime() / 1000 + 60, now,
  environment: { SHOPIFY_API_KEY: "fixture-key", SHOPIFY_API_SECRET: "fixture-api-secret" } };
const response = (user: Record<string, unknown>) => new Response(JSON.stringify({
  access_token: "discard-this-access-token", associated_user: {
    id: 123, account_owner: true, collaborator: false, email: "do-not-retain@example.com", ...user,
  },
}));

test("only Shopify-confirmed account owner for the authenticated subject receives short-lived authority", async () => {
  const proof = await verifyShopifyAccountOwner({ ...args, fetcher: async (url, init) => {
    assert.equal(url, "https://owner-fixture.myshopify.com/admin/oauth/access_token");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.subject_token, "authenticated-fixture-session-token");
    assert.equal(body.requested_token_type, "urn:shopify:params:oauth:token-type:online-access-token");
    return response({});
  } });
  assert.deepEqual(proof, { shop: args.shop, userId: "123", expiresAt: new Date(now.getTime() + 60_000) });
  assert.doesNotMatch(JSON.stringify(proof), /discard|retain|secret/);
  for (const user of [{ account_owner: false }, { account_owner: "true" }, { collaborator: true },
    { id: 124 }, { id: "123" }, { id: 9_007_199_254_740_992 }])
    await assert.rejects(verifyShopifyAccountOwner({ ...args, fetcher: async () => response(user) }), /SHOPIFY_ACCOUNT_OWNER_REQUIRED/);
});

test("owner verification fails closed for invalid inputs, provider errors and oversized response without leaking details", async () => {
  for (const input of [{ shop: "evil.example/path" }, { subject: "wrong" }, { tokenExpiresAt: 0 },
    { request: new Request("https://app.example") }])
    await assert.rejects(verifyShopifyAccountOwner({ ...args, ...input,
      fetcher: async () => { throw new Error("must-not-call"); } }), /SHOPIFY_ACCOUNT_OWNER_REQUIRED/);
  for (const fetcher of [async () => new Response("private provider message", { status: 403 }),
    async () => new Response("x".repeat(32_769)), async () => { throw new Error("private network error"); }])
    await assert.rejects(verifyShopifyAccountOwner({ ...args, fetcher }),
      (error: unknown) => error instanceof Error && error.message === "SHOPIFY_ACCOUNT_OWNER_REQUIRED");
});

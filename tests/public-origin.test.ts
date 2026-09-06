import assert from "node:assert/strict";
import test from "node:test";

import { publicAppOrigin } from "../app/services/public-origin.server";

test("public origin prefers the configured Shopify app URL", () => {
  const request = new Request("http://internal:3000/app");
  assert.equal(
    publicAppOrigin(request, "https://public.example/app"),
    "https://public.example",
  );
});

test("public origin honors first trusted proxy values", () => {
  const request = new Request("http://internal:3000/app", {
    headers: {
      "x-forwarded-host": "pilot.example, internal:3000",
      "x-forwarded-proto": "https, http",
    },
  });
  assert.equal(publicAppOrigin(request, ""), "https://pilot.example");
});

test("public origin upgrades a non-local reverse-proxy URL to HTTPS", () => {
  const request = new Request("http://pilot.trycloudflare.com/app");
  assert.equal(publicAppOrigin(request, ""), "https://pilot.trycloudflare.com");
});

test("public origin preserves local HTTP development", () => {
  const request = new Request("http://localhost:3000/app");
  assert.equal(publicAppOrigin(request, ""), "http://localhost:3000");
});

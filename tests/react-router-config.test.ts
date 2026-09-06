import assert from "node:assert/strict";
import test from "node:test";

import config from "../react-router.config";

test("production action origins survive container builds without runtime env", () => {
  assert.deepEqual(
    new Set(config.allowedActionOrigins),
    new Set([
      "admin.shopify.com",
      "pagnetic.fly.dev",
      "pagnetic.com",
      "www.pagnetic.com",
    ]),
  );
});

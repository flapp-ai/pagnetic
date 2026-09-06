import assert from "node:assert/strict";
import test from "node:test";

import { describeBetaEntitlement } from "../app/services/beta-entitlement.server";
import {
  canAcceptPublicBetaStore,
  publicBetaCapacity,
} from "../app/services/public-beta-capacity";

test("public beta capacity is explicit and bounded", () => {
  assert.deepEqual(publicBetaCapacity({ PUBLIC_BETA_MAX_STORES: "25" }), {
    configured: true,
    maximumStores: 25,
  });
  assert.equal(
    canAcceptPublicBetaStore(24, { PUBLIC_BETA_MAX_STORES: "25" }).accepted,
    true,
  );
  assert.equal(
    canAcceptPublicBetaStore(25, { PUBLIC_BETA_MAX_STORES: "25" }).accepted,
    false,
  );
  assert.equal(
    publicBetaCapacity({ PUBLIC_BETA_MAX_STORES: "0" }).configured,
    false,
  );
});

test("entitlement language follows mature result quality without charging", () => {
  const collecting = describeBetaEntitlement({
    status: "FREE_UNTIL_RESULT",
    firstValidResultAt: null,
    firstValidResultState: null,
  });
  assert.equal(collecting.phase, "FREE_UNTIL_RESULT");
  assert.equal(collecting.paymentRequired, false);
  const previousBilling = process.env.SHOPIFY_BILLING_ENABLED;
  process.env.SHOPIFY_BILLING_ENABLED = "false";
  const positive = describeBetaEntitlement({
    status: "CONTINUATION_OFFER",
    firstValidResultAt: new Date(),
    firstValidResultState: "POSITIVE",
    lastResultState: "POSITIVE",
    offerPriceUsd: 49,
  });
  assert.equal(positive.phase, "RESULT_READY");
  assert.equal(positive.paymentRequired, false);
  assert.match(positive.headline, /\$49/);
  const inconclusive = describeBetaEntitlement({
    status: "FREE_EXTENSION",
    firstValidResultAt: new Date(),
    firstValidResultState: "INCONCLUSIVE",
    lastResultState: "INCONCLUSIVE",
    freeExtensionUntil: new Date("2026-10-04T00:00:00Z"),
    revisedExperimentsRemaining: 1,
  });
  assert.equal(inconclusive.phase, "FREE_EXTENSION");
  assert.equal(inconclusive.paymentRequired, false);
  const invalid = describeBetaEntitlement({
    status: "FREE_UNTIL_VALID_RESULT",
    firstValidResultAt: null,
    firstValidResultState: null,
    lastResultState: "INVALID",
  });
  assert.equal(invalid.phase, "FREE_UNTIL_RESULT");
  assert.equal(invalid.paymentRequired, false);
  if (previousBilling == null) delete process.env.SHOPIFY_BILLING_ENABLED;
  else process.env.SHOPIFY_BILLING_ENABLED = previousBilling;
});

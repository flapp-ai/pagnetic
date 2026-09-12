import assert from "node:assert/strict";
import test from "node:test";

import { subscriptionPresentation } from "../app/components/subscription-presentation";

test("renders provider-confirmed active end date without inventing one", () => {
  const result = subscriptionPresentation({
    status: "ACTIVE",
    periodEnd: "2026-10-12T00:00:00Z",
    cancellationAt: null,
  });
  assert.equal(result.heading, "Active");
  assert.match(result.detail, /Oct 12, 2026/);
  assert.equal(result.requiresReapproval, false);
});

test("requires reapproval when active state has no provider date", () => {
  const result = subscriptionPresentation({ status: "ACTIVE", periodEnd: null });
  assert.equal(result.requiresReapproval, true);
  assert.match(result.heading, /date unavailable/);
  assert.doesNotMatch(result.detail, /30/);
});

test("renders cancellation at period end as access through provider date", () => {
  const result = subscriptionPresentation({
    status: "CANCEL_AT_PERIOD_END",
    periodEnd: "2026-10-12T00:00:00Z",
  });
  assert.equal(result.heading, "Cancellation scheduled");
  assert.match(result.detail, /access through Oct 12, 2026/);
  assert.equal(result.requiresReapproval, false);
});

test("pending approval and canceled subscriptions prompt review", () => {
  assert.equal(
    subscriptionPresentation({ status: "PENDING_APPROVAL" }).requiresReapproval,
    true,
  );
  assert.equal(
    subscriptionPresentation({ status: "CANCELED", periodEnd: null }).requiresReapproval,
    true,
  );
});

test("provider refresh failure never presents persisted active state", () => {
  const result = subscriptionPresentation({
    status: "VERIFICATION_UNAVAILABLE",
    verifiedAt: null,
    periodEnd: null,
  });
  assert.equal(result.requiresReapproval, true);
  assert.match(result.heading, /VERIFICATION UNAVAILABLE/);
  assert.match(result.detail, /not confirmed an active paid plan/);
});

test("local evaluation date is not described as Shopify-confirmed", () => {
  const result = subscriptionPresentation({
    status: "FREE_EVALUATION",
    periodEnd: "2026-10-12T00:00:00Z",
    providerVerified: false,
  });
  assert.match(result.detail, /locally recorded/);
  assert.doesNotMatch(result.detail, /Shopify has confirmed/);
  assert.equal(result.date, null);
});

test("active state at or beyond provider end is expired", () => {
  const result = subscriptionPresentation(
    { status: "ACTIVE", periodEnd: "2026-10-12T00:00:00Z" },
    new Date("2026-10-12T00:00:00Z"),
  );
  assert.equal(result.requiresReapproval, true);
  assert.match(result.heading, /Expired/);
});

test("scheduled cancellation at its exact provider end is expired", () => {
  const result = subscriptionPresentation(
    { status: "CANCEL_AT_PERIOD_END", periodEnd: "2026-10-12T00:00:00Z" },
    new Date("2026-10-12T00:00:00Z"),
  );
  assert.equal(result.requiresReapproval, true);
  assert.equal(result.heading, "Expired — reapproval required");
});

test("scheduled cancellation after its provider end is expired", () => {
  const result = subscriptionPresentation(
    { status: "CANCEL_AT_PERIOD_END", periodEnd: "2026-10-12T00:00:00Z" },
    new Date("2026-10-13T00:00:00Z"),
  );
  assert.equal(result.requiresReapproval, true);
  assert.match(result.heading, /Expired/);
});

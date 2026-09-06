import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_CONTRACT_VERSION,
  appendCampaignRef,
  campaignSignature,
  createMappingSnapshot,
  resolveAdaptiveMapping,
} from "../app/services/adaptive-contracts";

const base = {
  merchantId: "m-1",
  productId: "p-1",
  locale: "en",
  campaignRef: "travel-light",
  signature: campaignSignature({ source: "instagram", campaign: "travel-light" }),
  mappingVersion: 1,
  bundleId: "bundle-light",
  status: "ACTIVE" as const,
};

test("adaptive contract is versioned and snapshot hashes are order independent", () => {
  assert.equal(ADAPTIVE_CONTRACT_VERSION, "adaptive-a-1");
  const one = createMappingSnapshot([base]);
  const two = createMappingSnapshot([{ ...base, campaignRef: "commute", bundleId: "bundle-commute" }, base]);
  const three = createMappingSnapshot([base, { ...base, campaignRef: "commute", bundleId: "bundle-commute" }]);
  assert.equal(two.hash, three.hash);
  assert.notEqual(one.hash, two.hash);
});

test("maps only the exact tenant/product/locale and falls back safely", () => {
  const snapshot = createMappingSnapshot([base]);
  assert.deepEqual(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: "travel-light", snapshot }), {
    bundleId: "bundle-light", mappingVersion: 1, reason: "MAPPED_CAMPAIGN", fallback: "ORIGINAL",
  });
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-2", productId: "p-1", locale: "en", campaignRef: "travel-light", snapshot }).reason, "UNKNOWN_CAMPAIGN");
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-2", locale: "en", campaignRef: "travel-light", snapshot }).reason, "UNKNOWN_CAMPAIGN");
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: "opaque?bad", snapshot }).reason, "INVALID_CAMPAIGN");
});

test("conflicting, revoked, and expired mappings never select a bundle", () => {
  assert.throws(() => createMappingSnapshot([base, { ...base, mappingVersion: 2, bundleId: "bundle-other" }]));
  const revoked = createMappingSnapshot([{ ...base, status: "REVOKED" }]);
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: "travel-light", snapshot: revoked }).reason, "MAPPING_NOT_ACTIVE");
  const expired = createMappingSnapshot([{ ...base, expiresAt: "2026-09-01T00:00:00.000Z" }]);
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: "travel-light", now: new Date("2026-09-06T00:00:00.000Z"), snapshot: expired }).reason, "MAPPING_EXPIRED");
});

test("campaign link helper preserves unrelated parameters and does not publish", () => {
  assert.equal(appendCampaignRef("https://example.test/p/1?variant=2&utm_source=ig", "travel-light"), "https://example.test/p/1?variant=2&utm_source=ig&pag_campaign=travel-light");
  assert.throws(() => appendCampaignRef("javascript:alert(1)", "travel-light"));
  assert.throws(() => appendCampaignRef("https://user:pass@example.test/p/1", "travel-light"));
});

test("snapshots reject invalid timestamps, conflicting duplicates, and tampering", () => {
  assert.throws(() => createMappingSnapshot([{ ...base, expiresAt: "not-a-timestamp" }]));
  assert.throws(() => createMappingSnapshot([base, { ...base, bundleId: "bundle-other" }]));
  const snapshot = createMappingSnapshot([base]);
  const mutated = { ...snapshot, mappings: [{ ...snapshot.mappings[0], bundleId: "bundle-tampered" }] };
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: "travel-light", snapshot: mutated }).reason, "INVALID_SNAPSHOT");
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: 42 as unknown as string, snapshot }).reason, "INVALID_CAMPAIGN");
  assert.equal(resolveAdaptiveMapping({ merchantId: "m-1", productId: "p-1", locale: "en", campaignRef: "travel-light", snapshot: { ...snapshot, mappings: [null as never] } }).reason, "INVALID_SNAPSHOT");
  assert.throws(() => createMappingSnapshot([{ ...base, expiresAt: "2026-09-01T00:00:00+00:00" }]));
});

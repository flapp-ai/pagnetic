import assert from "node:assert/strict";
import test from "node:test";

import {
  GOVERNANCE_POLICY_VERSION,
  hashValue,
} from "../app/services/governance.server";
import {
  canonicalProductId,
  inferAngleKey,
  normalizeRuntimeContext,
  validateRuntimeExperience,
} from "../app/services/runtime.server";

function validExperience() {
  const product = { id: "product_1", sourceVersion: "2026-09-02T12:00:00Z" };
  const benefits = [
    "Availability: All options are available for sale.",
    "Product type: snowboard.",
    "Vendor: Example Vendor.",
  ];
  const content = {
    headline: "Example Snowboard",
    supportingLine: null,
    benefits,
    proofItems: [],
    reassurance: null,
  };
  const claimText = benefits[0];
  const evidence = {
    productId: product.id,
    sourceVersion: product.sourceVersion,
    verbatimText: claimText,
    merchantStatus: "APPROVED",
    expiresAt: null,
    riskClass: "LOW",
    sourceHash: hashValue(claimText),
  };

  return {
    status: "APPROVED_ACTIVE",
    ...content,
    benefitsJson: JSON.stringify(benefits),
    proofItemsJson: "[]",
    contentHash: hashValue(content),
    sourceSnapshotHash: "source_snapshot_hash",
    approval: {
      contentHash: hashValue(content),
      evidenceSnapshotHash: "source_snapshot_hash",
      policyVersion: GOVERNANCE_POLICY_VERSION,
    },
    product,
    claims: [content.headline, ...benefits].map((benefit) => ({
      claimText: benefit,
      evidenceLinks: [
        {
          evidence: {
            ...evidence,
            verbatimText: benefit,
            sourceHash: hashValue(benefit),
          },
        },
      ],
    })),
  };
}

test("canonicalizes only Shopify product identifiers", () => {
  assert.equal(canonicalProductId("123"), "gid://shopify/Product/123");
  assert.equal(
    canonicalProductId("gid://shopify/Product/123"),
    "gid://shopify/Product/123",
  );
  assert.equal(canonicalProductId("gid://shopify/Order/123"), null);
});

test("normalizes and bounds public campaign context", () => {
  assert.equal(normalizeRuntimeContext(" Meta Ads! "), "meta_ads");
  assert.equal(normalizeRuntimeContext("a".repeat(200)).length, 128);
});

test("infers only a clearly labelled acquisition angle", () => {
  const angles = [
    {
      key: "comfort",
      label: "Comfort",
      description: "Ease, reassurance, and comfort",
    },
    {
      key: "performance",
      label: "Performance",
      description: "Capability and performance",
    },
    { key: "universal", label: "Universal", description: "All traffic" },
  ];
  assert.equal(
    inferAngleKey("meta_winter_performance_launch", angles),
    "performance",
  );
  assert.equal(inferAngleKey("meta_generic_launch", angles), null);
});

test("accepts an unchanged approved runtime experience", () => {
  assert.equal(validateRuntimeExperience(validExperience()), null);
});

test("accepts the governed two-benefit minimum for deterministic v2 content", () => {
  const experience = {
    ...validExperience(),
    promptVersion: "deterministic-source-composer-v2.1",
  };
  experience.benefits = experience.benefits.slice(0, 2);
  experience.benefitsJson = JSON.stringify(experience.benefits);
  experience.claims = experience.claims.slice(0, 3);
  const content = {
    headline: experience.headline,
    supportingLine: experience.supportingLine,
    benefits: experience.benefits,
    proofItems: experience.proofItems,
    reassurance: experience.reassurance,
  };
  experience.contentHash = hashValue(content);
  experience.approval.contentHash = experience.contentHash;
  assert.equal(validateRuntimeExperience(experience), null);
});

test("rejects stale evidence and changed approved content", () => {
  const stale = validExperience();
  stale.claims[0].evidenceLinks[0].evidence.sourceVersion = "older";
  assert.equal(validateRuntimeExperience(stale), "evidence_source_stale");

  const changed = validExperience();
  changed.headline = "Changed after approval";
  assert.equal(validateRuntimeExperience(changed), "content_hash_mismatch");
});

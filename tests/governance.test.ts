import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveBrandProfile,
  productDescriptionText,
  rankStatementsForAngle,
  validateExperience,
} from "../app/services/governance.server";
import { diagnoseProductMessage } from "../app/services/message-diagnosis-v2";

test("Shopify HTML descriptions preserve bullet and paragraph evidence boundaries", () => {
  assert.equal(
    productDescriptionText(
      "High-quality ceramic construction Comfortable handle Dishwasher safe",
      "<p>High-quality ceramic construction</p><ul><li>Comfortable handle for a cozy grip</li><li>Dishwasher &amp; microwave safe</li></ul><p>A must-have for Disney fans</p>",
    ),
    "High-quality ceramic construction • Comfortable handle for a cozy grip • Dishwasher & microwave safe • A must-have for Disney fans",
  );
  assert.equal(
    productDescriptionText("Plain description", ""),
    "Plain description",
  );
  assert.equal(
    productDescriptionText(
      "First fact. Second fact. Third fact.",
      "<p>First fact.</p><p>Second fact.</p><p>Third fact.</p>",
    ),
    "First fact. Second fact. Third fact.",
  );
  assert.equal(
    productDescriptionText(
      "Dive into your day with the magic of the sea! The Ariel Mug is inspired by an adventurous mermaid. High-quality ceramic construction Comfortable handle for a cozy grip Dishwasher and microwave safe A must-have for fans.",
      "<p>Dive into your day with the magic of the sea!</p><p>The Ariel Mug is inspired by an adventurous mermaid.</p><ul><li>High-quality ceramic construction</li><li>Comfortable handle for a cozy grip</li><li>Dishwasher and microwave safe</li><li>A must-have for fans.</li></ul>",
    ),
    "Dive into your day with the magic of the sea! • The Ariel Mug is inspired by an adventurous mermaid. • High-quality ceramic construction • Comfortable handle for a cozy grip • Dishwasher and microwave safe • A must-have for fans.",
  );

  const reviewerProduct = productDescriptionText(
    "High-quality ceramic construction Comfortable handle Dishwasher safe A must-have for fans",
    "<ul><li>High-quality ceramic construction</li><li>Comfortable handle for a cozy grip</li><li>Dishwasher and microwave safe</li><li>A must-have for Disney fans and ocean lovers</li></ul>",
  );
  const diagnosis = diagnoseProductMessage({
    source: {
      title: "Ariel Mug",
      description: reviewerProduct,
      locale: "en",
    },
    campaignAdText: "Dishwasher and microwave safe Ariel Mug",
  });
  assert.equal(diagnosis.status, "PROPOSED");
  assert.match(diagnosis.primary?.headline ?? "", /dishwasher and microwave safe/i);
});

function evidence(
  overrides: Partial<{
    verbatimText: string;
    merchantStatus: string;
    expiresAt: Date | null;
    riskClass: string;
  }> = {},
) {
  return {
    verbatimText: "Availability: All options are available for sale.",
    merchantStatus: "APPROVED",
    expiresAt: null,
    riskClass: "LOW",
    ...overrides,
  };
}

test("accepts a three-item, approved, verbatim evidence bundle", () => {
  const claims = [
    "Availability: All options are available for sale.",
    "Product type: snowboard.",
    "Vendor: Example Vendor.",
  ];

  assert.deepEqual(
    validateExperience({
      headline: "Example Snowboard",
      benefits: claims,
      claims: ["Example Snowboard", ...claims].map((claimText) => ({
        claimText,
        evidence: [evidence({ verbatimText: claimText })],
      })),
    }),
    [],
  );
});

test("blocks unsupported, unapproved, expired, and high-risk evidence", () => {
  const findings = validateExperience({
    headline: "Example Snowboard",
    benefits: ["Claim one", "Claim two"],
    claims: [
      {
        claimText: "Example Snowboard",
        evidence: [evidence({ verbatimText: "Example Snowboard" })],
      },
      {
        claimText: "Claim one",
        evidence: [evidence({ verbatimText: "Claim one" })],
      },
      {
        claimText: "Claim two",
        evidence: [evidence({ verbatimText: "Claim two" })],
      },
      {
        claimText: "Unsupported claim",
        evidence: [
          evidence({
            verbatimText: "Different source text",
            merchantStatus: "STALE",
            expiresAt: new Date("2020-01-01T00:00:00.000Z"),
            riskClass: "HIGH",
          }),
        ],
      },
    ],
  });
  const codes = new Set(findings.map((finding) => finding.code));

  assert.deepEqual(
    codes,
    new Set([
      "BENEFIT_COUNT",
      "NOT_VERBATIM_SUPPORTED",
      "EVIDENCE_NOT_APPROVED",
      "EVIDENCE_EXPIRED",
      "PILOT_RISK_BLOCK",
    ]),
  );
});

test("blocks claims with no linked evidence", () => {
  const findings = validateExperience({
    headline: "Example Snowboard",
    benefits: ["One", "Two", "Three"],
    claims: [
      {
        claimText: "Example Snowboard",
        evidence: [evidence({ verbatimText: "Example Snowboard" })],
      },
      { claimText: "One", evidence: [] },
      { claimText: "Two", evidence: [evidence({ verbatimText: "Two" })] },
      { claimText: "Three", evidence: [evidence({ verbatimText: "Three" })] },
    ],
  });

  assert.equal(findings[0]?.code, "EVIDENCE_MISSING");
});

test("ranks evidence statements for an angle without rewriting them", () => {
  const statements = [
    { text: "Built for everyday use.", sourceId: "one" },
    { text: "A soft and comfortable liner.", sourceId: "two" },
    { text: "Precision construction for performance.", sourceId: "three" },
  ];
  const ranked = rankStatementsForAngle("comfort", statements);
  assert.equal(ranked[0].sourceId, "two");
  assert.deepEqual(
    new Set(ranked.map((item) => item.text)),
    new Set(statements.map((item) => item.text)),
  );
});

test("derives a reproducible brand profile from merchant catalog text", () => {
  const first = deriveBrandProfile([
    {
      title: "Precision Board",
      description: "Engineered material. Tested performance.",
      vendor: "North",
    },
  ]);
  const second = deriveBrandProfile([
    {
      title: "Precision Board",
      description: "Engineered material. Tested performance.",
      vendor: "North",
    },
  ]);
  assert.deepEqual(first, second);
  assert.ok(first.voiceTraits.includes("technical"));
  assert.ok(first.vocabulary.includes("precision"));
});

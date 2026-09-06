import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveBrandProfile,
  rankStatementsForAngle,
  validateExperience,
} from "../app/services/governance.server";

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

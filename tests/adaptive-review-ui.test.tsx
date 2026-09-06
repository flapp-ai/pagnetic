import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AdaptivePackageReviewPanel } from "../app/components/adaptive-package-review";
import { ADAPTIVE_EXPERIMENT_QUESTIONS } from "../app/services/adaptive-contracts";

test("owner review renders exact bundle, mapping, protocol, coverage and authority hashes before approval", () => {
  const packageHash = "a".repeat(64);
  const snapshotHash = "b".repeat(64);
  const contentHash = "c".repeat(64);
  const authorityHash = "d".repeat(64);
  const sourceHash = "e".repeat(64);
  const router = createMemoryRouter([{ path: "/", element:
      <AdaptivePackageReviewPanel
        busy={false}
        reviewId="review-1"
        reviewStatus="PENDING"
        productId="product-1"
        package={{
              schemaVersion: "adaptive-a-1", merchantId: "merchant-1", productId: "product-1",
              productSourceVersion: "source-v1", productSourceHash: sourceHash, packageHash,
              bundleSet: {
                snapshot: { version: 1, hash: snapshotHash, mappings: [] },
                bundleIds: { "bundle-1": "bundle-1" },
                bundleHashes: { "bundle-1": contentHash },
                bundleAuthorityHashes: { "bundle-1": authorityHash },
              },
              reviewPayload: {
                protocolVersion: "adaptive-owner-review-a1",
                experimentQuestions: ADAPTIVE_EXPERIMENT_QUESTIONS,
                mappings: [{
                  mappingId: "mapping-1", campaignRef: "campaign-ref-1", mappingVersion: 2,
                  locale: "en", utmSource: "meta", utmCampaign: "commute", utmContent: "video-a",
                  campaignEvidenceRef: "document-1", campaignEvidenceHash: "f".repeat(64),
                  campaignEvidenceText: "Keep commuter cables and devices organized.", angleId: "angle-1", angleLabel: "Commute",
                  bundleId: "bundle-1", bundleVersion: 3, contentHash, contentAuthorityHash: authorityHash,
                  sourceSnapshotHash: sourceHash, headline: "Keep daily gear organized", supportingLine: "One place for essentials.",
                  benefits: ["Two pockets separate cables.", "A zip closure keeps items together."],
                  proofItems: ["The pouch measures 20 cm wide."], reassurance: "One pouch is included.",
                  faq: [{ question: "How wide is it?", answer: "The pouch measures 20 cm wide.", evidenceIds: ["evidence-1"] }],
                  claims: [{ text: "The pouch measures 20 cm wide.", claimType: "PRODUCT_FACT", evidenceIds: ["evidence-1"] }],
                  evidence: [{ id: "evidence-1", sourceType: "SHOPIFY_PRODUCT_FIELD", sourceId: "description", sourceVersion: "source-v1", sourceHash, verbatimText: "The pouch measures 20 cm wide.", productScope: "gid://shopify/Product/1", localeScope: "en", expiresAt: null }],
                }],
              },
              coverage: { activeMappings: 2, mappedBundles: 1, unmappedMappings: 1 },
        } as never}
      />
  }], { initialEntries: ["/"] });
  const html = renderToStaticMarkup(<RouterProvider router={router} />);
  for (const exact of [
    "Keep commuter cables and devices organized.",
    "Keep daily gear organized",
    "Two pockets separate cables.",
    "How wide is it?",
    "adaptive-owner-review-a1",
    "adaptive-original-vs-matched-a1",
    "adaptive-universal-vs-matched-a1",
    packageHash,
    snapshotHash,
    contentHash,
    authorityHash,
    "1/2 active mappings",
  ]) assert.ok(html.includes(exact), `missing exact review value: ${exact}`);
  assert.ok(html.includes("Approve this exact adaptive package"));
});

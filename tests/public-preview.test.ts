import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicPreviews,
  previewStatements,
} from "../app/services/public-preview";
import {
  isPublicAddress,
  normalizePublicProductUrl,
  parsePublicProductHtml,
} from "../app/services/public-preview.server";

test("public product URL normalization accepts only public HTTPS product paths", () => {
  assert.equal(
    normalizePublicProductUrl(
      "shop.example/products/board?variant=1#details",
    ).toString(),
    "https://shop.example/products/board",
  );
  assert.throws(
    () => normalizePublicProductUrl("http://shop.example/products/board"),
    /public HTTPS/,
  );
  assert.throws(
    () => normalizePublicProductUrl("https://127.0.0.1/products/board"),
    /not a local or IP/,
  );
  assert.throws(
    () => normalizePublicProductUrl("https://shop.example/collections/boards"),
    /\/products\//,
  );
});

test("public address guard blocks local and private network targets", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("10.2.3.4"), false);
  assert.equal(isPublicAddress("192.168.1.2"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fd00::1"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("2001:db8::1"), false);
});

test("extracts exact product source from Shopify-compatible structured data", () => {
  const source = parsePublicProductHtml(`<!doctype html><html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Trail Shoe - Wide","description":"Soft lining. Durable sole. Everyday value included.","brand":{"@type":"Brand","name":"North"}}</script>
  </head></html>`);
  assert.deepEqual(source, {
    title: "Trail Shoe - Wide",
    description: "Soft lining. Durable sole. Everyday value included.",
    vendor: "North",
    productType: null,
  });
});

test("declared storefront locale is retained for diagnosis scope", () => {
  const source = parsePublicProductHtml(`<!doctype html><html lang="tr"><head>
    <meta property="og:title" content="Günlük Çanta">
    <meta property="og:description" content="Yumuşak astar. Güçlü dikiş. Kolay bakım.">
  </head></html>`);
  assert.equal(source.locale, "tr");
  assert.equal(buildPublicPreviews(source).diagnosis.status, "UNSUPPORTED_SOURCE");
});

test("instant preview diagnoses one distinct change using only merchant source statements", () => {
  const description =
    "A soft and comfortable liner. Precision construction for tested performance. Every accessory is included for everyday value. Built for daily use.";
  const result = buildPublicPreviews({
    title: "North Precision Board",
    description,
  });
  assert.ok(result.cards.length >= 2 && result.cards.length <= 3);
  assert.equal(result.diagnosis.status, "PROPOSED");
  assert.notEqual(
    result.cards.find((card) => card.key === "primary")?.headline,
    result.cards.find((card) => card.key === "original")?.headline,
  );
  const sources = new Set(previewStatements(description));
  for (const card of result.cards) {
    for (const statement of card.evidence) {
      if (statement !== "North Precision Board") assert.ok(sources.has(statement));
    }
  }
  assert.equal(result.readiness, "PREVIEW_READY");
});

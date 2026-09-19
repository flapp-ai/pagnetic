import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

register(new URL("./css-module-loader.mjs", import.meta.url));
process.env.SHOPIFY_API_KEY ||= "reviewer-ui-test-key";
process.env.SHOPIFY_API_SECRET ||= "reviewer-ui-test-secret";
process.env.SHOPIFY_APP_URL ||= "http://localhost:3000";

const { MessagesView } = await import("../app/routes/app.messages");
const { ResultsView } = await import("../app/routes/app.results");
const { SettingsView } = await import("../app/routes/app.settings");

function renderRoute(element: ReactElement) {
  const router = createMemoryRouter([{ path: "/", element }], {
    initialEntries: ["/"],
  });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function messageData(status: string, options: { draft?: boolean; stale?: boolean } = {}) {
  return {
    products: [{ id: "product-1", title: "Travel pouch" }],
    product: {
      id: "product-1",
      title: "Travel pouch",
      description: "Two internal pockets separate cables and adapters.",
      imageUrl: null,
      imageAlt: "Travel pouch",
    },
    diagnosis: {
      mode: "CLARITY_REVIEW",
      gapType: status === "NO_SUPPORTED_OPPORTUNITY"
        ? "NO_SUPPORTED_OPPORTUNITY"
        : "BENEFIT_NOT_PROMINENT",
      rationale: "The source was checked against the current product facts.",
      status,
      stale: options.stale ?? false,
    },
    experiences: options.draft
      ? [{
          id: "draft-1",
          status: "DRAFT",
          angle: "Universal",
          headline: "Two internal pockets separate cables and adapters.",
          supportingLine: null,
          benefits: ["Keeps small items separate.", "One place for travel essentials."],
          reassurance: null,
          claims: [{
            text: "Two internal pockets separate cables and adapters.",
            sources: ["Two internal pockets separate cables and adapters."],
          }],
        }]
      : [],
    angles: [{ id: "angle-1", label: "Universal" }],
    plan: null,
    packageReview: null,
  };
}

test("Messages renders persisted drafted diagnosis as success and keeps source refresh available", () => {
  const html = renderRoute(createElement(MessagesView, {
    data: messageData("EXPERIENCE_DRAFTED", { draft: true }),
    result: undefined,
    busy: false,
  } as never));

  assert.match(html, /Source-backed draft ready/);
  assert.match(html, /Refresh source review/);
  assert.match(html, /Exact proposed message/);
  assert.doesNotMatch(html, /No unsafe copy was invented/);
});

test("Messages distinguishes persisted abstention and stale diagnosis states", () => {
  const abstained = renderRoute(createElement(MessagesView, {
    data: messageData("NO_SUPPORTED_OPPORTUNITY"),
    result: undefined,
    busy: false,
  } as never));
  assert.match(abstained, /No supported message opportunity/);
  assert.match(abstained, /No unsafe copy was invented/);
  assert.match(abstained, /Refresh source review/);

  const stale = renderRoute(createElement(MessagesView, {
    data: messageData("DRAFT", { stale: true }),
    result: undefined,
    busy: false,
  } as never));
  assert.match(stale, /Source review out of date/);
  assert.match(stale, /product facts changed/);
  assert.match(stale, /Refresh source review/);
});

test("Messages preserves campaign fields after an actionable failure", () => {
  const html = renderRoute(createElement(MessagesView, {
    data: messageData("NO_SUPPORTED_OPPORTUNITY"),
    result: {
      ok: false,
      message: "Refresh the source review, then try again.",
      campaignForm: {
        utmSource: "meta",
        utmCampaign: "autumn-launch",
        utmContent: "video-01",
        angleId: "angle-1",
        campaignAdText: "Keep cables and adapters organized.",
      },
    },
    busy: false,
  } as never));

  assert.match(html, /value="meta"/);
  assert.match(html, /value="autumn-launch"/);
  assert.match(html, /value="video-01"/);
  assert.match(html, /Keep cables and adapters organized\./);
  assert.match(html, /Refresh the source review, then try again\./);
});

test("Settings does not claim reviewed serving authority without a plan", () => {
  const html = renderRoute(createElement(SettingsView, {
    data: {
      shop: "reviewer-store.myshopify.com",
      currentRole: "SETUP",
      paused: false,
      plan: null,
      subscription: null,
      offer: null,
      providerConfigured: false,
      pricingUrl: null,
      retention: { rawDays: 90, aggregateDays: 730 },
      surfaces: [],
      incidents: [],
    },
    result: undefined,
    busy: false,
  } as never));

  assert.match(html, /Original storefront only/);
  assert.match(html, /No active plan/);
  assert.match(html, /Read-only setup access/);
  assert.doesNotMatch(html, /Reviewed authority active/);
  assert.doesNotMatch(html, /Advanced\/operator workspace/);
  assert.doesNotMatch(html, /Open storefront verification/);
});

test("Results disables its empty experiment controls and explains why", () => {
  const html = renderRoute(createElement(ResultsView, {
    data: {
      experiments: [],
      selected: null,
      result: null,
      reviewNotice: null,
      privacyRestricted: false,
      servingContext: null,
      actionContext: null,
    },
    actionResult: undefined,
    busy: false,
  } as never));

  assert.match(html, /<select disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Show result<\/button>/);
  assert.match(html, /There is no result to show until a reviewed plan starts an experiment/);
});

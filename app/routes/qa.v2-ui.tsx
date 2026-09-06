import type { ComponentProps } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";

import { uiQaReadOnlyResponse, uiQaRequestAllowed } from "../services/ui-qa-fixture.server";
import { DashboardView } from "./app._index";
import { MessagesView } from "./app.messages";
import { ResultsView } from "./app.results";
import { SettingsView } from "./app.settings";

type FixtureView = "overview" | "messages" | "results" | "settings";

export const loader = ({ request }: LoaderFunctionArgs) => {
  if (!uiQaRequestAllowed(request)) throw new Response("Not found", { status: 404 });
  const selected = new URL(request.url).searchParams.get("view");
  const view: FixtureView = ["overview", "messages", "results", "settings"].includes(selected ?? "")
    ? selected as FixtureView
    : "overview";
  return { view };
};

export const action = ({ request }: ActionFunctionArgs) => {
  if (!uiQaRequestAllowed(request)) throw new Response("Not found", { status: 404 });
  return uiQaReadOnlyResponse();
};

export const meta = () => [
  { title: "Pagnetic local UI QA" },
  { name: "robots", content: "noindex,nofollow" },
];

function fixture<T>(value: unknown) {
  return value as T;
}

const overview = fixture<ComponentProps<typeof DashboardView>["data"]>({
  shop: "fixture.myshopify.com",
  preparationError: null,
  preparationPending: false,
  themeEditorUrl: "#fixture-theme-editor",
  view: {
    merchantState: {
      state: "NEEDS_ATTENTION",
      severity: "attention",
      owner: "MERCHANT",
      eyebrow: "One Shopify action",
      headline: "Save the approved panel on the published product template",
      detail: "Pagnetic is serving Original until the exact published template is verified.",
      primaryAction: { label: "Open theme editor", href: "#fixture-theme-editor" },
    },
    product: {
      id: "fixture-product",
      title: "Trail Runner",
      handle: "trail-runner",
      templateSuffix: null,
      description: "Soft recycled knit, responsive foam and durable rubber for everyday movement.",
      imageUrl: null,
      imageAlt: "Trail Runner",
    },
    plan: {
      id: "fixture-plan",
      state: "WAITING_FOR_THEME",
      planHash: "a".repeat(64),
      qualificationBand: "STRONG",
      durationBand: "49 days or longer",
      timelineLabel: "Registered measurement windows: 56–84 days after activation, plus any setup delay",
      explanations: ["The product has enough source evidence for one bounded message test."],
      hasMediumRisk: false,
    },
    notices: [{
      id: "fixture-notice",
      kind: "THEME_ACTIVATION_REQUIRED",
      title: "Published theme verification is still required",
      detail: "Preview the exact product, click Save, then return for product-specific verification.",
      actionLabel: "Review the two steps",
      actionHref: "#enable-title",
    }],
    noticeHistory: [],
    candidates: [],
    experiences: [],
    measurement: null,
    result: null,
    safety: { originalServing: true },
    activity: [{
      id: "fixture-activity",
      state: "WAITING_FOR_THEME",
      reason: "APPROVED_PLAN_NEEDS_THEME",
      occurredAt: "2026-09-05T11:45:00.000Z",
    }],
  },
});

const messages = fixture<ComponentProps<typeof MessagesView>["data"]>({
  products: [{ id: "fixture-product", title: "Trail Runner" }],
  product: {
    id: "fixture-product",
    title: "Trail Runner",
    description: "Soft recycled knit supports comfortable daily movement. Responsive foam supports steady movement. Durable rubber provides grip on city streets.",
    imageUrl: null,
    imageAlt: "Trail Runner",
  },
  diagnosis: {
    mode: "CLARITY_REVIEW",
    gapType: "BENEFIT_NOT_PROMINENT",
    rationale: "A supported benefit appears later in the product description and can be made more prominent.",
    status: "EXPERIENCE_DRAFTED",
  },
  experiences: [{
    id: "fixture-experience",
    status: "DRAFT",
    angle: "Universal",
    headline: "Soft recycled knit supports comfortable daily movement.",
    supportingLine: null,
    benefits: [
      "Responsive foam supports steady movement.",
      "Durable rubber provides grip on city streets.",
    ],
    reassurance: null,
    claims: [
      {
        text: "Soft recycled knit supports comfortable daily movement.",
        sources: ["Soft recycled knit supports comfortable daily movement."],
      },
      {
        text: "Responsive foam supports steady movement.",
        sources: ["Responsive foam supports steady movement."],
      },
      {
        text: "Durable rubber provides grip on city streets.",
        sources: ["Durable rubber provides grip on city streets."],
      },
    ],
  }],
  angles: [{ id: "fixture-angle", label: "Universal" }],
  plan: { id: "fixture-plan", state: "READY_FOR_APPROVAL" },
});

const results = fixture<ComponentProps<typeof ResultsView>["data"]>({
  experiments: [{
    id: "fixture-experiment",
    label: "Trail Runner · message test",
    status: "COMPLETED",
    final: true,
  }],
  selected: {
    id: "fixture-experiment",
    productTitle: "Trail Runner",
    testType: "ORIGINAL vs UNIVERSAL",
    status: "COMPLETED",
    assignments: 2_400,
    target: 2_000,
    enrollmentStartedAt: "2026-07-01T00:00:00.000Z",
    enrollmentClosedAt: "2026-07-22T00:00:00.000Z",
    attributionClosesAt: "2026-07-29T00:00:00.000Z",
    financialMaturityAt: "2026-08-05T00:00:00.000Z",
    finalizedAt: "2026-08-05T00:05:00.000Z",
    registrationHash: "b".repeat(64),
    analysisVersion: "assigned-visitor-welch-v2.3",
  },
  result: {
    id: "fixture-result-snapshot",
    state: "POSITIVE",
    createdAt: "2026-08-05T00:05:00.000Z",
    dataMaturityAt: "2026-08-05T00:00:00.000Z",
    dataHash: "c".repeat(64),
    reportMarkdown: "# Frozen result\n\nSelected-product merchandise only. This fixture contains deliberately long report text to validate wrapping without changing the immutable report.",
    analysis: {
      resultState: "POSITIVE",
      currencyCode: "USD",
      relativeEffect: .08,
      estimatedAdditionalSalesMinor: "184200",
      confidenceLevel: .95,
      intervalMinor: { lower: 12.5, upper: 93.75 },
      control: { assignments: 1_202, paidPurchasers: 104, netRevenueMinor: "2250000", meanMinor: 1871.88 },
      treatment: { assignments: 1_198, paidPurchasers: 121, netRevenueMinor: "2434200", meanMinor: 2031.89 },
      reasons: [],
    },
    financial: { complete: true, linkedEligibleOrders: 225, reconciledLinkedOrders: 225, contradictoryLinks: 0 },
  },
  reviewNotice: null,
  actionContext: {
    snapshotId: "fixture-result-snapshot",
    resultState: "POSITIVE",
    measurementCheck: false,
    contentVersionId: "fixture-experience",
    currentDeploymentId: "fixture-deployment",
    currentRevision: 2,
    currentPolicy: "UNIVERSAL",
    currentState: "ACTIVE",
    entitled: false,
    idempotencyBase: "result-fixture-result-snapshot",
  },
});

const settings = fixture<ComponentProps<typeof SettingsView>["data"]>({
  shop: "fixture.myshopify.com",
  paused: false,
  plan: { id: "fixture-plan", state: "REAL_TEST_RUNNING" },
  subscription: null,
  offer: {
    version: "pagnetic-founding-49-30d-v1",
    name: "Founding Beta",
    priceUsdMonthly: 49,
    evaluation: "One active product and up to three campaign messages. Shopify provides a 30-day trial before monthly billing.",
    publishable: true,
    legacyExisting: false,
  },
  providerConfigured: false,
  pricingUrl: null,
  retention: { rawDays: 90, aggregateDays: 730 },
  surfaces: [
    { key: "STANDARD_CHECKOUT", status: "PASS", applicability: "APPLICABLE", capturedAt: "2026-09-05T11:00:00.000Z", expiresAt: "2026-09-19T11:00:00.000Z" },
    { key: "SHOP_PAY", status: "PENDING", applicability: "UNKNOWN", capturedAt: "2026-09-05T11:00:00.000Z", expiresAt: null },
    { key: "ACCELERATED_CHECKOUT", status: "NOT_APPLICABLE", applicability: "NOT_APPLICABLE", capturedAt: "2026-09-05T11:00:00.000Z", expiresAt: "2026-09-19T11:00:00.000Z" },
  ],
  incidents: [{ id: "fixture-incident", severity: "SEV2", category: "FINANCIAL_RECONCILIATION", summary: "A later financial update needs operator review." }],
});

export default function V2UiQaFixture() {
  const { view } = useLoaderData<typeof loader>();
  const themeFetcher = useFetcher();
  return (
    <>
      <nav aria-label="Local UI QA views" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 16 }}>
        {(["overview", "messages", "results", "settings"] as const).map((item) => (
          <Link aria-current={view === item ? "page" : undefined} key={item} to={`/qa/v2-ui?view=${item}`}>
            {item[0]!.toUpperCase() + item.slice(1)}
          </Link>
        ))}
      </nav>
      {view === "overview" ? (
        <DashboardView actionData={undefined} busy={false} data={overview} themeFetcher={themeFetcher as ComponentProps<typeof DashboardView>["themeFetcher"]} />
      ) : view === "messages" ? (
        <MessagesView busy={false} data={messages} result={undefined} />
      ) : view === "results" ? (
        <ResultsView actionResult={undefined} busy={false} data={results} />
      ) : (
        <SettingsView busy={false} data={settings} result={undefined} />
      )}
    </>
  );
}

import { randomUUID } from "node:crypto";

import prisma from "../app/db.server";

if (process.env.ALLOW_MEASUREMENT_SMOKE !== "1") {
  throw new Error(
    "Set ALLOW_MEASUREMENT_SMOKE=1 for an intentional development-store event check.",
  );
}
const shop = String(process.env.MEASUREMENT_SHOP ?? "");
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
  throw new Error("MEASUREMENT_SHOP is invalid.");
const session = await prisma.session.findFirst({
  where: { shop, isOnline: false },
});
if (!session) throw new Error("No offline Shopify session is available.");
const merchant = await prisma.merchant.findUnique({ where: { shop } });
if (!merchant) throw new Error("Merchant not found.");
const decision = await prisma.decision.findFirst({
  where: { merchantId: merchant.id },
  orderBy: { occurredAt: "desc" },
  include: { experiment: true },
});
if (!decision?.experiment)
  throw new Error("Run one measured storefront decision before this check.");

const pixelResponse = await fetch(
  `https://${shop}/admin/api/2026-07/graphql.json`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken,
    },
    body: JSON.stringify({
      query: "query AdaptivePixelSettings { webPixel { id settings } }",
    }),
  },
);
const pixelJson = (await pixelResponse.json()) as {
  data?: { webPixel?: { settings?: string | Record<string, unknown> } };
};
const rawSettings = pixelJson.data?.webPixel?.settings;
const settings =
  typeof rawSettings === "string" ? JSON.parse(rawSettings) : rawSettings;
if (!settings || typeof settings !== "object")
  throw new Error("Active pixel settings were unavailable.");
const config = settings as Record<string, unknown>;
if (
  typeof config.endpoint !== "string" ||
  typeof config.token !== "string" ||
  config.shop !== shop
) {
  throw new Error("Active pixel settings are incomplete.");
}

const eventId = `evt_smoke_${randomUUID()}`;
const payload = {
  schemaVersion: 1,
  shop,
  token: config.token,
  eventId,
  eventType: "adaptive_storefront_render",
  occurredAt: new Date().toISOString(),
  clientId: "shopify_smoke_client",
  consentState: "analytics_allowed",
  decisionId: decision.id,
  experimentId: decision.experiment.key,
  visitorId: decision.visitorId,
  sessionId: decision.sessionId,
  productId: decision.productId,
  data: { status: "rendered", errorCode: null },
};
const transmit = () =>
  fetch(config.endpoint as string, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(payload),
  }).then((response) => response.json());
const first = await transmit();
const second = await transmit();
const [event, render] = await Promise.all([
  prisma.commerceEvent.findUnique({
    where: { merchantId_eventId: { merchantId: merchant.id, eventId } },
  }),
  prisma.renderEvent.findUnique({
    where: { merchantId_eventId: { merchantId: merchant.id, eventId } },
  }),
]);
console.log(
  JSON.stringify({
    first,
    second,
    eventRecorded: Boolean(event),
    renderRecorded: Boolean(render),
  }),
);
await prisma.$disconnect();

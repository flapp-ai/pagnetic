import prisma from "../app/db.server";
import {
  registerExperiment,
  activateWebPixel,
} from "../app/services/measurement.server";

if (process.env.ALLOW_MEASUREMENT_ACTIVATION !== "1") {
  throw new Error(
    "Set ALLOW_MEASUREMENT_ACTIVATION=1 for an intentional development-store activation.",
  );
}

const shop = String(process.env.MEASUREMENT_SHOP ?? "");
const endpoint = String(process.env.MEASUREMENT_ENDPOINT ?? "");
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
  throw new Error("MEASUREMENT_SHOP is invalid.");
if (!/^https:\/\/[a-z0-9.-]+\/storefront\/events$/.test(endpoint))
  throw new Error("MEASUREMENT_ENDPOINT is invalid.");

const merchant = await prisma.merchant.findUnique({ where: { shop } });
if (!merchant)
  throw new Error("Merchant has not completed governed-content setup.");
const approved = await prisma.experienceVersion.findFirst({
  where: { merchantId: merchant.id, status: "APPROVED_ACTIVE" },
  orderBy: { publishedAt: "desc" },
  include: { product: true },
});
if (!approved)
  throw new Error("No approved experience is available for an experiment.");
const experiment = await registerExperiment({
  db: prisma,
  merchantId: merchant.id,
  productId: approved.product.id,
  key: "technical-proof-v0",
  controlPercentage: 50,
});
const session = await prisma.session.findFirst({
  where: { shop, isOnline: false },
  orderBy: { expires: "desc" },
});
if (!session) throw new Error("No offline Shopify session is available.");

const credential = await activateWebPixel({
  db: prisma,
  merchantId: merchant.id,
  shop,
  endpoint,
  graphql: (query, options) =>
    fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query, variables: options?.variables }),
    }),
});

console.log(
  JSON.stringify({
    experiment: `${experiment.key}:v${experiment.version}`,
    product: approved.product.title,
    pixel: credential.status,
    webPixelId: credential.webPixelId,
    endpoint: credential.endpoint,
  }),
);
await prisma.$disconnect();

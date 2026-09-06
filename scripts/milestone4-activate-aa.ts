import prisma from "../app/db.server";
import { registerExperiment } from "../app/services/measurement.server";

if (process.env.ALLOW_AA_ACTIVATION !== "1") {
  throw new Error(
    "Set ALLOW_AA_ACTIVATION=1 for an intentional development-store A/A activation.",
  );
}

const shop = String(process.env.MEASUREMENT_SHOP ?? "");
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
  throw new Error("MEASUREMENT_SHOP is invalid.");
}

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
  key: "instrumentation-aa-v0",
  controlPercentage: 50,
  controlPolicy: "ORIGINAL",
  treatmentPolicy: "ORIGINAL",
});

await prisma.experiment.updateMany({
  where: {
    merchantId: merchant.id,
    productId: approved.product.id,
    status: "ACTIVE",
    id: { not: experiment.id },
  },
  data: { status: "PAUSED", endedAt: new Date() },
});

console.log(
  JSON.stringify({
    experiment: `${experiment.key}:v${experiment.version}`,
    product: approved.product.title,
    allocation: `${experiment.controlPercentage}/${100 - experiment.controlPercentage}`,
    policies: [experiment.controlPolicy, experiment.treatmentPolicy],
    status: experiment.status,
  }),
);
await prisma.$disconnect();

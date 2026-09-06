import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { actorKey, ensurePilotRole } from "../services/access.server";
import { ensureMerchant } from "../services/governance.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  await ensurePilotRole({
    db: prisma,
    merchantId: merchant.id,
    actor: actorKey(session.shop, sessionToken.sub),
  });
  const [products, diagnoses, experiments, deployments, subscription] = await Promise.all([
    prisma.product.findMany({
      where: { merchantId: merchant.id },
      select: { id: true, shopifyProductId: true, title: true, handle: true, status: true, sourceVersion: true },
    }),
    prisma.messageDiagnosis.findMany({
      where: { merchantId: merchant.id },
      select: { id: true, productId: true, mode: true, gapType: true, rationale: true, status: true, rulesVersion: true, createdAt: true },
    }),
    prisma.experiment.findMany({
      where: { merchantId: merchant.id },
      include: { registration: true, resultSnapshots: true },
    }),
    prisma.deploymentVersion.findMany({
      where: { merchantId: merchant.id },
      select: { id: true, productId: true, revision: true, protocolVersion: true, policy: true, state: true, contentSetHash: true, createdAt: true },
    }),
    prisma.subscriptionState.findUnique({ where: { merchantId: merchant.id } }),
  ]);
  const payload = {
    schemaVersion: "pagnetic-merchant-export-v1",
    generatedAt: new Date().toISOString(),
    shop: session.shop,
    products,
    diagnoses,
    experiments: experiments.map((experiment) => ({
      id: experiment.id,
      productId: experiment.productId,
      key: experiment.key,
      version: experiment.version,
      status: experiment.status,
      controlPolicy: experiment.controlPolicy,
      treatmentPolicy: experiment.treatmentPolicy,
      enrollmentStartedAt: experiment.enrollmentStartedAt,
      enrollmentClosedAt: experiment.enrollmentClosedAt,
      attributionClosesAt: experiment.attributionClosesAt,
      financialMaturityAt: experiment.financialMaturityAt,
      finalizedAt: experiment.finalizedAt,
      stopReason: experiment.stopReason,
      registration: experiment.registration,
      results: experiment.resultSnapshots,
    })),
    deployments,
    subscription,
    exclusions: ["raw visitor identities", "customer data", "order payloads", "secrets"],
  };
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Disposition": `attachment; filename="pagnetic-${session.shop.replace(/[^a-z0-9-]/gi, "-")}-export.json"`,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
};

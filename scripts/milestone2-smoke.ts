import { PrismaClient } from "@prisma/client";

import {
  approveEvidence,
  approveExperience,
  createCampaignMapping,
  proposeExperience,
  syncProducts,
} from "../app/services/governance.server";

const db = new PrismaClient();
const shop = process.env.GOVERNANCE_SMOKE_SHOP ?? "";

if (process.env.ALLOW_GOVERNANCE_SMOKE !== "1") {
  throw new Error(
    "Set ALLOW_GOVERNANCE_SMOKE=1 to run this mutating dev-store check.",
  );
}
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
  throw new Error(
    "GOVERNANCE_SMOKE_SHOP must be a valid myshopify.com hostname.",
  );
}

async function run() {
  const session = await db.session.findFirst({
    where: { shop, isOnline: false },
    orderBy: { expires: "desc" },
  });
  if (!session)
    throw new Error("No offline Shopify session exists for this store.");
  if (session.expires && session.expires <= new Date()) {
    throw new Error(
      "The offline Shopify session expired; reopen the embedded app first.",
    );
  }

  const actor = `governance-smoke:${shop}`;
  const syncResult = await syncProducts({
    db,
    shop,
    actor,
    graphql: async (query) => {
      const response = await fetch(
        `https://${shop}/admin/api/2026-07/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": session.accessToken,
          },
          body: JSON.stringify({ query }),
        },
      );
      if (!response.ok) {
        throw new Error(`Shopify Admin API returned HTTP ${response.status}.`);
      }
      return response;
    },
  });

  const merchant = await db.merchant.findUniqueOrThrow({ where: { shop } });
  const products = await db.product.findMany({
    where: { merchantId: merchant.id },
    include: { evidence: true },
    orderBy: { syncedAt: "desc" },
  });
  const candidate = products.find((product) => {
    const benefitCount = product.evidence
      .filter(
        (item) =>
          item.sourceVersion === product.sourceVersion &&
          !item.sourceId.endsWith(":title"),
      )
      .reduce(
        (count, item) =>
          count +
          (item.sourceId.endsWith(":description")
            ? item.verbatimText
                .replace(/\s+/g, " ")
                .trim()
                .split(/(?<=[.!?])\s+/)
                .filter(Boolean).length
            : 1),
        0,
      );
    return benefitCount >= 3;
  });
  if (!candidate) {
    throw new Error(
      "No synced product has the three evidence statements required for approval.",
    );
  }

  const currentEvidence = candidate.evidence.filter(
    (item) => item.sourceVersion === candidate.sourceVersion,
  );
  for (const evidence of currentEvidence) {
    await approveEvidence({
      db,
      merchantId: merchant.id,
      evidenceId: evidence.id,
      actor,
    });
  }

  const angle = await db.acquisitionAngle.findUniqueOrThrow({
    where: { merchantId_key: { merchantId: merchant.id, key: "comfort" } },
  });
  const proposal = await proposeExperience({
    db,
    merchantId: merchant.id,
    productId: candidate.id,
    angleId: angle.id,
    actor,
  });
  if (proposal.findingCount !== 0) {
    throw new Error(
      `The smoke proposal has ${proposal.findingCount} validation finding(s).`,
    );
  }
  await approveExperience({
    db,
    merchantId: merchant.id,
    experienceId: proposal.experience.id,
    actor,
  });

  const mapping = await createCampaignMapping({
    db,
    merchantId: merchant.id,
    angleId: angle.id,
    utmSource: "codex-smoke",
    utmCampaign: "governed-content-v1",
    utmContent: "matched-comfort",
    fallback: "ORIGINAL",
    actor,
  });

  console.log(
    JSON.stringify(
      {
        shop,
        syncedProducts: syncResult.productCount,
        staleVersions: syncResult.staleCount,
        approvedProduct: candidate.title,
        approvedExperienceVersion: proposal.experience.version,
        mappingVersion: mapping.version,
      },
      null,
      2,
    ),
  );
}

try {
  await run();
} finally {
  await db.$disconnect();
}

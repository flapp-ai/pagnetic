import type { PrismaClient } from "@prisma/client";

import { buildActivationJourney } from "./activation";
import {
  describeBetaEntitlement,
  ensureBetaEntitlement,
  reconcileBetaEntitlement,
} from "./beta-entitlement.server";

export async function loadActivation(args: {
  db: PrismaClient;
  merchantId: string;
}) {
  const entitlement = await ensureBetaEntitlement(args.db, args.merchantId);
  const [products, brand, pixel, experiments] = await Promise.all([
    args.db.product.findMany({
      where: { merchantId: args.merchantId, status: "ACTIVE" },
      orderBy: { syncedAt: "desc" },
      include: {
        qualification: true,
        themeActivation: true,
        qaChecks: true,
        experiences: {
          where: { status: { in: ["DRAFT", "APPROVED_ACTIVE"] } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            headline: true,
            supportingLine: true,
            benefitsJson: true,
            createdAt: true,
            angle: { select: { key: true, label: true } },
          },
        },
      },
    }),
    args.db.brandProfile.findUnique({ where: { merchantId: args.merchantId } }),
    args.db.pixelCredential.findUnique({
      where: { merchantId: args.merchantId },
    }),
    args.db.experiment.findMany({
      where: { merchantId: args.merchantId },
      include: {
        registration: true,
        resultSnapshots: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    }),
  ]);
  const hero =
    products.find((product) => product.id === entitlement.heroProductId) ??
    products[0] ??
    null;
  const aaExperiments = experiments.filter(
    (experiment) => experiment.controlPolicy === experiment.treatmentPolicy,
  );
  const realExperiments = experiments.filter(
    (experiment) => experiment.controlPolicy !== experiment.treatmentPolicy,
  );
  const firstRealResult = realExperiments
    .flatMap((experiment) => experiment.resultSnapshots)
    .filter((snapshot) =>
      ["POSITIVE", "NEGATIVE", "INCONCLUSIVE"].includes(snapshot.resultState),
    )
    .sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    )[0];
  const resolvedEntitlement =
    firstRealResult && !entitlement.firstValidResultAt
      ? await reconcileBetaEntitlement({
          db: args.db,
          merchantId: args.merchantId,
          snapshotId: firstRealResult.id,
        })
      : entitlement;
  const facts = {
    catalogSynced: products.length > 0,
    heroSelected: Boolean(
      entitlement.heroProductId && hero?.id === entitlement.heroProductId,
    ),
    brandApproved: brand?.status === "APPROVED",
    draftLibraryCreated: Boolean(
      hero?.experiences.some(
        (experience) =>
          experience.status === "DRAFT" ||
          experience.status === "APPROVED_ACTIVE",
      ),
    ),
    contentApproved: Boolean(
      hero?.experiences.some(
        (experience) =>
          experience.status === "APPROVED_ACTIVE" &&
          experience.angle?.key === "universal",
      ),
    ),
    productQualified:
      hero?.qualification?.status === "READY" ||
      Boolean(hero?.qualification?.overriddenAt),
    themeActive: hero?.themeActivation?.activeOnPublishedTheme === true,
    qaComplete: Boolean(
      hero &&
      hero.qaChecks.length >= 9 &&
      hero.qaChecks.every((check) => check.status === "PASSED"),
    ),
    pixelActive: pixel?.status === "ACTIVE",
    aaRegistered: aaExperiments.some(
      (experiment) => experiment.registration != null,
    ),
    aaValidated: aaExperiments.some((experiment) =>
      experiment.resultSnapshots.some(
        (snapshot) => snapshot.resultState === "VALIDATED",
      ),
    ),
    realResultReady: realExperiments.some((experiment) =>
      experiment.resultSnapshots.some((snapshot) =>
        ["POSITIVE", "NEGATIVE", "INCONCLUSIVE"].includes(snapshot.resultState),
      ),
    ),
  };
  return {
    entitlement: resolvedEntitlement,
    entitlementView: describeBetaEntitlement(resolvedEntitlement),
    products,
    hero,
    brand,
    facts,
    journey: buildActivationJourney(facts),
  };
}

export async function selectHeroProduct(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  actor: string;
}) {
  const product = await args.db.product.findFirst({
    where: {
      id: args.productId,
      merchantId: args.merchantId,
      status: "ACTIVE",
    },
  });
  if (!product) throw new Error("Choose an active synced product.");
  const entitlement = await ensureBetaEntitlement(args.db, args.merchantId);
  await args.db.$transaction([
    args.db.betaEntitlement.update({
      where: { id: entitlement.id },
      data: { heroProductId: product.id, activationStage: "HERO_SELECTED" },
    }),
    args.db.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "FOUNDING_BETA_HERO_SELECTED",
        resourceType: "PRODUCT",
        resourceId: product.id,
        detailsJson: JSON.stringify({ offerVersion: entitlement.offerVersion }),
      },
    }),
  ]);
  return product;
}

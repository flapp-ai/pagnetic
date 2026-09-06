import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { canonicalQueuePayload } from "./job-outbox.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "./mvp-v2";
import type { V2ServingPolicy } from "./v2-deployment.server";

export type RegisteredContentV2 = { id: string; contentHash: string };

export async function registerV2Experiment(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  key: string;
  controlPolicy: V2ServingPolicy;
  treatmentPolicy: V2ServingPolicy;
  hypothesis: string;
  minimumMeaningfulLift: number;
  alpha: number;
  power: number;
  targetSampleSize: number;
  minimumDurationDays: number;
  maximumDurationDays: number;
  dataMaturityLagDays?: number;
  contentVersions: RegisteredContentV2[];
  mappingVersions: unknown[];
  guardrails: unknown;
  approvedAuthorityHash: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(args.key))
    throw new Error("V2_REGISTRATION_KEY_INVALID");
  if (!Number.isFinite(now.getTime()) || !/^[a-f0-9]{32,128}$/i.test(args.approvedAuthorityHash))
    throw new Error("V2_REGISTRATION_AUTHORITY_INVALID");
  if (
    !Number.isFinite(args.minimumMeaningfulLift) || args.minimumMeaningfulLift <= 0 ||
    !Number.isFinite(args.alpha) || args.alpha <= 0 || args.alpha > .05 ||
    !Number.isFinite(args.power) || args.power < .8 || args.power >= 1 ||
    !Number.isSafeInteger(args.targetSampleSize) || args.targetSampleSize < 200 ||
    !Number.isSafeInteger(args.minimumDurationDays) || args.minimumDurationDays < 7 ||
    !Number.isSafeInteger(args.maximumDurationDays) || args.maximumDurationDays > 42 ||
    args.maximumDurationDays < args.minimumDurationDays ||
    !Number.isSafeInteger(args.dataMaturityLagDays ?? 7) ||
    (args.dataMaturityLagDays ?? 7) !== 7
  ) throw new Error("V2_REGISTRATION_DESIGN_INVALID");
  if (
    !(
      args.controlPolicy === "ORIGINAL" &&
      ["ORIGINAL", "UNIVERSAL", "MATCHED"].includes(args.treatmentPolicy)
    ) &&
    !(args.controlPolicy === "UNIVERSAL" && args.treatmentPolicy === "MATCHED")
  ) throw new Error("V2_REGISTRATION_POLICY_INVALID");
  if (
    args.controlPolicy === "ORIGINAL" && args.treatmentPolicy === "ORIGINAL" && args.contentVersions.length !== 0 ||
    (args.controlPolicy !== "ORIGINAL" || args.treatmentPolicy !== "ORIGINAL") && args.contentVersions.length < 1
  ) throw new Error("V2_REGISTRATION_CONTENT_INVALID");
  if (
    new Set(args.contentVersions.map((item) => item.id)).size !== args.contentVersions.length ||
    args.contentVersions.some((item) =>
      !item.id || !/^[a-f0-9]{32,128}$/i.test(item.contentHash))
  ) throw new Error("V2_REGISTRATION_CONTENT_INVALID");
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId, status: "ACTIVE" },
    select: { id: true, shopifyProductId: true, sourceVersion: true, sourceHash: true },
  });
  if (!product) throw new Error("V2_REGISTRATION_PRODUCT_UNAVAILABLE");
  const registrationMaterial = {
    protocolVersion: MVP_V2_PROTOCOL_VERSION,
    primaryMetric: MVP_V2_PRIMARY_METRIC,
    merchantId: args.merchantId,
    productId: product.id,
    shopifyProductId: product.shopifyProductId,
    productSourceVersion: product.sourceVersion,
    productSourceHash: product.sourceHash,
    key: args.key,
    hypothesis: args.hypothesis.trim().slice(0, 500),
    revenueDefinition: "NET_FOCAL_MERCHANDISE",
    minimumMeaningfulLift: args.minimumMeaningfulLift,
    alpha: args.alpha,
    power: args.power,
    targetSampleSize: args.targetSampleSize,
    minimumDurationDays: args.minimumDurationDays,
    maximumDurationDays: args.maximumDurationDays,
    randomizationUnit: "CONSENTED_PERSISTENT_VISITOR",
    eligibility: {
      shopifyProductId: product.shopifyProductId,
      productSourceVersion: product.sourceVersion,
      requiresAnalyticsConsent: true,
      requiresPreferencesConsent: true,
    },
    exclusions: ["TEST_ORDER", "GIFT_CARD_PRODUCT", "UNPAID_ORDER", "OUTSIDE_ASSIGNMENT_WINDOW"],
    covariates: [],
    stoppingRule: "FIXED_COHORT_V2",
    analysisVersion: "assigned-visitor-welch-v2.3",
    contentVersions: args.contentVersions,
    mappingVersions: args.mappingVersions,
    guardrails: args.guardrails,
    dataMaturityLagDays: args.dataMaturityLagDays ?? 7,
    approvedAuthorityHash: args.approvedAuthorityHash,
  };
  if (!registrationMaterial.hypothesis)
    throw new Error("V2_REGISTRATION_HYPOTHESIS_INVALID");
  const registrationHash = createHash("sha256")
    .update(canonicalQueuePayload(registrationMaterial))
    .digest("hex");
  const existing = await args.db.experiment.findFirst({
    where: { merchantId: args.merchantId, key: args.key, version: 1 },
    include: { registration: true },
  });
  if (existing) {
    if (existing.productId !== product.id || existing.registration?.registrationHash !== registrationHash)
      throw new Error("V2_REGISTRATION_IDEMPOTENCY_CONFLICT");
    return existing;
  }
  return args.db.experiment.create({
    data: {
      merchantId: args.merchantId,
      productId: product.id,
      key: args.key,
      salt: createHash("sha256").update(`${registrationHash}:assignment-salt`).digest("hex"),
      controlPercentage: 50,
      controlPolicy: args.controlPolicy,
      treatmentPolicy: args.treatmentPolicy,
      attributionWindowDays: 7,
      startedAt: now,
      enrollmentStartedAt: now,
      lifecycleVersion: 2,
      status: "DRAFT",
      registration: {
        create: {
          protocolVersion: MVP_V2_PROTOCOL_VERSION,
          hypothesis: registrationMaterial.hypothesis,
          primaryMetric: MVP_V2_PRIMARY_METRIC,
          revenueDefinition: registrationMaterial.revenueDefinition,
          minimumMeaningfulLift: args.minimumMeaningfulLift,
          alpha: args.alpha,
          power: args.power,
          targetSampleSize: args.targetSampleSize,
          minimumDurationDays: args.minimumDurationDays,
          maximumDurationDays: args.maximumDurationDays,
          randomizationUnit: registrationMaterial.randomizationUnit,
          eligibilityJson: canonicalQueuePayload(registrationMaterial.eligibility),
          exclusionsJson: canonicalQueuePayload(registrationMaterial.exclusions),
          covariatesJson: canonicalQueuePayload(registrationMaterial.covariates),
          stoppingRule: registrationMaterial.stoppingRule,
          analysisVersion: registrationMaterial.analysisVersion,
          contentVersionsJson: canonicalQueuePayload(args.contentVersions),
          mappingVersionsJson: canonicalQueuePayload(args.mappingVersions),
          guardrailsJson: canonicalQueuePayload(args.guardrails),
          dataMaturityLagDays: args.dataMaturityLagDays ?? 7,
          registrationHash,
        },
      },
    },
    include: { registration: true },
  });
}

export async function activateRegisteredV2Experiment(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
}) {
  const changed = await args.db.experiment.updateMany({
    where: {
      id: args.experimentId,
      merchantId: args.merchantId,
      lifecycleVersion: 2,
      status: "DRAFT",
      enrollmentClosedAt: null,
    },
    data: { status: "ACTIVE" },
  });
  if (changed.count === 0) {
    const current = await args.db.experiment.findFirstOrThrow({
      where: { id: args.experimentId, merchantId: args.merchantId },
    });
    if (current.status !== "ACTIVE") throw new Error("V2_REGISTRATION_ACTIVATION_CONFLICT");
    return current;
  }
  return args.db.experiment.findFirstOrThrow({
    where: { id: args.experimentId, merchantId: args.merchantId },
  });
}

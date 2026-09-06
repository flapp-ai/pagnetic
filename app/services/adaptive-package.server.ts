import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  ADAPTIVE_CONTRACT_VERSION,
  ADAPTIVE_EXPERIMENT_QUESTIONS,
  ADAPTIVE_REVIEW_PROTOCOL_VERSION,
  createMappingSnapshot,
} from "./adaptive-contracts";
import { canonicalQueuePayload } from "./job-outbox.server";
import type { AdaptiveBundleSet } from "./v2-deployment.server";
import { installV2Deployment } from "./v2-deployment.server";

type AdaptiveDb = PrismaClient | Prisma.TransactionClient;

type ReviewedEvidence = {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  sourceHash: string;
  verbatimText: string;
  productScope: string;
  localeScope: string;
  expiresAt: string | null;
};

type ReviewedClaim = {
  text: string;
  claimType: string;
  evidenceIds: string[];
};

export type AdaptiveReviewedMapping = {
  mappingId: string;
  campaignRef: string;
  mappingVersion: number;
  locale: string;
  utmSource: string;
  utmCampaign: string;
  utmContent: string;
  campaignEvidenceRef: string | null;
  campaignEvidenceHash: string | null;
  campaignEvidenceText: string | null;
  angleId: string;
  angleLabel: string;
  bundleId: string;
  bundleVersion: number;
  contentHash: string;
  contentAuthorityHash: string;
  sourceSnapshotHash: string;
  headline: string;
  supportingLine: string | null;
  benefits: string[];
  proofItems: string[];
  reassurance: string | null;
  faq: Array<{ question: string; answer: string; evidenceIds: string[] }>;
  claims: ReviewedClaim[];
  evidence: ReviewedEvidence[];
};

export type AdaptiveApprovedPackage = {
  schemaVersion: typeof ADAPTIVE_CONTRACT_VERSION;
  merchantId: string;
  productId: string;
  productSourceVersion: string;
  productSourceHash: string;
  bundleSet: AdaptiveBundleSet;
  packageHash: string;
  reviewPayload: {
    protocolVersion: typeof ADAPTIVE_REVIEW_PROTOCOL_VERSION;
    experimentQuestions: typeof ADAPTIVE_EXPERIMENT_QUESTIONS;
    mappings: AdaptiveReviewedMapping[];
  };
  coverage: {
    activeMappings: number;
    mappedBundles: number;
    unmappedMappings: number;
  };
};

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalQueuePayload(value)).digest("hex");
}

function parseStringArray(value: string, field: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
      throw new Error();
    return parsed;
  } catch {
    throw new Error(`ADAPTIVE_BUNDLE_${field}_INVALID`);
  }
}

function parseFaq(rawOutputJson: string, eligibleEvidenceIds: ReadonlySet<string>) {
  let raw: unknown;
  try {
    raw = JSON.parse(rawOutputJson);
  } catch {
    throw new Error("ADAPTIVE_BUNDLE_RAW_OUTPUT_INVALID");
  }
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { faq?: unknown }).faq))
    return [];
  const faq = (raw as { faq: unknown[] }).faq;
  if (faq.length > 4) throw new Error("ADAPTIVE_BUNDLE_FAQ_INVALID");
  return faq.map((item) => {
    if (!item || typeof item !== "object") throw new Error("ADAPTIVE_BUNDLE_FAQ_INVALID");
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.question !== "string" ||
      !candidate.question.trim() ||
      candidate.question.length > 160 ||
      typeof candidate.answer !== "string" ||
      !candidate.answer.trim() ||
      candidate.answer.length > 500 ||
      !Array.isArray(candidate.evidenceIds) ||
      candidate.evidenceIds.length === 0 ||
      candidate.evidenceIds.some(
        (id) => typeof id !== "string" || !eligibleEvidenceIds.has(id),
      )
    ) throw new Error("ADAPTIVE_BUNDLE_FAQ_INVALID");
    return {
      question: candidate.question,
      answer: candidate.answer,
      evidenceIds: [...new Set(candidate.evidenceIds as string[])].sort(),
    };
  });
}

export function adaptivePackageHash(value: Omit<AdaptiveApprovedPackage, "packageHash">) {
  return sha256(value);
}

async function buildWithDb(args: {
  db: AdaptiveDb;
  merchantId: string;
  productId: string;
  locale: string;
}): Promise<AdaptiveApprovedPackage> {
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId, status: "ACTIVE" },
    select: { id: true, sourceVersion: true, sourceHash: true },
  });
  if (!product) throw new Error("ADAPTIVE_PACKAGE_PRODUCT_UNAVAILABLE");
  const mappings = await args.db.campaignMapping.findMany({
    where: { merchantId: args.merchantId, status: "ACTIVE", campaignLocale: args.locale },
    include: {
      angle: {
        include: {
          experiences: {
            where: {
              merchantId: args.merchantId,
              productId: args.productId,
              status: "APPROVED_ACTIVE",
              staleAt: null,
            },
            include: {
              product: true,
              approval: true,
              claims: { include: { evidenceLinks: { include: { evidence: true } } } },
            },
            orderBy: { version: "desc" },
          },
        },
      },
    },
    orderBy: [{ signature: "asc" }, { version: "desc" }],
  });
  const documentIds = [...new Set(mappings.map((item) => item.campaignEvidenceRef).filter((id): id is string => Boolean(id)))];
  const documents = documentIds.length
    ? await args.db.sourceDocument.findMany({
        where: { id: { in: documentIds }, merchantId: args.merchantId },
        select: { id: true, payloadJson: true, contentHash: true },
      })
    : [];
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const rows = mappings.flatMap((mapping) => {
    const experience = mapping.angle.experiences[0];
    return experience && mapping.campaignEvidenceRef && mapping.campaignEvidenceHash
      ? [{
          merchantId: args.merchantId,
          productId: args.productId,
          locale: args.locale,
          campaignRef: mapping.signature,
          signature: mapping.signature,
          mappingVersion: mapping.version,
          bundleId: experience.id,
          status: "ACTIVE" as const,
        }]
      : [];
  });
  const snapshot = createMappingSnapshot(rows);
  const bundleIds = Object.fromEntries(rows.map((row) => [row.bundleId, row.bundleId]));
  const bundleHashes: Record<string, string> = {};
  const bundleAuthorityHashes: Record<string, string> = {};
  const reviewRows: AdaptiveReviewedMapping[] = [];
  for (const row of rows) {
    const mapping = mappings.find(
      (item) => item.signature === row.signature && item.version === row.mappingVersion,
    );
    const experience = mapping?.angle.experiences[0];
    if (!mapping || !experience?.approval || experience.product.sourceHash !== product.sourceHash)
      throw new Error("ADAPTIVE_BUNDLE_SOURCE_AUTHORITY_INVALID");
    const benefits = parseStringArray(experience.benefitsJson, "BENEFITS");
    const proofItems = parseStringArray(experience.proofItemsJson, "PROOF");
    if (benefits.length < 2 || benefits.length > 4 || proofItems.length > 4)
      throw new Error("ADAPTIVE_BUNDLE_CONTENT_BOUNDS_INVALID");
    const evidence = experience.claims
      .flatMap((claim) => claim.evidenceLinks.map((link) => link.evidence))
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceVersion: item.sourceVersion,
        sourceHash: item.sourceHash,
        verbatimText: item.verbatimText,
        productScope: item.productScope,
        localeScope: item.localeScope,
        expiresAt: item.expiresAt?.toISOString() ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const eligibleEvidenceIds = new Set(evidence.map((item) => item.id));
    const claims = experience.claims.map((claim) => ({
      text: claim.claimText,
      claimType: claim.claimType,
      evidenceIds: claim.evidenceLinks.map((link) => link.evidence.id).sort(),
    })).sort((left, right) => left.text.localeCompare(right.text));
    const evidenceFor = (text: string) => claims.find((claim) => claim.text === text)?.evidenceIds ?? [];
    if (
      evidenceFor(experience.headline).length === 0 ||
      benefits.some((benefit) => evidenceFor(benefit).length === 0) ||
      proofItems.some((proof) => evidenceFor(proof).length === 0) ||
      (experience.reassurance && evidenceFor(experience.reassurance).length === 0)
    ) throw new Error("ADAPTIVE_BUNDLE_EVIDENCE_INVALID");
    const faq = parseFaq(experience.rawOutputJson, eligibleEvidenceIds);
    const campaignDocument = mapping.campaignEvidenceRef
      ? documentById.get(mapping.campaignEvidenceRef)
      : null;
    if (
      mapping.campaignEvidenceRef &&
      (!campaignDocument || campaignDocument.contentHash !== mapping.campaignEvidenceHash)
    ) throw new Error("ADAPTIVE_CAMPAIGN_EVIDENCE_INVALID");
    let campaignEvidenceText: string | null = null;
    if (campaignDocument) {
      try {
        const parsed = JSON.parse(campaignDocument.payloadJson) as { text?: unknown };
        campaignEvidenceText = typeof parsed.text === "string" ? parsed.text : null;
      } catch {
        throw new Error("ADAPTIVE_CAMPAIGN_EVIDENCE_INVALID");
      }
      if (!campaignEvidenceText) throw new Error("ADAPTIVE_CAMPAIGN_EVIDENCE_INVALID");
    }
    const contentAuthority = {
      bundleId: experience.id,
      bundleVersion: experience.version,
      contentHash: experience.contentHash,
      sourceSnapshotHash: experience.sourceSnapshotHash,
      approvalContentHash: experience.approval.contentHash,
      approvalEvidenceSnapshotHash: experience.approval.evidenceSnapshotHash,
      approvalPolicyVersion: experience.approval.policyVersion,
      headline: experience.headline,
      supportingLine: experience.supportingLine,
      benefits,
      proofItems,
      reassurance: experience.reassurance,
      faq,
      claims,
      evidence,
    };
    const contentAuthorityHash = sha256(contentAuthority);
    reviewRows.push({
      mappingId: mapping.id,
      campaignRef: row.campaignRef,
      mappingVersion: row.mappingVersion,
      locale: args.locale,
      utmSource: mapping.utmSource,
      utmCampaign: mapping.utmCampaign,
      utmContent: mapping.utmContent,
      campaignEvidenceRef: mapping.campaignEvidenceRef,
      campaignEvidenceHash: mapping.campaignEvidenceHash,
      campaignEvidenceText,
      angleId: mapping.angleId,
      angleLabel: mapping.angle.label,
      ...contentAuthority,
      contentAuthorityHash,
    });
    bundleHashes[experience.id] = experience.contentHash;
    bundleAuthorityHashes[experience.id] = contentAuthorityHash;
  }
  const material: Omit<AdaptiveApprovedPackage, "packageHash"> = {
    schemaVersion: ADAPTIVE_CONTRACT_VERSION,
    merchantId: args.merchantId,
    productId: args.productId,
    productSourceVersion: product.sourceVersion,
    productSourceHash: product.sourceHash,
    bundleSet: { snapshot, bundleIds, bundleHashes, bundleAuthorityHashes },
    reviewPayload: {
      protocolVersion: ADAPTIVE_REVIEW_PROTOCOL_VERSION,
      experimentQuestions: ADAPTIVE_EXPERIMENT_QUESTIONS,
      mappings: reviewRows,
    },
    coverage: {
      activeMappings: mappings.length,
      mappedBundles: rows.length,
      unmappedMappings: mappings.length - rows.length,
    },
  };
  return { ...material, packageHash: adaptivePackageHash(material) };
}

/** Builds the exact immutable package the owner sees and deployment consumes. */
export async function buildAdaptiveApprovedPackage(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  locale?: string;
}): Promise<AdaptiveApprovedPackage> {
  return args.db.$transaction((tx) =>
    buildWithDb({ ...args, db: tx, locale: args.locale ?? "en" }),
  );
}

export function parseAdaptiveApprovedPackage(value: string): AdaptiveApprovedPackage {
  let parsed: AdaptiveApprovedPackage;
  try {
    parsed = JSON.parse(value) as AdaptiveApprovedPackage;
  } catch {
    throw new Error("ADAPTIVE_REVIEW_PAYLOAD_INVALID");
  }
  if (
    !parsed ||
    parsed.schemaVersion !== ADAPTIVE_CONTRACT_VERSION ||
    parsed.reviewPayload?.protocolVersion !== ADAPTIVE_REVIEW_PROTOCOL_VERSION ||
    parsed.reviewPayload.experimentQuestions?.ORIGINAL_MATCHED?.protocolVersion !== ADAPTIVE_EXPERIMENT_QUESTIONS.ORIGINAL_MATCHED.protocolVersion ||
    parsed.reviewPayload.experimentQuestions?.UNIVERSAL_MATCHED?.protocolVersion !== ADAPTIVE_EXPERIMENT_QUESTIONS.UNIVERSAL_MATCHED.protocolVersion ||
    !Array.isArray(parsed.reviewPayload.mappings) ||
    !parsed.bundleSet ||
    !parsed.bundleSet.bundleIds ||
    !parsed.bundleSet.bundleHashes ||
    !parsed.bundleSet.bundleAuthorityHashes ||
    !/^[a-f0-9]{64}$/.test(parsed.packageHash) ||
    !parsed.productSourceVersion ||
    !/^[a-f0-9]{32,128}$/i.test(parsed.productSourceHash)
  ) throw new Error("ADAPTIVE_REVIEW_PAYLOAD_INVALID");
  const { packageHash, ...material } = parsed;
  if (adaptivePackageHash(material) !== packageHash)
    throw new Error("ADAPTIVE_REVIEW_PAYLOAD_INVALID");
  try {
    const snapshot = createMappingSnapshot(
      parsed.bundleSet.snapshot.mappings,
      parsed.bundleSet.snapshot.version,
    );
    if (snapshot.hash !== parsed.bundleSet.snapshot.hash) throw new Error();
    const reviewedIds = [...new Set(parsed.reviewPayload.mappings.map((item) => item.bundleId))].sort();
    const configuredIds = Object.values(parsed.bundleSet.bundleIds).sort();
    if (
      canonicalQueuePayload(reviewedIds) !== canonicalQueuePayload(configuredIds) ||
      reviewedIds.some((id) =>
        parsed.bundleSet.bundleHashes[id] !==
        parsed.reviewPayload.mappings.find((item) => item.bundleId === id)?.contentHash
      ) ||
      reviewedIds.some((id) =>
        parsed.bundleSet.bundleAuthorityHashes[id] !==
        parsed.reviewPayload.mappings.find((item) => item.bundleId === id)?.contentAuthorityHash
      )
    ) throw new Error();
  } catch {
    throw new Error("ADAPTIVE_REVIEW_PAYLOAD_INVALID");
  }
  return parsed;
}

async function invalidateReview(args: {
  db: PrismaClient;
  merchantId: string;
  reviewId: string;
  reason: string;
}) {
  await args.db.$transaction(async (tx) => {
    const changed = await tx.adaptivePackageReview.updateMany({
      where: {
        id: args.reviewId,
        merchantId: args.merchantId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "INVALIDATED" },
    });
    if (changed.count) await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: "system:adaptive-authority",
        action: "ADAPTIVE_PACKAGE_INVALIDATED",
        resourceType: "ADAPTIVE_PACKAGE_REVIEW",
        resourceId: args.reviewId,
        detailsJson: canonicalQueuePayload({ reason: args.reason }),
      },
    });
  });
}

export async function requireCurrentApprovedAdaptivePackage(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  reviewId: string;
}) {
  const review = await args.db.adaptivePackageReview.findFirst({
    where: { id: args.reviewId, merchantId: args.merchantId, productId: args.productId, status: "APPROVED" },
  });
  if (!review) throw new Error("Owner-approved adaptive package is required.");
  let reviewed: AdaptiveApprovedPackage;
  try {
    reviewed = parseAdaptiveApprovedPackage(review.payloadJson);
  } catch (error) {
    await invalidateReview({ ...args, reason: "REVIEW_PAYLOAD_INVALID" });
    throw error;
  }
  const current = await buildAdaptiveApprovedPackage({ db: args.db, merchantId: args.merchantId, productId: args.productId });
  if (review.packageHash !== reviewed.packageHash || current.packageHash !== reviewed.packageHash) {
    await invalidateReview({ ...args, reason: "MAPPING_SOURCE_OR_REVIEW_DRIFT" });
    throw new Error("Adaptive package changed; review the new package before deploying.");
  }
  return { review, package: reviewed };
}

export async function createAdaptivePackageReview(args: {
  db: PrismaClient;
  package: AdaptiveApprovedPackage;
  actor: string;
}) {
  parseAdaptiveApprovedPackage(JSON.stringify(args.package));
  return args.db.$transaction(async (tx) => {
    await tx.adaptivePackageReview.updateMany({
      where: {
        merchantId: args.package.merchantId,
        productId: args.package.productId,
        packageHash: { not: args.package.packageHash },
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "INVALIDATED" },
    });
    return tx.adaptivePackageReview.upsert({
      where: { merchantId_productId_packageHash: { merchantId: args.package.merchantId, productId: args.package.productId, packageHash: args.package.packageHash } },
      create: {
        merchantId: args.package.merchantId,
        productId: args.package.productId,
        packageHash: args.package.packageHash,
        payloadJson: canonicalQueuePayload(args.package),
        createdBy: args.actor,
      },
      update: {},
    });
  });
}

export async function approveAdaptivePackageReview(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  reviewId: string;
  actor: string;
}) {
  const review = await args.db.adaptivePackageReview.findFirst({
    where: { id: args.reviewId, merchantId: args.merchantId, productId: args.productId, status: "PENDING" },
  });
  if (!review) throw new Error("Adaptive package review is unavailable or already decided.");
  let reviewed: AdaptiveApprovedPackage;
  try {
    reviewed = parseAdaptiveApprovedPackage(review.payloadJson);
  } catch (error) {
    await invalidateReview({ ...args, reason: "REVIEW_PAYLOAD_INVALID" });
    throw error;
  }
  const current = await buildAdaptiveApprovedPackage({ db: args.db, merchantId: args.merchantId, productId: args.productId });
  if (current.packageHash !== review.packageHash || reviewed.packageHash !== review.packageHash) {
    await invalidateReview({ ...args, reason: "MAPPING_SOURCE_OR_REVIEW_DRIFT" });
    throw new Error("Adaptive package changed; review the new package before approving.");
  }
  return args.db.adaptivePackageReview.update({
    where: { id: review.id },
    data: { status: "APPROVED", approvedBy: args.actor, approvedAt: new Date() },
  });
}

export async function installAdaptiveApprovedPackage(args: {
  package: AdaptiveApprovedPackage;
  db: PrismaClient;
  experimentId: string;
  reviewId: string;
  contentVersionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  actor?: string;
  now?: Date;
}) {
  const current = await requireCurrentApprovedAdaptivePackage({
    db: args.db,
    merchantId: args.package.merchantId,
    productId: args.package.productId,
    reviewId: args.reviewId,
  });
  if (current.package.packageHash !== args.package.packageHash)
    throw new Error("Owner-approved adaptive package is required.");
  return installV2Deployment({
    db: args.db,
    merchantId: current.package.merchantId,
    productId: current.package.productId,
    experimentId: args.experimentId,
    contentVersionId: args.contentVersionId,
    adaptiveBundleSet: current.package.bundleSet,
    policy: "MATCHED",
    approvedAuthorityHash: current.package.packageHash,
    expectedRevision: args.expectedRevision,
    idempotencyKey: args.idempotencyKey,
    actor: args.actor,
    now: args.now,
    afterInstall: async ({ tx }) => {
      const authority = await tx.adaptivePackageReview.findFirst({
        where: {
          id: args.reviewId,
          merchantId: current.package.merchantId,
          productId: current.package.productId,
          packageHash: current.package.packageHash,
          status: "APPROVED",
        },
        select: { id: true },
      });
      if (!authority) throw new Error("ADAPTIVE_REVIEW_AUTHORITY_CHANGED");
    },
  });
}

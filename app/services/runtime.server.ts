import type { AcquisitionAngle, Prisma, PrismaClient } from "@prisma/client";

import {
  GOVERNANCE_POLICY_VERSION,
  hashValue,
  validateExperience,
} from "./governance.server";

const CONTEXT_LIMIT = 128;

export type RuntimeOriginalResponse = {
  schemaVersion: 1;
  arm: "original";
  reason: string;
  acquisitionAngle: null;
  mappingVersion: null;
  mappingId: null;
  experience: null;
};

export type RuntimeMatchedResponse = {
  schemaVersion: 1;
  arm: "matched";
  reason: "approved_experience";
  acquisitionAngle: string;
  mappingVersion: number | null;
  mappingId: string | null;
  experience: {
    id: string;
    version: number;
    contentHash: string;
    headline: string;
    supportingLine: string | null;
    benefits: string[];
    proofItems: string[];
    reassurance: string | null;
  };
};

export type StorefrontRuntimeResponse =
  RuntimeOriginalResponse | RuntimeMatchedResponse;

export function normalizeRuntimeContext(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CONTEXT_LIMIT);
}

const INTENT_STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "all",
  "approved",
  "experience",
  "traffic",
]);

export function inferAngleKey(
  context: string,
  angles: Array<{ key: string; label: string; description: string | null }>,
) {
  const contextTokens = new Set(
    normalizeRuntimeContext(context)
      .split(/[_-]+/)
      .filter((token) => token.length > 2),
  );
  const ranked = angles
    .filter((angle) => angle.key !== "universal")
    .map((angle) => {
      const key = normalizeRuntimeContext(angle.key);
      const label = normalizeRuntimeContext(angle.label);
      const descriptionTokens = normalizeRuntimeContext(angle.description)
        .split(/[_-]+/)
        .filter((token) => token.length > 2 && !INTENT_STOP_WORDS.has(token));
      let score = contextTokens.has(key) ? 4 : 0;
      if (contextTokens.has(label)) score += 3;
      score += descriptionTokens.filter((token) =>
        contextTokens.has(token),
      ).length;
      return { angle, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.angle.key.localeCompare(right.angle.key),
    );
  return ranked[0] && ranked[0].score >= 3 ? ranked[0].angle.key : null;
}

export function canonicalProductId(value: string | null | undefined) {
  const candidate = String(value ?? "").trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(candidate)) return candidate;
  if (/^\d+$/.test(candidate)) return `gid://shopify/Product/${candidate}`;
  return null;
}

export function originalRuntimeResponse(
  reason: string,
): RuntimeOriginalResponse {
  return {
    schemaVersion: 1,
    arm: "original",
    reason,
    acquisitionAngle: null,
    mappingVersion: null,
    mappingId: null,
    experience: null,
  };
}

export async function resolveMatchedAngle(args: {
  db: PrismaClient | Prisma.TransactionClient;
  merchantId: string;
  explicitAngle: string | null | undefined;
  utmSource: string | null | undefined;
  utmCampaign: string | null | undefined;
  utmContent: string | null | undefined;
}): Promise<{
  angle: AcquisitionAngle;
  mappingVersion: number | null;
  mappingId: string | null;
} | null> {
  const explicitAngle = normalizeRuntimeContext(args.explicitAngle);
  if (explicitAngle) {
    const angle = await args.db.acquisitionAngle.findUnique({
      where: {
        merchantId_key: { merchantId: args.merchantId, key: explicitAngle },
      },
    });
    return angle?.active
      ? { angle, mappingVersion: null, mappingId: null }
      : null;
  }
  const utmSource = normalizeRuntimeContext(args.utmSource);
  const utmCampaign = normalizeRuntimeContext(args.utmCampaign);
  const utmContent = normalizeRuntimeContext(args.utmContent);
  if (!utmSource || !utmCampaign) return null;
  const mappings = await args.db.campaignMapping.findMany({
    where: {
      merchantId: args.merchantId,
      status: "ACTIVE",
      utmSource,
      utmCampaign,
      utmContent: { in: utmContent ? [utmContent, ""] : [""] },
    },
    include: { angle: true },
  });
  const mapping =
    mappings.find((candidate) => candidate.utmContent === utmContent) ??
    mappings.find((candidate) => candidate.utmContent === "");
  if (mapping?.angle.active)
    return {
      angle: mapping.angle,
      mappingVersion: mapping.version,
      mappingId: mapping.id,
    };

  // Deterministic semantic fallback for clearly labelled campaign content.
  // Ambiguous traffic still follows the merchant's explicit unknown policy.
  const angles = await args.db.acquisitionAngle.findMany({
    where: { merchantId: args.merchantId, active: true },
    orderBy: { key: "asc" },
  });
  const inferredKey = inferAngleKey(`${utmCampaign}_${utmContent}`, angles);
  const inferred = inferredKey
    ? angles.find((candidate) => candidate.key === inferredKey)
    : null;
  return inferred
    ? { angle: inferred, mappingVersion: null, mappingId: null }
    : null;
}

type RuntimeExperience = {
  status: string;
  headline: string;
  supportingLine: string | null;
  benefitsJson: string;
  proofItemsJson: string;
  reassurance: string | null;
  contentHash: string;
  sourceSnapshotHash: string;
  promptVersion?: string;
  approval: {
    contentHash: string;
    evidenceSnapshotHash: string;
    policyVersion: string;
  } | null;
  product: {
    id: string;
    sourceVersion: string;
  };
  claims: Array<{
    claimText: string;
    evidenceLinks: Array<{
      evidence: {
        productId: string | null;
        sourceVersion: string;
        verbatimText: string;
        merchantStatus: string;
        expiresAt: Date | null;
        riskClass: string;
        sourceHash: string;
      };
    }>;
  }>;
};

export function validateRuntimeExperience(experience: RuntimeExperience) {
  if (experience.status !== "APPROVED_ACTIVE") return "experience_not_active";
  if (!experience.approval) return "approval_missing";
  if (
    experience.approval.contentHash !== experience.contentHash ||
    experience.approval.evidenceSnapshotHash !== experience.sourceSnapshotHash
  ) {
    return "approval_hash_mismatch";
  }
  if (experience.approval.policyVersion !== GOVERNANCE_POLICY_VERSION) {
    return "policy_version_mismatch";
  }

  let benefits: string[];
  let proofItems: string[];
  try {
    benefits = JSON.parse(experience.benefitsJson) as string[];
    proofItems = JSON.parse(experience.proofItemsJson) as string[];
  } catch {
    return "content_parse_failed";
  }
  if (!Array.isArray(benefits) || !Array.isArray(proofItems)) {
    return "content_shape_invalid";
  }

  const computedContentHash = hashValue({
    headline: experience.headline,
    supportingLine: experience.supportingLine,
    benefits,
    proofItems,
    reassurance: experience.reassurance,
  });
  if (computedContentHash !== experience.contentHash) {
    return "content_hash_mismatch";
  }

  for (const claim of experience.claims) {
    for (const { evidence } of claim.evidenceLinks) {
      if (evidence.productId !== experience.product.id)
        return "evidence_scope_mismatch";
      if (evidence.sourceVersion !== experience.product.sourceVersion) {
        return "evidence_source_stale";
      }
      if (hashValue(evidence.verbatimText) !== evidence.sourceHash) {
        return "evidence_hash_mismatch";
      }
    }
  }

  const findings = validateExperience({
    headline: experience.headline,
    supportingLine: experience.supportingLine,
    benefits,
    proofItems,
    reassurance: experience.reassurance,
    minimumBenefits: experience.promptVersion?.startsWith(
      "deterministic-source-composer-v2",
    ) ? 2 : 3,
    claims: experience.claims.map((claim) => ({
      claimText: claim.claimText,
      evidence: claim.evidenceLinks.map(({ evidence }) => ({
        verbatimText: evidence.verbatimText,
        merchantStatus: evidence.merchantStatus,
        expiresAt: evidence.expiresAt,
        riskClass: evidence.riskClass,
      })),
    })),
  });
  return findings.length
    ? `validation_${findings[0].code.toLowerCase()}`
    : null;
}

export async function resolveStorefrontExperience(args: {
  db: PrismaClient | Prisma.TransactionClient;
  shop: string;
  productId: string | null | undefined;
  policy: string | null | undefined;
  explicitAngle: string | null | undefined;
  utmSource: string | null | undefined;
  utmCampaign: string | null | undefined;
  utmContent: string | null | undefined;
}): Promise<StorefrontRuntimeResponse> {
  const productId = canonicalProductId(args.productId);
  if (!productId) return originalRuntimeResponse("invalid_product");

  const merchant = await args.db.merchant.findUnique({
    where: { shop: args.shop },
  });
  if (!merchant) return originalRuntimeResponse("merchant_not_configured");
  const runtimeControl = await args.db.runtimeControl.findUnique({
    where: { merchantId: merchant.id },
  });
  if (runtimeControl?.killSwitch) {
    return originalRuntimeResponse("merchant_kill_switch_active");
  }
  const product = await args.db.product.findUnique({
    where: {
      merchantId_shopifyProductId: {
        merchantId: merchant.id,
        shopifyProductId: productId,
      },
    },
  });
  if (!product || product.status !== "ACTIVE") {
    return originalRuntimeResponse("product_not_eligible");
  }

  const policy = normalizeRuntimeContext(args.policy);
  if (policy !== "universal" && policy !== "matched") {
    return originalRuntimeResponse("invalid_policy");
  }

  let angle =
    policy === "universal"
      ? await args.db.acquisitionAngle.findUnique({
          where: {
            merchantId_key: { merchantId: merchant.id, key: "universal" },
          },
        })
      : null;
  let mappingVersion: number | null = null;
  let mappingId: string | null = null;

  if (policy === "matched") {
    const matched = await resolveMatchedAngle({
      ...args,
      merchantId: merchant.id,
    });
    if (matched) {
      angle = matched.angle;
      mappingVersion = matched.mappingVersion;
      mappingId = matched.mappingId;
    } else {
      const settings = await args.db.pilotSettings.findUnique({
        where: { merchantId: merchant.id },
      });
      if (settings?.unknownTrafficPolicy === "UNIVERSAL") {
        angle = await args.db.acquisitionAngle.findUnique({
          where: {
            merchantId_key: { merchantId: merchant.id, key: "universal" },
          },
        });
      } else {
        return originalRuntimeResponse(
          settings?.unknownTrafficPolicy === "EXCLUDE"
            ? "unknown_traffic_excluded"
            : "unknown_traffic_original",
        );
      }
    }
  }
  if (!angle?.active) {
    return originalRuntimeResponse(
      policy === "universal"
        ? "universal_not_configured"
        : "angle_not_resolved",
    );
  }

  const experience = await args.db.experienceVersion.findFirst({
    where: {
      merchantId: merchant.id,
      productId: product.id,
      angleId: angle.id,
      status: "APPROVED_ACTIVE",
    },
    orderBy: { publishedAt: "desc" },
    include: {
      product: true,
      approval: true,
      claims: {
        include: {
          evidenceLinks: { include: { evidence: true } },
        },
      },
    },
  });
  if (!experience)
    return originalRuntimeResponse("approved_experience_missing");

  const runtimeFailure = validateRuntimeExperience(experience);
  if (runtimeFailure) return originalRuntimeResponse(runtimeFailure);

  return {
    schemaVersion: 1,
    arm: "matched",
    reason: "approved_experience",
    acquisitionAngle: angle.key,
    mappingVersion,
    mappingId,
    experience: {
      id: experience.id,
      version: experience.version,
      contentHash: experience.contentHash,
      headline: experience.headline,
      supportingLine: experience.supportingLine,
      benefits: JSON.parse(experience.benefitsJson) as string[],
      proofItems: JSON.parse(experience.proofItemsJson) as string[],
      reassurance: experience.reassurance,
    },
  };
}

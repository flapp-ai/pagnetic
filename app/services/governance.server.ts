import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { campaignSignature } from "./adaptive-contracts";
import { ensureBetaEntitlement } from "./beta-entitlement.server";
import { createDiagnosisDraftV2 } from "./message-diagnosis-v2.server";
import { validateCampaignEvidenceInput } from "./message-diagnosis-v2";
import { canAcceptPublicBetaStore } from "./public-beta-capacity";

export const GOVERNANCE_POLICY_VERSION = "claims-safety-v0.2";
export const DEFAULT_ANGLES = [
  {
    key: "universal",
    label: "Universal",
    description:
      "Use one approved improved experience for all eligible acquisition traffic.",
  },
  {
    key: "comfort",
    label: "Comfort",
    description: "Emphasize approved ease, reassurance, and comfort evidence.",
  },
  {
    key: "performance",
    label: "Performance",
    description: "Emphasize approved capability and performance evidence.",
  },
  {
    key: "value",
    label: "Value",
    description: "Emphasize approved value and product-fit evidence.",
  },
] as const;

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  description: string;
  productType: string;
  vendor: string;
  templateSuffix: string | null;
  updatedAt: string;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      price: string;
      availableForSale: boolean;
    }>;
  };
};

type ProductSyncResponse = {
  data?: {
    products?: {
      nodes?: ShopifyProduct[];
    };
  };
  errors?: Array<{ message: string }>;
};

type Finding = {
  code: string;
  message: string;
};

const BRAND_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "because",
  "been",
  "for",
  "from",
  "have",
  "into",
  "its",
  "more",
  "our",
  "that",
  "the",
  "their",
  "this",
  "with",
  "you",
  "your",
]);

export function deriveBrandProfile(
  samples: Array<{ title: string; description: string; vendor: string }>,
) {
  const corpus = samples
    .map((sample) => `${sample.title}. ${sample.description}`)
    .join(" ")
    .trim();
  const words = corpus.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) ?? [];
  const sentences = corpus
    .split(/[.!?]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const averageSentenceWords = sentences.length
    ? words.length / sentences.length
    : 0;
  const exclamationRate = corpus.length
    ? (corpus.match(/!/g)?.length ?? 0) / Math.max(1, sentences.length)
    : 0;
  const technicalHits = words.filter((word) =>
    new Set([
      "engineered",
      "technology",
      "formula",
      "material",
      "precision",
      "tested",
      "technical",
    ]).has(word),
  ).length;
  const premiumHits = words.filter((word) =>
    new Set([
      "premium",
      "luxury",
      "crafted",
      "signature",
      "exclusive",
      "refined",
    ]).has(word),
  ).length;
  const counts = new Map<string, number>();
  for (const word of words) {
    if (!BRAND_STOP_WORDS.has(word))
      counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const vocabulary = [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 12)
    .map(([word]) => word);
  const voiceTraits = [
    averageSentenceWords && averageSentenceWords <= 14
      ? "concise"
      : "descriptive",
    exclamationRate >= 0.15 ? "energetic" : "measured",
    technicalHits >= 2 ? "technical" : "conversational",
    premiumHits >= 2 ? "premium" : "accessible",
  ];
  return {
    voiceTraits,
    vocabulary,
    analysis: {
      productCount: samples.length,
      sentenceCount: sentences.length,
      averageSentenceWords: Number(averageSentenceWords.toFixed(1)),
      vendors: [
        ...new Set(samples.map((sample) => sample.vendor).filter(Boolean)),
      ].slice(0, 10),
    },
    sourceHash: hashValue(samples),
  };
}

export function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedMappingContext(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128);
}

function descriptionStatements(description: string) {
  const normalized = normalizedText(description);
  if (!normalized) return [];

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .slice(0, 4);
}

const ANGLE_KEYWORDS: Record<string, string[]> = {
  comfort: [
    "comfort",
    "comfortable",
    "easy",
    "ease",
    "soft",
    "smooth",
    "gentle",
    "reassurance",
  ],
  performance: [
    "performance",
    "fast",
    "speed",
    "strong",
    "durable",
    "advanced",
    "precision",
    "power",
  ],
  value: [
    "value",
    "price",
    "included",
    "all",
    "every",
    "available",
    "versatile",
  ],
};

export function rankStatementsForAngle<
  T extends { text: string; sourceId: string },
>(angleKey: string, statements: T[]) {
  const keywords = new Set([angleKey, ...(ANGLE_KEYWORDS[angleKey] ?? [])]);
  return statements
    .map((statement, index) => {
      const tokens = normalizedText(statement.text)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
      const score = tokens.reduce(
        (total, token) => total + (keywords.has(token) ? 1 : 0),
        0,
      );
      return { statement, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ statement }) => statement);
}

export async function ensureMerchant(
  db: PrismaClient | Prisma.TransactionClient,
  shop: string,
) {
  const existingMerchant = await db.merchant.findUnique({ where: { shop } });
  if (!existingMerchant && process.env.NODE_ENV === "production") {
    const capacity = canAcceptPublicBetaStore(await db.merchant.count());
    if (!capacity.accepted) {
      throw new Error(
        "The founding beta is currently at capacity. Contact support to join the next opening.",
      );
    }
  }
  const merchant = await db.merchant.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  await Promise.all(
    DEFAULT_ANGLES.map((angle) =>
      db.acquisitionAngle.upsert({
        where: {
          merchantId_key: { merchantId: merchant.id, key: angle.key },
        },
        update: {
          label: angle.label,
          description: angle.description,
          active: true,
        },
        create: {
          merchantId: merchant.id,
          key: angle.key,
          label: angle.label,
          description: angle.description,
        },
      }),
    ),
  );

  await ensureBetaEntitlement(db, merchant.id);

  return merchant;
}

export async function syncProducts(args: {
  db: PrismaClient;
  shop: string;
  actor: string;
  graphql: (query: string) => Promise<{ json(): Promise<unknown> }>;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  const { db, shop, actor, graphql } = args;
  const merchant = args.assertActive
    ? await db.$transaction(async (tx) => {
        await args.assertActive!(tx);
        return ensureMerchant(tx, shop);
      })
    : await ensureMerchant(db, shop);
  const response = await graphql(`
    #graphql
    query AdaptiveStorefrontProducts {
      products(first: 50, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          status
          description
          productType
          vendor
          templateSuffix
          updatedAt
          featuredImage {
            url
            altText
          }
          variants(first: 25) {
            nodes {
              id
              title
              sku
              price
              availableForSale
            }
          }
        }
      }
    }
  `);
  const payload = (await response.json()) as ProductSyncResponse;

  await args.assertActive?.(db);

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  const products = payload.data?.products?.nodes ?? [];
  let staleCount = 0;

  for (const sourceProduct of products) {
    const snapshot = {
      id: sourceProduct.id,
      title: normalizedText(sourceProduct.title),
      handle: sourceProduct.handle,
      status: sourceProduct.status,
      description: normalizedText(sourceProduct.description),
      productType: normalizedText(sourceProduct.productType),
      vendor: normalizedText(sourceProduct.vendor),
      templateSuffix: normalizedText(sourceProduct.templateSuffix ?? "") || null,
      featuredImage: sourceProduct.featuredImage,
      updatedAt: sourceProduct.updatedAt,
      variants: sourceProduct.variants.nodes,
    };
    const sourceHash = hashValue(snapshot);
    await db.$transaction(async (tx) => {
      await args.assertActive?.(tx);
      const existing = await tx.product.findUnique({
      where: {
        merchantId_shopifyProductId: {
          merchantId: merchant.id,
          shopifyProductId: sourceProduct.id,
        },
      },
      select: { id: true, sourceHash: true },
    });

    if (existing && existing.sourceHash !== sourceHash) {
      const stale = await tx.experienceVersion.updateMany({
        where: { productId: existing.id, status: "APPROVED_ACTIVE" },
        data: { status: "STALE_REVIEW_REQUIRED", staleAt: new Date() },
      });
      staleCount += stale.count;
      await tx.adaptivePackageReview.updateMany({
        where: {
          merchantId: merchant.id,
          productId: existing.id,
          status: { in: ["PENDING", "APPROVED"] },
        },
        data: { status: "INVALIDATED" },
      });
    }

    const product = await tx.product.upsert({
      where: {
        merchantId_shopifyProductId: {
          merchantId: merchant.id,
          shopifyProductId: sourceProduct.id,
        },
      },
      update: {
        title: snapshot.title,
        handle: snapshot.handle,
        status: snapshot.status,
        sourceVersion: snapshot.updatedAt,
        sourceHash,
        sourceSnapshot: JSON.stringify(snapshot),
        syncedAt: new Date(),
      },
      create: {
        merchantId: merchant.id,
        shopifyProductId: sourceProduct.id,
        title: snapshot.title,
        handle: snapshot.handle,
        status: snapshot.status,
        sourceVersion: snapshot.updatedAt,
        sourceHash,
        sourceSnapshot: JSON.stringify(snapshot),
      },
    });

    if (existing && existing.sourceHash !== sourceHash) {
      await tx.evidenceObject.updateMany({
        where: {
          productId: product.id,
          sourceVersion: { not: snapshot.updatedAt },
          merchantStatus: "APPROVED",
        },
        data: { merchantStatus: "STALE" },
      });
    }

    const sourceDocument = await tx.sourceDocument.upsert({
      where: {
        merchantId_sourceId_sourceVersion: {
          merchantId: merchant.id,
          sourceId: `${sourceProduct.id}:product`,
          sourceVersion: snapshot.updatedAt,
        },
      },
      update: {},
      create: {
        merchantId: merchant.id,
        productId: product.id,
        sourceType: "SHOPIFY_PRODUCT",
        sourceId: `${sourceProduct.id}:product`,
        sourceVersion: snapshot.updatedAt,
        payloadJson: JSON.stringify(snapshot),
        contentHash: sourceHash,
      },
    });

    const evidenceCandidates = [
      {
        sourceId: `${sourceProduct.id}:title`,
        verbatimText: snapshot.title,
        riskClass: "LOW",
      },
      ...(snapshot.description
        ? [
            {
              sourceId: `${sourceProduct.id}:description`,
              verbatimText: snapshot.description,
              riskClass: "MEDIUM",
            },
          ]
        : []),
      ...(snapshot.vendor
        ? [
            {
              sourceId: `${sourceProduct.id}:vendor`,
              verbatimText: `Vendor: ${snapshot.vendor}.`,
              riskClass: "LOW",
            },
          ]
        : []),
      ...(snapshot.productType
        ? [
            {
              sourceId: `${sourceProduct.id}:product-type`,
              verbatimText: `Product type: ${snapshot.productType}.`,
              riskClass: "LOW",
            },
          ]
        : []),
      ...(snapshot.variants.length
        ? [
            {
              sourceId: `${sourceProduct.id}:availability`,
              verbatimText: (() => {
                const available = snapshot.variants.filter(
                  (variant) => variant.availableForSale,
                ).length;
                if (available === 0)
                  return "Availability: No options are available for sale.";
                if (available === snapshot.variants.length) {
                  return "Availability: All options are available for sale.";
                }
                return "Availability: Some options are available for sale.";
              })(),
              riskClass: "MEDIUM",
            },
          ]
        : []),
    ];

    for (const evidence of evidenceCandidates) {
      await tx.evidenceObject.upsert({
        where: {
          merchantId_sourceId_sourceVersion: {
            merchantId: merchant.id,
            sourceId: evidence.sourceId,
            sourceVersion: snapshot.updatedAt,
          },
        },
        update: {},
        create: {
          merchantId: merchant.id,
          productId: product.id,
          sourceDocumentId: sourceDocument.id,
          sourceType: "SHOPIFY_PRODUCT_FIELD",
          sourceId: evidence.sourceId,
          sourceVersion: snapshot.updatedAt,
          verbatimText: evidence.verbatimText,
          productScope: sourceProduct.id,
          riskClass: evidence.riskClass,
          sourceHash: hashValue(evidence.verbatimText),
        },
      });
      }
    });
  }

  const currentProducts = await db.product.findMany({
    where: { merchantId: merchant.id, status: "ACTIVE" },
    select: { sourceSnapshot: true },
    orderBy: { shopifyProductId: "asc" },
    take: 50,
  });
  const samples = currentProducts.map((item) => {
    const snapshot = JSON.parse(item.sourceSnapshot) as {
      title?: string;
      description?: string;
      vendor?: string;
    };
    return {
      title: snapshot.title ?? "",
      description: snapshot.description ?? "",
      vendor: snapshot.vendor ?? "",
    };
  });
  const brand = deriveBrandProfile(samples);
  await db.$transaction(async (tx) => {
    await args.assertActive?.(tx);
    const existingBrand = await tx.brandProfile.findUnique({
      where: { merchantId: merchant.id },
    });
    await tx.brandProfile.upsert({
      where: { merchantId: merchant.id },
      create: {
        merchantId: merchant.id,
        sourceHash: brand.sourceHash,
        voiceTraitsJson: JSON.stringify(brand.voiceTraits),
        vocabularyJson: JSON.stringify(brand.vocabulary),
        analysisJson: JSON.stringify(brand.analysis),
      },
      update:
        existingBrand?.sourceHash === brand.sourceHash
          ? {}
          : {
              sourceHash: brand.sourceHash,
              voiceTraitsJson: JSON.stringify(brand.voiceTraits),
              vocabularyJson: JSON.stringify(brand.vocabulary),
              analysisJson: JSON.stringify(brand.analysis),
              status: "GENERATED",
              generatedAt: new Date(),
              approvedBy: null,
              approvedAt: null,
            },
    });
    await tx.auditLog.create({
      data: {
        merchantId: merchant.id,
        actor,
        action: "PRODUCT_SYNC_COMPLETED",
        resourceType: "MERCHANT",
        resourceId: merchant.id,
        detailsJson: JSON.stringify({
          productCount: products.length,
          staleCount,
        }),
      },
    });
  });

  return { productCount: products.length, staleCount };
}

export async function approveBrandProfile(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
}) {
  const profile = await args.db.brandProfile.findUnique({
    where: { merchantId: args.merchantId },
  });
  if (!profile)
    throw new Error("Sync products to generate the brand profile first.");
  const [approved] = await args.db.$transaction([
    args.db.brandProfile.update({
      where: { id: profile.id },
      data: {
        status: "APPROVED",
        approvedBy: args.actor,
        approvedAt: new Date(),
      },
    }),
    args.db.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "BRAND_PROFILE_APPROVED",
        resourceType: "BRAND_PROFILE",
        resourceId: profile.id,
        detailsJson: JSON.stringify({
          sourceHash: profile.sourceHash,
          promptVersion: profile.promptVersion,
        }),
      },
    }),
  ]);
  return approved;
}

export async function approveEvidence(args: {
  db: PrismaClient;
  merchantId: string;
  evidenceId: string;
  actor: string;
}) {
  const evidence = await args.db.evidenceObject.findFirst({
    where: { id: args.evidenceId, merchantId: args.merchantId },
    include: { product: true },
  });
  if (!evidence) throw new Error("Evidence was not found for this store.");
  if (
    !evidence.product ||
    evidence.sourceVersion !== evidence.product.sourceVersion
  ) {
    throw new Error(
      "This evidence belongs to an older product source version.",
    );
  }
  if (evidence.riskClass === "HIGH" || evidence.riskClass === "PROHIBITED") {
    throw new Error(
      "High-risk or prohibited evidence cannot be approved in the pilot.",
    );
  }

  await args.db.$transaction([
    args.db.evidenceObject.update({
      where: { id: evidence.id },
      data: { merchantStatus: "APPROVED" },
    }),
    args.db.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "EVIDENCE_APPROVED",
        resourceType: "EVIDENCE_OBJECT",
        resourceId: evidence.id,
        detailsJson: JSON.stringify({
          sourceId: evidence.sourceId,
          sourceHash: evidence.sourceHash,
          policyVersion: GOVERNANCE_POLICY_VERSION,
        }),
      },
    }),
  ]);
}

export function validateExperience(input: {
  headline: string;
  supportingLine?: string | null;
  benefits: string[];
  proofItems?: string[];
  reassurance?: string | null;
  minimumBenefits?: 2 | 3;
  claims: Array<{
    claimText: string;
    evidence: Array<{
      verbatimText: string;
      merchantStatus: string;
      expiresAt: Date | null;
      riskClass: string;
    }>;
  }>;
}) {
  const findings: Finding[] = [];
  if (!input.headline.trim()) {
    findings.push({
      code: "HEADLINE_REQUIRED",
      message: "A headline is required.",
    });
  }
  const minimumBenefits = input.minimumBenefits ?? 3;
  if (input.benefits.length < minimumBenefits || input.benefits.length > 4) {
    findings.push({
      code: "BENEFIT_COUNT",
      message:
        `An approvable bundle needs ${minimumBenefits === 2 ? "two to four" : "three or four"} evidence-backed benefits.`,
    });
  }

  const displayedStatements = [
    ...new Set(
      [
        input.headline,
        input.supportingLine,
        ...input.benefits,
        ...(input.proofItems ?? []),
        input.reassurance,
      ].filter((value): value is string => Boolean(value?.trim())),
    ),
  ];
  for (const statement of displayedStatements) {
    if (
      !input.claims.some(
        (claim) =>
          normalizedText(claim.claimText) === normalizedText(statement),
      )
    ) {
      findings.push({
        code: "DISPLAYED_CLAIM_UNTRACED",
        message: `Displayed text has no evidence trace: ${statement}`,
      });
    }
  }

  for (const claim of input.claims) {
    if (!claim.evidence.length) {
      findings.push({
        code: "EVIDENCE_MISSING",
        message: `No evidence supports: ${claim.claimText}`,
      });
      continue;
    }

    const supported = claim.evidence.some((evidence) =>
      normalizedText(evidence.verbatimText).includes(
        normalizedText(claim.claimText),
      ),
    );
    if (!supported) {
      findings.push({
        code: "NOT_VERBATIM_SUPPORTED",
        message: `The proposal is not a verbatim supported statement: ${claim.claimText}`,
      });
    }
    if (
      claim.evidence.some((evidence) => evidence.merchantStatus !== "APPROVED")
    ) {
      findings.push({
        code: "EVIDENCE_NOT_APPROVED",
        message: `Merchant approval is missing for evidence supporting: ${claim.claimText}`,
      });
    }
    if (
      claim.evidence.some(
        (evidence) => evidence.expiresAt && evidence.expiresAt <= new Date(),
      )
    ) {
      findings.push({
        code: "EVIDENCE_EXPIRED",
        message: `Expired evidence supports: ${claim.claimText}`,
      });
    }
    if (
      claim.evidence.some(
        (evidence) =>
          evidence.riskClass === "HIGH" || evidence.riskClass === "PROHIBITED",
      )
    ) {
      findings.push({
        code: "PILOT_RISK_BLOCK",
        message: `High-risk evidence is excluded from the pilot: ${claim.claimText}`,
      });
    }
  }

  return findings;
}

export async function proposeExperience(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  angleId: string;
  actor: string;
}) {
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
  });
  const angle = await args.db.acquisitionAngle.findFirst({
    where: { id: args.angleId, merchantId: args.merchantId, active: true },
  });
  if (!product || !angle)
    throw new Error("Select a valid synced product and angle.");

  const evidence = await args.db.evidenceObject.findMany({
    where: {
      merchantId: args.merchantId,
      productId: product.id,
      merchantStatus: "APPROVED",
      sourceVersion: product.sourceVersion,
    },
    orderBy: { capturedAt: "desc" },
  });
  const titleEvidence = evidence.find((item) =>
    item.sourceId.endsWith(":title"),
  );
  if (!titleEvidence) {
    throw new Error(
      "Approve the current product-title evidence before proposing a bundle.",
    );
  }

  const statementCandidates = evidence
    .filter((item) => item.id !== titleEvidence.id)
    .flatMap((item) =>
      item.sourceId.endsWith(":description")
        ? descriptionStatements(item.verbatimText).map((text) => ({
            text,
            type: "PRODUCT_BENEFIT",
            evidenceId: item.id,
            sourceId: item.sourceId,
          }))
        : [
            {
              text: item.verbatimText,
              type: "PRODUCT_ATTRIBUTE",
              evidenceId: item.id,
              sourceId: item.sourceId,
            },
          ],
    );
  const benefitClaims = rankStatementsForAngle(
    angle.key,
    statementCandidates,
  ).slice(0, 4);
  const benefits = benefitClaims.map((claim) => claim.text);
  const headline = titleEvidence.verbatimText;
  const content = {
    headline,
    supportingLine: null,
    benefits,
    proofItems: [],
    reassurance: null,
  };
  const evidenceSnapshotHash = hashValue(
    evidence
      .map((item) => ({ id: item.id, sourceHash: item.sourceHash }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  const claims = [
    { text: headline, type: "PRODUCT_ATTRIBUTE", evidenceId: titleEvidence.id },
    ...benefitClaims,
  ];
  const findings = validateExperience({
    headline,
    supportingLine: content.supportingLine,
    benefits,
    proofItems: content.proofItems,
    reassurance: content.reassurance,
    claims: claims.map((claim) => ({
      claimText: claim.text,
      evidence: evidence
        .filter((item) => item.id === claim.evidenceId)
        .map((item) => ({
          verbatimText: item.verbatimText,
          merchantStatus: item.merchantStatus,
          expiresAt: item.expiresAt,
          riskClass: item.riskClass,
        })),
    })),
  });
  const latest = await args.db.experienceVersion.aggregate({
    where: { productId: product.id, angleId: angle.id },
    _max: { version: true },
  });
  const version = (latest._max.version ?? 0) + 1;

  return args.db.$transaction(async (tx) => {
    const experience = await tx.experienceVersion.create({
      data: {
        merchantId: args.merchantId,
        productId: product.id,
        angleId: angle.id,
        version,
        headline: content.headline,
        supportingLine: content.supportingLine,
        benefitsJson: JSON.stringify(content.benefits),
        proofItemsJson: JSON.stringify(content.proofItems),
        reassurance: content.reassurance,
        contentHash: hashValue(content),
        sourceSnapshotHash: evidenceSnapshotHash,
        riskClass: evidence.some((item) => item.riskClass === "MEDIUM")
          ? "MEDIUM"
          : "LOW",
        promptVersion: "deterministic-verbatim-v1",
        rawOutputJson: JSON.stringify(content),
        validationFindingsJson: JSON.stringify(findings),
      },
    });

    for (const claim of claims) {
      const createdClaim = await tx.claim.create({
        data: {
          experienceVersionId: experience.id,
          claimText: claim.text,
          claimType: claim.type,
          transformationType: "VERBATIM",
          scopeJson: JSON.stringify({ productId: product.shopifyProductId }),
          riskClass: claim.type === "PRODUCT_BENEFIT" ? "MEDIUM" : "LOW",
          validationFindingsJson: "[]",
        },
      });
      if (claim.evidenceId) {
        await tx.claimEvidence.create({
          data: { claimId: createdClaim.id, evidenceId: claim.evidenceId },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "EXPERIENCE_PROPOSED",
        resourceType: "EXPERIENCE_VERSION",
        resourceId: experience.id,
        detailsJson: JSON.stringify({
          productId: product.id,
          angle: angle.key,
          version,
          promptVersion: "deterministic-verbatim-v1",
          findingCount: findings.length,
        }),
      },
    });

    return { experience, findingCount: findings.length };
  });
}

export async function buildDraftLibrary(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  actor: string;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
  });
  if (!product) throw new Error("Select a valid synced product.");
  const evidence = await args.db.evidenceObject.findMany({
    where: {
      merchantId: args.merchantId,
      productId: product.id,
      sourceVersion: product.sourceVersion,
    },
  });
  const approvable = evidence.filter(
    (item) => item.riskClass !== "HIGH" && item.riskClass !== "PROHIBITED",
  );
  if (!approvable.some((item) => item.sourceId.endsWith(":title"))) {
    throw new Error("Current product-title evidence is missing.");
  }
  await args.db.$transaction(async (tx) => {
    await args.assertActive?.(tx);
    await tx.evidenceObject.updateMany({
      where: { id: { in: approvable.map((item) => item.id) } },
      data: { merchantStatus: "APPROVED" },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "CURRENT_PRODUCT_EVIDENCE_APPROVED",
        resourceType: "PRODUCT",
        resourceId: product.id,
        detailsJson: JSON.stringify({
          evidenceIds: approvable.map((item) => item.id),
          sourceVersion: product.sourceVersion,
        }),
      },
    });
  });
  const mappings = await args.db.campaignMapping.findMany({
    where: {
      merchantId: args.merchantId,
      status: "ACTIVE",
      campaignEvidenceHash: { not: null },
      campaignEvidenceRef: { not: null },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 3,
  });
  const proposed = [
    await createDiagnosisDraftV2({ ...args }),
    ...await Promise.all(
      mappings.map((mapping) =>
        createDiagnosisDraftV2({
          ...args,
          campaignMappingId: mapping.id,
        }),
      ),
    ),
  ];
  const created = proposed
    .map((item) => item.experience)
    .filter(
      (item, index, all) =>
        item && all.findIndex((candidate) => candidate?.id === item.id) === index,
    );
  return {
    approvedEvidenceCount: approvable.length,
    draftCount: created.length,
    diagnosisStatuses: proposed.map((item) => item.status),
  };
}

function editableText(value: string, maximum: number) {
  const result = normalizedText(value).slice(0, maximum);
  return result || null;
}

export async function reviseDraftExperience(args: {
  db: PrismaClient;
  merchantId: string;
  experienceId: string;
  headline: string;
  supportingLine: string;
  benefits: string[];
  proofItems: string[];
  reassurance: string;
  actor: string;
}) {
  const experience = await args.db.experienceVersion.findFirst({
    where: {
      id: args.experienceId,
      merchantId: args.merchantId,
      status: "DRAFT",
    },
    include: { product: true },
  });
  if (!experience) throw new Error("Only a current draft can be revised.");
  const usesV2MessageRules = experience.promptVersion.startsWith(
    "deterministic-source-composer-v2",
  ) || experience.promptVersion.startsWith("merchant-revision-v2");
  const content = {
    headline: editableText(args.headline, 160) ?? "",
    supportingLine: editableText(args.supportingLine, 240),
    benefits: args.benefits
      .map((value) => editableText(value, 240))
      .filter((value): value is string => Boolean(value))
      .slice(0, 4),
    proofItems: args.proofItems
      .map((value) => editableText(value, 320))
      .filter((value): value is string => Boolean(value))
      .slice(0, 3),
    reassurance: editableText(args.reassurance, 240),
  };
  const statements = [
    ...new Set(
      [
        content.headline,
        content.supportingLine,
        ...content.benefits,
        ...content.proofItems,
        content.reassurance,
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const evidence = await args.db.evidenceObject.findMany({
    where: {
      merchantId: args.merchantId,
      productId: experience.productId,
      sourceVersion: experience.product.sourceVersion,
      merchantStatus: "APPROVED",
    },
  });
  const links = statements.map((statement) => ({
    statement,
    evidence: evidence.find((item) =>
      normalizedText(item.verbatimText).includes(normalizedText(statement)),
    ),
  }));
  const findings = validateExperience({
    headline: content.headline,
    supportingLine: content.supportingLine,
    benefits: content.benefits,
    proofItems: content.proofItems,
    reassurance: content.reassurance,
    minimumBenefits: usesV2MessageRules ? 2 : 3,
    claims: links.map(({ statement, evidence: source }) => ({
      claimText: statement,
      evidence: source
        ? [
            {
              verbatimText: source.verbatimText,
              merchantStatus: source.merchantStatus,
              expiresAt: source.expiresAt,
              riskClass: source.riskClass,
            },
          ]
        : [],
    })),
  });
  if (findings.length)
    throw new Error(findings.map((finding) => finding.message).join(" "));
  const evidenceSnapshotHash = hashValue(
    evidence
      .map((item) => ({ id: item.id, sourceHash: item.sourceHash }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
  await args.db.$transaction(async (tx) => {
    await tx.claim.deleteMany({
      where: { experienceVersionId: experience.id },
    });
    await tx.experienceVersion.update({
      where: { id: experience.id },
      data: {
        headline: content.headline,
        supportingLine: content.supportingLine,
        benefitsJson: JSON.stringify(content.benefits),
        proofItemsJson: JSON.stringify(content.proofItems),
        reassurance: content.reassurance,
        contentHash: hashValue(content),
        sourceSnapshotHash: evidenceSnapshotHash,
        rawOutputJson: JSON.stringify(content),
        validationFindingsJson: "[]",
        promptVersion: usesV2MessageRules
          ? "merchant-revision-v2"
          : "merchant-revision-v1",
      },
    });
    for (const { statement, evidence: source } of links) {
      if (!source) continue;
      const claim = await tx.claim.create({
        data: {
          experienceVersionId: experience.id,
          claimText: statement,
          claimType: "PRODUCT_CLAIM",
          transformationType:
            normalizedText(statement) === normalizedText(source.verbatimText)
              ? "VERBATIM"
              : "MERCHANT_SELECTED_EXCERPT",
          scopeJson: JSON.stringify({
            productId: experience.product.shopifyProductId,
          }),
          riskClass: source.riskClass,
          validationFindingsJson: "[]",
        },
      });
      await tx.claimEvidence.create({
        data: { claimId: claim.id, evidenceId: source.id },
      });
    }
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "EXPERIENCE_DRAFT_REVISED",
        resourceType: "EXPERIENCE_VERSION",
        resourceId: experience.id,
        detailsJson: JSON.stringify({
          contentHash: hashValue(content),
          sourceSnapshotHash: evidenceSnapshotHash,
        }),
      },
    });
  });
}

export async function approveExperience(args: {
  db: PrismaClient;
  merchantId: string;
  experienceId: string;
  actor: string;
}) {
  const experience = await args.db.experienceVersion.findFirst({
    where: { id: args.experienceId, merchantId: args.merchantId },
    include: {
      product: true,
      claims: {
        include: {
          evidenceLinks: { include: { evidence: true } },
        },
      },
    },
  });
  if (!experience) throw new Error("Experience version was not found.");
  if (experience.status !== "DRAFT") {
    throw new Error("Only an unchanged draft can be approved.");
  }
  if (
    experience.claims.some((claim) =>
      claim.evidenceLinks.some(
        ({ evidence }) =>
          evidence.sourceVersion !== experience.product.sourceVersion,
      ),
    )
  ) {
    throw new Error("The product source changed after this draft was created.");
  }

  const findings = validateExperience({
    headline: experience.headline,
    supportingLine: experience.supportingLine,
    benefits: JSON.parse(experience.benefitsJson) as string[],
    proofItems: JSON.parse(experience.proofItemsJson) as string[],
    reassurance: experience.reassurance,
    minimumBenefits: experience.promptVersion.startsWith(
      "deterministic-source-composer-v2",
    ) || experience.promptVersion.startsWith("merchant-revision-v2")
      ? 2
      : 3,
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
  if (findings.length) {
    throw new Error(findings.map((finding) => finding.message).join(" "));
  }

  await args.db.$transaction(async (tx) => {
    await tx.experienceVersion.updateMany({
      where: {
        merchantId: args.merchantId,
        productId: experience.productId,
        angleId: experience.angleId,
        status: "APPROVED_ACTIVE",
      },
      data: { status: "SUPERSEDED" },
    });
    await tx.experienceVersion.update({
      where: { id: experience.id },
      data: { status: "APPROVED_ACTIVE", publishedAt: new Date() },
    });
    await tx.approval.create({
      data: {
        merchantId: args.merchantId,
        experienceVersionId: experience.id,
        approver: args.actor,
        contentHash: experience.contentHash,
        evidenceSnapshotHash: experience.sourceSnapshotHash,
        policyVersion: GOVERNANCE_POLICY_VERSION,
      },
    });
    await tx.adaptivePackageReview.updateMany({
      where: {
        merchantId: args.merchantId,
        productId: experience.productId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "INVALIDATED" },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "EXPERIENCE_APPROVED",
        resourceType: "EXPERIENCE_VERSION",
        resourceId: experience.id,
        detailsJson: JSON.stringify({
          contentHash: experience.contentHash,
          evidenceSnapshotHash: experience.sourceSnapshotHash,
          policyVersion: GOVERNANCE_POLICY_VERSION,
        }),
      },
    });
  });
}

export async function createCampaignMapping(args: {
  db: PrismaClient;
  merchantId: string;
  angleId: string;
  utmSource: string;
  utmCampaign: string;
  utmContent: string;
  campaignAdText?: string;
  campaignLocale?: string;
  fallback: string;
  actor: string;
}) {
  const source = normalizedMappingContext(args.utmSource);
  const campaign = normalizedMappingContext(args.utmCampaign);
  const content = normalizedMappingContext(args.utmContent);
  const campaignEvidence = args.campaignAdText
    ? validateCampaignEvidenceInput(
        args.campaignAdText,
        args.campaignLocale ?? "en",
      )
    : null;
  if (!source || !campaign) {
    throw new Error("UTM source and campaign are required.");
  }
  if (!new Set(["ORIGINAL", "UNIVERSAL", "EXCLUDE"]).has(args.fallback)) {
    throw new Error("Select a valid unknown-traffic fallback.");
  }
  const angle = await args.db.acquisitionAngle.findFirst({
    where: { id: args.angleId, merchantId: args.merchantId, active: true },
  });
  if (!angle) throw new Error("Select an active acquisition angle.");
  const signature = campaignSignature({ source, campaign, content });
  const active = await args.db.campaignMapping.findFirst({
    where: { merchantId: args.merchantId, signature, status: "ACTIVE" },
  });
  if (active && active.angleId !== angle.id) {
    throw new Error("This campaign already resolves to another active angle.");
  }
  if (
    active &&
    active.campaignEvidenceHash === campaignEvidence?.contentHash &&
    active.fallback === args.fallback
  ) {
    return active;
  }
  const latest = await args.db.campaignMapping.aggregate({
    where: { merchantId: args.merchantId, signature },
    _max: { version: true },
  });
  const version = (latest._max.version ?? 0) + 1;

  return args.db.$transaction(async (tx) => {
    const campaignDocument = campaignEvidence
      ? await tx.sourceDocument.upsert({
          where: {
            merchantId_sourceId_sourceVersion: {
              merchantId: args.merchantId,
              sourceId: `campaign:${signature}`,
              sourceVersion: campaignEvidence.contentHash,
            },
          },
          create: {
            merchantId: args.merchantId,
            sourceType: "MERCHANT_CAMPAIGN_TEXT",
            sourceId: `campaign:${signature}`,
            sourceVersion: campaignEvidence.contentHash,
            payloadJson: JSON.stringify({
              text: campaignEvidence.text,
              locale: campaignEvidence.locale,
            }),
            contentHash: campaignEvidence.contentHash,
          },
          update: {},
        })
      : null;
    await tx.campaignMapping.updateMany({
      where: { merchantId: args.merchantId, signature, status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });
    await tx.adaptivePackageReview.updateMany({
      where: {
        merchantId: args.merchantId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      data: { status: "INVALIDATED" },
    });
    const mapping = await tx.campaignMapping.create({
      data: {
        merchantId: args.merchantId,
        angleId: angle.id,
        version,
        signature,
        utmSource: source,
        utmCampaign: campaign,
        utmContent: content,
        campaignEvidenceRef: campaignDocument?.id ?? null,
        campaignEvidenceHash: campaignEvidence?.contentHash ?? null,
        campaignLocale: campaignEvidence?.locale ?? "en",
        fallback: args.fallback,
        createdBy: args.actor,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "CAMPAIGN_MAPPING_VERSIONED",
        resourceType: "CAMPAIGN_MAPPING",
        resourceId: mapping.id,
        detailsJson: JSON.stringify({
          signature,
          version,
          angle: angle.key,
          campaignEvidenceRef: campaignDocument?.id ?? null,
          campaignEvidenceHash: campaignEvidence?.contentHash ?? null,
          campaignLocale: campaignEvidence?.locale ?? null,
        }),
      },
    });
    return mapping;
  });
}

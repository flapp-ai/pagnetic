import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  diagnoseProductMessage,
  type MessageCandidate,
  type DiagnosisSource,
} from "./message-diagnosis-v2";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function productSource(product: {
  shopifyProductId: string;
  title: string;
  sourceVersion: string;
  sourceSnapshot: string;
}) {
  let snapshot: Partial<DiagnosisSource> = {};
  try {
    snapshot = JSON.parse(product.sourceSnapshot) as Partial<DiagnosisSource>;
  } catch {
    snapshot = {};
  }
  return {
    title: String(snapshot.title ?? product.title),
    description: String(snapshot.description ?? ""),
    vendor: snapshot.vendor ? String(snapshot.vendor) : null,
    productType: snapshot.productType ? String(snapshot.productType) : null,
    sourceVersion: product.sourceVersion,
    productRef: product.shopifyProductId,
    locale: snapshot.locale ? String(snapshot.locale) : "en",
  } satisfies DiagnosisSource;
}

export async function persistMessageDiagnosisV2(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  campaignMappingId?: string;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  const product = await args.db.product.findFirst({
    where: {
      id: args.productId,
      merchantId: args.merchantId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      shopifyProductId: true,
      title: true,
      sourceVersion: true,
      sourceSnapshot: true,
    },
  });
  if (!product) throw new Error("DIAGNOSIS_PRODUCT_UNAVAILABLE");

  const mapping = args.campaignMappingId
    ? await args.db.campaignMapping.findFirst({
        where: {
          id: args.campaignMappingId,
          merchantId: args.merchantId,
          status: "ACTIVE",
        },
      })
    : null;
  if (args.campaignMappingId && !mapping)
    throw new Error("CAMPAIGN_MAPPING_UNAVAILABLE");
  if (mapping && (!mapping.campaignEvidenceRef || !mapping.campaignEvidenceHash))
    throw new Error("CAMPAIGN_EVIDENCE_REQUIRED");

  const campaignDocument = mapping?.campaignEvidenceRef
    ? await args.db.sourceDocument.findFirst({
        where: {
          id: mapping.campaignEvidenceRef,
          merchantId: args.merchantId,
          sourceType: "MERCHANT_CAMPAIGN_TEXT",
          contentHash: mapping.campaignEvidenceHash!,
        },
      })
    : null;
  if (mapping && !campaignDocument)
    throw new Error("CAMPAIGN_EVIDENCE_CHANGED");

  let campaignAdText: string | null = null;
  if (campaignDocument) {
    try {
      const payload = JSON.parse(campaignDocument.payloadJson) as {
        text?: unknown;
      };
      campaignAdText = typeof payload.text === "string" ? payload.text : null;
    } catch {
      throw new Error("CAMPAIGN_EVIDENCE_INVALID");
    }
    if (!campaignAdText) throw new Error("CAMPAIGN_EVIDENCE_INVALID");
  }

  const diagnosis = diagnoseProductMessage({
    source: productSource(product),
    campaignAdText,
  });
  const diagnosisPayload = {
    merchantId: args.merchantId,
    productId: product.id,
    sourceVersion: product.sourceVersion,
    campaignEvidenceHash: mapping?.campaignEvidenceHash ?? null,
    diagnosis,
  };
  const publicLookupHash = createHash("sha256")
    .update(canonical(diagnosisPayload))
    .digest("hex");
  const existing = await args.db.messageDiagnosis.findUnique({
    where: { publicLookupHash },
  });
  if (existing) return { record: existing, diagnosis };

  const record = await args.db.$transaction(async (tx) => {
    await args.assertActive?.(tx);
    const created = await tx.messageDiagnosis.create({
      data: {
        merchantId: args.merchantId,
        productId: product.id,
        productRef: product.shopifyProductId,
        sourceVersion: product.sourceVersion,
        adEvidenceRef: campaignDocument?.id ?? null,
        mode: diagnosis.mode,
        gapType: diagnosis.gapType,
        rationale: diagnosis.rationale,
        sourceSpansJson: canonical({
          sourceSpans: diagnosis.sourceSpans,
          blockedSpanIds: diagnosis.blockedSpanIds,
          findings: diagnosis.findings,
          primary: diagnosis.primary,
          alternative: diagnosis.alternative,
          rulesVersion: diagnosis.rulesVersion,
          adapterVersion: diagnosis.adapterVersion,
        }),
        status:
          diagnosis.status === "PROPOSED"
            ? "DRAFT"
            : diagnosis.status,
        rulesVersion: diagnosis.rulesVersion,
        publicLookupHash,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: "system:message-diagnosis-v2",
        action: "MESSAGE_DIAGNOSIS_CREATED",
        resourceType: "MESSAGE_DIAGNOSIS",
        resourceId: created.id,
        detailsJson: canonical({
          productId: product.id,
          sourceVersion: product.sourceVersion,
          campaignEvidenceRef: campaignDocument?.id ?? null,
          mode: diagnosis.mode,
          status: diagnosis.status,
          gapType: diagnosis.gapType,
          rulesVersion: diagnosis.rulesVersion,
        }),
      },
    });
    return created;
  });
  return { record, diagnosis };
}

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function runtimeContentHash(candidate: MessageCandidate) {
  return createHash("sha256")
    .update(JSON.stringify({
      headline: candidate.headline,
      supportingLine: candidate.supportingLine,
      benefits: candidate.benefits,
      proofItems: [],
      reassurance: candidate.reassurance,
    }))
    .digest("hex");
}

export async function createDiagnosisDraftV2(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  campaignMappingId?: string;
  candidate?: "primary" | "alternative";
  actor: string;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  const prepared = await persistMessageDiagnosisV2(args);
  const selected: MessageCandidate | null =
    args.candidate === "alternative"
      ? prepared.diagnosis.alternative
      : prepared.diagnosis.primary;
  if (!selected) {
    return {
      status: prepared.diagnosis.status,
      diagnosis: prepared.record,
      experience: null,
    };
  }
  if (selected.benefits.length < 2 || selected.benefits.length > 4)
    throw new Error("DIAGNOSIS_BENEFIT_COUNT_INVALID");
  const contentHash = runtimeContentHash(selected);

  const [product, mapping, universalAngle] = await Promise.all([
    args.db.product.findFirst({
      where: { id: args.productId, merchantId: args.merchantId },
    }),
    args.campaignMappingId
      ? args.db.campaignMapping.findFirst({
          where: {
            id: args.campaignMappingId,
            merchantId: args.merchantId,
            status: "ACTIVE",
          },
        })
      : null,
    args.db.acquisitionAngle.findFirst({
      where: {
        merchantId: args.merchantId,
        key: "universal",
        active: true,
      },
    }),
  ]);
  if (!product) throw new Error("DIAGNOSIS_PRODUCT_UNAVAILABLE");
  const angleId = mapping?.angleId ?? universalAngle?.id;
  if (!angleId) throw new Error("DIAGNOSIS_ANGLE_UNAVAILABLE");

  const evidence = await args.db.evidenceObject.findMany({
    where: {
      merchantId: args.merchantId,
      productId: args.productId,
      sourceVersion: product.sourceVersion,
      merchantStatus: "APPROVED",
      riskClass: { notIn: ["HIGH", "PROHIBITED"] },
    },
    orderBy: { id: "asc" },
  });
  const statements = [selected.headline, ...selected.benefits];
  const linked = statements.map((statement) => ({
    statement,
    evidence: evidence.find((item) =>
      normalized(item.verbatimText).includes(normalized(statement)),
    ),
  }));
  if (linked.some((item) => !item.evidence))
    throw new Error("DIAGNOSIS_EVIDENCE_LINK_MISSING");
  const sourceSnapshotHash = createHash("sha256")
    .update(canonical(linked.map(({ evidence: item }) => ({
      id: item!.id,
      sourceHash: item!.sourceHash,
      sourceVersion: item!.sourceVersion,
    }))))
    .digest("hex");
  const existing = await args.db.experienceVersion.findFirst({
    where: {
      merchantId: args.merchantId,
      productId: args.productId,
      contentHash,
      status: "DRAFT",
      staleAt: null,
    },
  });
  if (existing && existing.angleId !== angleId)
    return {
      status: "NO_DISTINCT_DRAFT" as const,
      diagnosis: prepared.record,
      experience: null,
    };
  if (existing)
    return {
      status: "DRAFT" as const,
      diagnosis: prepared.record,
      experience: existing,
    };

  const latest = await args.db.experienceVersion.aggregate({
    where: { productId: args.productId, angleId },
    _max: { version: true },
  });
  const experience = await args.db.$transaction(async (tx) => {
    await args.assertActive?.(tx);
    const created = await tx.experienceVersion.create({
      data: {
        merchantId: args.merchantId,
        productId: args.productId,
        angleId,
        version: (latest._max.version ?? 0) + 1,
        headline: selected.headline,
        supportingLine: selected.supportingLine,
        benefitsJson: JSON.stringify(selected.benefits),
        proofItemsJson: "[]",
        reassurance: selected.reassurance,
        contentHash,
        sourceSnapshotHash,
        riskClass: "LOW",
        provider: "LOCAL_DETERMINISTIC",
        promptVersion: prepared.diagnosis.adapterVersion,
        rawOutputJson: canonical({
          diagnosisId: prepared.record.id,
          candidate: selected,
        }),
        validationFindingsJson: "[]",
      },
    });
    for (const [index, item] of linked.entries()) {
      const claim = await tx.claim.create({
        data: {
          experienceVersionId: created.id,
          claimText: item.statement,
          claimType: index === 0 ? "LEAD_PRODUCT_BENEFIT" : "PRODUCT_BENEFIT",
          transformationType: "VERBATIM_SOURCE_SPAN",
          scopeJson: JSON.stringify({ productId: product.shopifyProductId }),
          riskClass: item.evidence!.riskClass,
          validationFindingsJson: "[]",
        },
      });
      await tx.claimEvidence.create({
        data: { claimId: claim.id, evidenceId: item.evidence!.id },
      });
    }
    await tx.messageDiagnosis.update({
      where: { id: prepared.record.id },
      data: { status: "EXPERIENCE_DRAFTED" },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "DIAGNOSIS_EXPERIENCE_DRAFTED",
        resourceType: "EXPERIENCE_VERSION",
        resourceId: created.id,
        detailsJson: canonical({
          diagnosisId: prepared.record.id,
          campaignMappingId: mapping?.id ?? null,
          contentHash,
          sourceSnapshotHash,
          adapterVersion: prepared.diagnosis.adapterVersion,
        }),
      },
    });
    return created;
  });
  return {
    status: "DRAFT" as const,
    diagnosis: prepared.record,
    experience,
  };
}

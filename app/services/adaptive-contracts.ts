import { createHash } from "node:crypto";

/** The first additive Adaptive Storefront contract. v2 remains unchanged. */
export const ADAPTIVE_CONTRACT_VERSION = "adaptive-a-1" as const;
export const ADAPTIVE_MAPPING_VERSION = 1 as const;
export const ADAPTIVE_REVIEW_PROTOCOL_VERSION = "adaptive-owner-review-a1" as const;
export const ADAPTIVE_ORIGINAL_MATCHED_PROTOCOL_VERSION =
  "adaptive-original-vs-matched-a1" as const;
export const ADAPTIVE_UNIVERSAL_MATCHED_PROTOCOL_VERSION =
  "adaptive-universal-vs-matched-a1" as const;

export const ADAPTIVE_EXPERIMENT_QUESTIONS = Object.freeze({
  ORIGINAL_MATCHED: Object.freeze({
    protocolVersion: ADAPTIVE_ORIGINAL_MATCHED_PROTOCOL_VERSION,
    controlPolicy: "ORIGINAL" as const,
    treatmentPolicy: "MATCHED" as const,
    question:
      "Does the complete campaign-matched storefront policy change net selected-product merchandise revenue per assigned eligible visitor versus the Original product page?",
    interpretation:
      "This estimates the total commercial policy effect. It does not isolate matching from the bundle content itself.",
  }),
  UNIVERSAL_MATCHED: Object.freeze({
    protocolVersion: ADAPTIVE_UNIVERSAL_MATCHED_PROTOCOL_VERSION,
    controlPolicy: "UNIVERSAL" as const,
    treatmentPolicy: "MATCHED" as const,
    question:
      "Does campaign matching change net selected-product merchandise revenue per assigned eligible visitor versus one frozen strong Universal bundle?",
    interpretation:
      "This is the separately registered matching-specific question; it is not interchangeable with Original versus Matched.",
  }),
});

export type AdaptiveFallback = "ORIGINAL";
export type AdaptiveMappingStatus = "ACTIVE" | "REVOKED" | "EXPIRED";

export type AdaptiveCampaignMapping = {
  merchantId: string;
  productId: string;
  locale: string;
  campaignRef: string;
  signature: string;
  mappingVersion: number;
  bundleId: string;
  status: AdaptiveMappingStatus;
  expiresAt?: string | null;
};

export type AdaptiveMappingSnapshot = {
  version: number;
  hash: string;
  mappings: readonly AdaptiveCampaignMapping[];
};

export type AdaptiveDeploymentPayload = {
  schemaVersion: typeof ADAPTIVE_CONTRACT_VERSION;
  deploymentRevision: number;
  productId: string;
  locale: string;
  fallback: AdaptiveFallback;
  mappingSnapshot: AdaptiveMappingSnapshot;
  bundleSetHash: string;
};

export type AdaptiveSelectionReason =
  | "MAPPED_CAMPAIGN"
  | "UNKNOWN_CAMPAIGN"
  | "AMBIGUOUS_CAMPAIGN"
  | "INVALID_CAMPAIGN"
  | "MAPPING_NOT_ACTIVE"
  | "MAPPING_EXPIRED"
  | "INVALID_SNAPSHOT"
  | "INVALID_CLOCK"
  | "NO_CAMPAIGN_CONTEXT";

export type AdaptiveMappingSelection = {
  bundleId: string | null;
  mappingVersion: number | null;
  reason: AdaptiveSelectionReason;
  fallback: AdaptiveFallback;
};

const SNAPSHOT_FIELDS = [
  "merchantId",
  "productId",
  "locale",
  "campaignRef",
  "signature",
  "mappingVersion",
  "bundleId",
  "status",
  "expiresAt",
] as const;

function canonicalMapping(mapping: AdaptiveCampaignMapping): string {
  return JSON.stringify(SNAPSHOT_FIELDS.map((field) => mapping[field] ?? null));
}

function canonicalSnapshot(version: number, mappings: readonly AdaptiveCampaignMapping[]): string {
  return JSON.stringify([version, ...mappings.map(canonicalMapping)]);
}

function compareMappings(a: AdaptiveCampaignMapping, b: AdaptiveCampaignMapping): number {
  const left = canonicalMapping(a);
  const right = canonicalMapping(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function validMapping(mapping: AdaptiveCampaignMapping): boolean {
  return (
    !!mapping &&
    typeof mapping === "object" &&
    typeof mapping.merchantId === "string" &&
    typeof mapping.productId === "string" &&
    typeof mapping.locale === "string" &&
    typeof mapping.campaignRef === "string" &&
    typeof mapping.signature === "string" &&
    typeof mapping.mappingVersion === "number" &&
    typeof mapping.bundleId === "string" &&
    typeof mapping.status === "string" &&
    mapping.merchantId.length > 0 &&
    mapping.productId.length > 0 &&
    mapping.locale.length > 0 &&
    normalizeCampaignRef(mapping.campaignRef) === mapping.campaignRef &&
    /^[a-f0-9]{64}$/.test(mapping.signature) &&
    Number.isInteger(mapping.mappingVersion) &&
    mapping.mappingVersion > 0 &&
    mapping.bundleId.length > 0 &&
    ["ACTIVE", "REVOKED", "EXPIRED"].includes(mapping.status) &&
    (mapping.expiresAt == null ||
      (typeof mapping.expiresAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(mapping.expiresAt) &&
        Number.isFinite(Date.parse(mapping.expiresAt)) &&
        new Date(mapping.expiresAt).toISOString() === mapping.expiresAt))
  );
}

export function normalizeCampaignRef(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(normalized) ? normalized : null;
}

export function campaignSignature(input: {
  source: string;
  campaign: string;
  content?: string | null;
}): string {
  const source = input.source.trim();
  const campaign = input.campaign.trim();
  const content = input.content?.trim() ?? "";
  if (!source || !campaign) throw new Error("source and campaign are required");
  return createHash("sha256")
    .update(JSON.stringify({ source, campaign, content }))
    .digest("hex");
}

export function createMappingSnapshot(
  mappings: readonly AdaptiveCampaignMapping[],
  version: number = ADAPTIVE_MAPPING_VERSION,
): AdaptiveMappingSnapshot {
  if (!Number.isInteger(version) || version < 1) throw new Error("invalid mapping snapshot version");
  if (mappings.some((mapping) => !validMapping(mapping))) throw new Error("invalid mapping row");
  const ordered = [...mappings].sort(compareMappings);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (
      previous.merchantId === current.merchantId &&
      previous.productId === current.productId &&
      previous.locale === current.locale &&
      previous.campaignRef === current.campaignRef
    ) {
      throw new Error("conflicting duplicate campaign mapping");
    }
  }
  const serialized = canonicalSnapshot(version, ordered);
  return {
    version,
    hash: createHash("sha256").update(serialized).digest("hex"),
    mappings: Object.freeze(ordered.map((mapping) => Object.freeze({ ...mapping }))),
  };
}

function trustedSnapshot(snapshot: AdaptiveMappingSnapshot): boolean {
  if (!snapshot || typeof snapshot !== "object" || !Number.isInteger(snapshot.version) || snapshot.version < 1 || !Array.isArray(snapshot.mappings)) return false;
  if (snapshot.mappings.some((mapping) => !validMapping(mapping))) return false;
  const ordered = [...snapshot.mappings].sort(compareMappings);
  if (ordered.some((mapping, index) => mapping !== snapshot.mappings[index])) return false;
  return /^[a-f0-9]{64}$/.test(snapshot.hash) &&
    snapshot.hash === createHash("sha256").update(canonicalSnapshot(snapshot.version, snapshot.mappings)).digest("hex");
}

export function resolveAdaptiveMapping(input: {
  merchantId: string;
  productId: string;
  locale: string;
  campaignRef?: string | null;
  now?: Date;
  snapshot: AdaptiveMappingSnapshot;
}): AdaptiveMappingSelection {
  const fallback = "ORIGINAL" as const;
  // The snapshot is a trusted, immutable deployment boundary. Re-verify it here
  // because callers may deserialize or receive it from an untrusted cache.
  if (!trustedSnapshot(input.snapshot)) return { bundleId: null, mappingVersion: null, reason: "INVALID_SNAPSHOT", fallback };
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()))
    return { bundleId: null, mappingVersion: null, reason: "INVALID_CLOCK", fallback };
  const ref = normalizeCampaignRef(input.campaignRef);
  if (!input.campaignRef) return { bundleId: null, mappingVersion: null, reason: "NO_CAMPAIGN_CONTEXT", fallback };
  if (!ref) return { bundleId: null, mappingVersion: null, reason: "INVALID_CAMPAIGN", fallback };
  const candidates = input.snapshot.mappings.filter(
    (mapping) =>
      mapping.merchantId === input.merchantId &&
      mapping.productId === input.productId &&
      mapping.locale === input.locale &&
      mapping.campaignRef === ref,
  );
  if (candidates.length === 0) return { bundleId: null, mappingVersion: null, reason: "UNKNOWN_CAMPAIGN", fallback };
  const active = candidates.filter((mapping) => mapping.status === "ACTIVE");
  if (active.length !== 1) {
    return {
      bundleId: null,
      mappingVersion: null,
      reason: active.length > 1 ? "AMBIGUOUS_CAMPAIGN" : "MAPPING_NOT_ACTIVE",
      fallback,
    };
  }
  const mapping = active[0];
  if (mapping.expiresAt && new Date(mapping.expiresAt).getTime() <= now.getTime()) {
    return { bundleId: null, mappingVersion: null, reason: "MAPPING_EXPIRED", fallback };
  }
  return { bundleId: mapping.bundleId, mappingVersion: mapping.mappingVersion, reason: "MAPPED_CAMPAIGN", fallback };
}

export function appendCampaignRef(url: string, campaignRef: string): string {
  const ref = normalizeCampaignRef(campaignRef);
  if (!ref) throw new Error("invalid campaign reference");
  const parsed = new URL(url);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
    throw new Error("campaign destination must be an http(s) URL without credentials");
  }
  parsed.searchParams.set("pag_campaign", ref);
  return parsed.toString();
}

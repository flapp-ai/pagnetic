import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { canonicalQueuePayload, QueueIdempotencyConflictError } from "./job-outbox.server";
import {
  MVP_V2_PRIMARY_METRIC,
  MVP_V2_PROTOCOL_VERSION,
  mvpV2EnabledForShop,
} from "./mvp-v2";
import { canonicalProductId, validateRuntimeExperience } from "./runtime.server";
import { assertIdentityNotSuppressed, PrivacyIdentitySuppressedError } from "./identity-privacy-guard.server";
import { createMappingSnapshot, resolveAdaptiveMapping } from "./adaptive-contracts";

const DAY_MS = 86_400_000;
const OPAQUE_PATTERN = /^[A-Za-z0-9_:-]{8,160}$/;

export type DecisionRequestV2 = {
  schemaVersion: 2;
  requestId: string;
  productId: string;
  visitorToken: string;
  sessionId: string;
  consent: { analytics: true; preferences: true; policyVersion: string };
  campaignRef?: string;
  blockVersion: string;
};

export type ApprovedPanelV2 = {
  schemaVersion: 2;
  contentVersionId: string;
  contentHash: string;
  headline: string;
  benefits: Array<{ text: string; evidenceIds: string[] }>;
  proofItems: string[];
  faq: Array<{ question: string; answer: string; evidenceIds: string[] }>;
  reassurance: { text: string; evidenceIds: string[] } | null;
  headlineEvidenceIds: string[];
};

export type DecisionResponseV2 = {
  schemaVersion: 2;
  serving: "ORIGINAL" | "UNIVERSAL" | "MATCHED";
  reason: string;
  deploymentId: string | null;
  deploymentRevision: number | null;
  experimentId: string | null;
  assignmentId: string | null;
  assignmentArm: "ORIGINAL" | "MATCHED" | null;
  decisionId: string | null;
  measurementReference: string | null;
  expiresAt: string | null;
  content: ApprovedPanelV2 | null;
};

export class V2DecisionRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

class V2AuthorityChangedError extends Error {}

export function originalDecisionV2(
  reason: string,
  deployment?: { id: string; revision: number } | null,
): DecisionResponseV2 {
  return {
    schemaVersion: 2,
    serving: "ORIGINAL",
    reason,
    deploymentId: deployment?.id ?? null,
    deploymentRevision: deployment?.revision ?? null,
    experimentId: null,
    assignmentId: null,
    assignmentArm: null,
    decisionId: null,
    measurementReference: null,
    expiresAt: null,
    content: null,
  };
}

export function parseDecisionRequestV2(value: unknown): DecisionRequestV2 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2DecisionRequestError("INVALID_REQUEST", 400);
  const input = value as Record<string, unknown>;
  const consent = input.consent as Record<string, unknown> | undefined;
  if (
    input.schemaVersion !== 2 ||
    typeof input.requestId !== "string" ||
    !OPAQUE_PATTERN.test(input.requestId) ||
    typeof input.productId !== "string" ||
    !canonicalProductId(input.productId) ||
    typeof input.visitorToken !== "string" ||
    !OPAQUE_PATTERN.test(input.visitorToken) ||
    typeof input.sessionId !== "string" ||
    !OPAQUE_PATTERN.test(input.sessionId) ||
    !consent ||
    consent.analytics !== true ||
    consent.preferences !== true ||
    typeof consent.policyVersion !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,80}$/.test(consent.policyVersion) ||
    typeof input.blockVersion !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,80}$/.test(input.blockVersion) ||
    (input.campaignRef != null &&
      (typeof input.campaignRef !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.campaignRef)))
  ) {
    throw new V2DecisionRequestError("INVALID_REQUEST", 400);
  }
  return input as DecisionRequestV2;
}

function secret(environment: Record<string, string | undefined>) {
  const value = environment.ASSIGNMENT_SECRET?.trim() ?? "";
  if (value.length < 32)
    throw new V2DecisionRequestError("V2_CONFIGURATION_UNAVAILABLE", 503);
  return value;
}

function tenantHash(
  key: string,
  merchantId: string,
  kind: "visitor" | "session",
  token: string,
) {
  return createHmac("sha256", key)
    .update(`${merchantId}\n${kind}\n${token}`)
    .digest("hex");
}

function experimentBucket(input: {
  merchantId: string;
  experimentId: string;
  visitorHash: string;
  salt: string;
}) {
  const digest = createHmac("sha256", input.salt)
    .update(`${input.merchantId}:${input.experimentId}:${input.visitorHash}`)
    .digest();
  return digest.readUInt32BE(0) % 10_000;
}

function signedReference(
  key: string,
  payload: {
    merchantId: string;
    productId: string;
    deploymentId: string;
    experimentId: string;
    assignmentId: string;
    decisionId: string;
    issuedAt: string;
    expiresAt: string;
  },
) {
  const body = Buffer.from(canonicalQueuePayload(payload)).toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyV2MeasurementReference(
  value: string,
  assignmentSecret: string,
) {
  const [body, supplied] = value.split(".");
  if (!body || !supplied) return null;
  const expected = createHmac("sha256", assignmentSecret)
    .update(body)
    .digest("base64url");
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return parsed;
  } catch {
    return null;
  }
}

async function approvedPanel(
  db: Pick<PrismaClient, "experienceVersion">,
  merchantId: string,
  productId: string,
  deployment: { canonicalPayload: string; contentSetHash: string },
  policy: "UNIVERSAL" | "MATCHED",
  campaignRef?: string | null,
) {
  let contentVersionId: string | null = null;
  let adaptiveBundleSet: { snapshot?: unknown; bundleIds?: Record<string, string> } | null = null;
  try {
    const payload = JSON.parse(deployment.canonicalPayload) as {
      contentVersionId?: string | null;
      adaptiveBundleSet?: { snapshot?: unknown; bundleIds?: Record<string, string> } | null;
    };
    contentVersionId = payload.contentVersionId ?? null;
    const configured = payload.adaptiveBundleSet;
    adaptiveBundleSet = configured ?? null;
    if (policy === "MATCHED" && configured?.snapshot && configured.bundleIds) {
      const selection = resolveAdaptiveMapping({
        merchantId,
        productId,
        locale: "en",
        campaignRef,
        snapshot: configured.snapshot as never,
      });
      contentVersionId = selection.bundleId
        ? configured.bundleIds[selection.bundleId] ?? null
        : null;
    }
  } catch {
    return null;
  }
  if (!contentVersionId) return null;
  const experience = await db.experienceVersion.findFirst({
    where: { id: contentVersionId, merchantId, productId },
    include: {
      product: true,
      approval: true,
      claims: { include: { evidenceLinks: { include: { evidence: true } } } },
    },
  });
  if (
    !experience ||
    (!adaptiveBundleSet && experience.contentHash !== deployment.contentSetHash) ||
    validateRuntimeExperience(experience)
  )
    return null;
  const benefits = JSON.parse(experience.benefitsJson) as string[];
  const proofItems = JSON.parse(experience.proofItemsJson) as string[];
  const evidenceFor = (text: string) =>
    experience.claims
      .filter((claim) => claim.claimText === text)
      .flatMap((claim) => claim.evidenceLinks.map((link) => link.evidence.id))
      .filter((id, index, values) => values.indexOf(id) === index);
  let faq: Array<{ question: string; answer: string; evidenceIds: string[] }> = [];
  try {
    const raw = JSON.parse(experience.rawOutputJson) as { faq?: unknown };
    if (Array.isArray(raw.faq)) {
      const evidenceIds = new Set(experience.claims.flatMap((claim) => claim.evidenceLinks.map((link) => link.evidence.id)));
      faq = raw.faq.filter((item): item is { question: string; answer: string; evidenceIds: string[] } => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Record<string, unknown>;
        return typeof candidate.question === "string" && candidate.question.length <= 160 &&
          typeof candidate.answer === "string" && candidate.answer.length <= 500 &&
          Array.isArray(candidate.evidenceIds) && candidate.evidenceIds.every((id) => typeof id === "string") &&
          candidate.evidenceIds.length > 0 && candidate.evidenceIds.every((id) => evidenceIds.has(id));
      });
    }
  } catch { faq = []; }
  if (
    benefits.length < 2 ||
    benefits.length > 4 ||
    !benefits.every((benefit) => evidenceFor(benefit).length > 0) ||
    !Array.isArray(proofItems) || proofItems.length > 4 ||
    !proofItems.every((proof) => evidenceFor(proof).length > 0) ||
    evidenceFor(experience.headline).length === 0
  )
    return null;
  const reassuranceEvidence = experience.reassurance
    ? evidenceFor(experience.reassurance)
    : [];
  if (experience.reassurance && reassuranceEvidence.length === 0) return null;
  return {
    schemaVersion: 2 as const,
    contentVersionId: experience.id,
    contentHash: experience.contentHash,
    headline: experience.headline,
    benefits: benefits.map((text) => ({ text, evidenceIds: evidenceFor(text) })),
    proofItems,
    faq,
    reassurance: experience.reassurance
      ? { text: experience.reassurance, evidenceIds: reassuranceEvidence }
      : null,
    headlineEvidenceIds: evidenceFor(experience.headline),
  } satisfies ApprovedPanelV2;
}

type AdaptiveDeploymentAuthority = {
  canonicalPayload: string;
  contentSetHash: string;
  approvedAuthorityHash: string;
  experiment: { registration: { contentVersionsJson: string } | null } | null;
};

type RuntimeAuthorityBundle = {
  id: string;
  version: number;
  contentHash: string;
  sourceSnapshotHash: string;
  headline: string;
  supportingLine: string | null;
  benefitsJson: string;
  proofItemsJson: string;
  reassurance: string | null;
  rawOutputJson: string;
  approval: {
    contentHash: string;
    evidenceSnapshotHash: string;
    policyVersion: string;
  } | null;
  claims: Array<{
    claimText: string;
    claimType: string;
    evidenceLinks: Array<{ evidence: {
      id: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: string;
      sourceHash: string;
      verbatimText: string;
      productScope: string;
      localeScope: string;
      expiresAt: Date | null;
    } }>;
  }>;
};

function runtimeBundleAuthorityHash(bundle: RuntimeAuthorityBundle) {
  if (!bundle.approval) return null;
  try {
    const benefits = JSON.parse(bundle.benefitsJson) as unknown;
    const proofItems = JSON.parse(bundle.proofItemsJson) as unknown;
    const raw = JSON.parse(bundle.rawOutputJson) as { faq?: unknown };
    if (
      !Array.isArray(benefits) ||
      benefits.some((item) => typeof item !== "string") ||
      !Array.isArray(proofItems) ||
      proofItems.some((item) => typeof item !== "string")
    ) return null;
    const evidence = bundle.claims
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
    const rawFaq = raw && Array.isArray(raw.faq) ? raw.faq : [];
    if (rawFaq.length > 4) return null;
    const faq = rawFaq.map((item) => {
      if (!item || typeof item !== "object") throw new Error();
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
        candidate.evidenceIds.some((id) => typeof id !== "string" || !eligibleEvidenceIds.has(id))
      ) throw new Error();
      return {
        question: candidate.question,
        answer: candidate.answer,
        evidenceIds: [...new Set(candidate.evidenceIds as string[])].sort(),
      };
    });
    const claims = bundle.claims.map((claim) => ({
      text: claim.claimText,
      claimType: claim.claimType,
      evidenceIds: claim.evidenceLinks.map((link) => link.evidence.id).sort(),
    })).sort((left, right) => left.text.localeCompare(right.text));
    return createHash("sha256").update(canonicalQueuePayload({
      bundleId: bundle.id,
      bundleVersion: bundle.version,
      contentHash: bundle.contentHash,
      sourceSnapshotHash: bundle.sourceSnapshotHash,
      approvalContentHash: bundle.approval.contentHash,
      approvalEvidenceSnapshotHash: bundle.approval.evidenceSnapshotHash,
      approvalPolicyVersion: bundle.approval.policyVersion,
      headline: bundle.headline,
      supportingLine: bundle.supportingLine,
      benefits,
      proofItems,
      reassurance: bundle.reassurance,
      faq,
      claims,
      evidence,
    })).digest("hex");
  } catch {
    return null;
  }
}

async function adaptiveDeploymentAuthorityValid(
  db: Pick<PrismaClient, "experienceVersion">,
  merchantId: string,
  productId: string,
  deployment: AdaptiveDeploymentAuthority,
) {
  try {
    const payload = JSON.parse(deployment.canonicalPayload) as {
      approvedAuthorityHash?: unknown;
      contentVersionId?: unknown;
      adaptiveBundleSet?: {
        snapshot?: { version?: unknown; hash?: unknown; mappings?: unknown };
        bundleIds?: Record<string, string>;
        bundleHashes?: Record<string, string>;
        bundleAuthorityHashes?: Record<string, string>;
      } | null;
    };
    const configured = payload.adaptiveBundleSet;
    if (
      payload.approvedAuthorityHash !== deployment.approvedAuthorityHash ||
      !configured?.snapshot ||
      !configured.bundleIds ||
      !configured.bundleHashes ||
      !configured.bundleAuthorityHashes ||
      !Array.isArray(configured.snapshot.mappings) ||
      typeof configured.snapshot.version !== "number" ||
      typeof configured.snapshot.hash !== "string"
    ) return false;
    const rebuilt = createMappingSnapshot(
      configured.snapshot.mappings as never,
      configured.snapshot.version,
    );
    if (rebuilt.hash !== configured.snapshot.hash) return false;
    const bundleIds = [...new Set(Object.values(configured.bundleIds))].sort();
    const mappingBundleIds = [...new Set(rebuilt.mappings.map((item) => item.bundleId))].sort();
    if (
      bundleIds.length === 0 ||
      canonicalQueuePayload(bundleIds) !== canonicalQueuePayload(mappingBundleIds) ||
      Object.keys(configured.bundleHashes).length !== bundleIds.length ||
      Object.keys(configured.bundleAuthorityHashes).length !== bundleIds.length ||
      deployment.contentSetHash !== createHash("sha256").update(canonicalQueuePayload({
        snapshotHash: rebuilt.hash,
        bundleIds: configured.bundleIds,
        bundleHashes: configured.bundleHashes,
        bundleAuthorityHashes: configured.bundleAuthorityHashes,
      })).digest("hex")
    ) return false;
    const frozen = JSON.parse(
      deployment.experiment?.registration?.contentVersionsJson ?? "[]",
    ) as Array<{ id?: unknown; contentHash?: unknown }>;
    const contentIds = typeof payload.contentVersionId === "string"
      ? [...new Set([...bundleIds, payload.contentVersionId])]
      : bundleIds;
    const bundles = await db.experienceVersion.findMany({
      where: { id: { in: contentIds }, merchantId, productId },
      include: {
        product: true,
        approval: true,
        claims: { include: { evidenceLinks: { include: { evidence: true } } } },
      },
    });
    if (bundles.length !== contentIds.length) return false;
    return bundles.every((bundle) => {
      const expectedHash = configured.bundleHashes![bundle.id] ??
        (bundle.id === payload.contentVersionId ? bundle.contentHash : null);
      return Boolean(
        expectedHash === bundle.contentHash &&
        (!configured.bundleIds![bundle.id] ||
          configured.bundleAuthorityHashes![bundle.id] ===
            runtimeBundleAuthorityHash(bundle as RuntimeAuthorityBundle)) &&
        !validateRuntimeExperience(bundle) &&
        frozen.some((item) => item.id === bundle.id && item.contentHash === bundle.contentHash),
      );
    });
  } catch {
    return false;
  }
}

export async function resolveV2Decision(args: {
  db: PrismaClient;
  shop: string;
  request: DecisionRequestV2;
  now?: Date;
  environment?: Record<string, string | undefined>;
}): Promise<DecisionResponseV2> {
  const environment = args.environment ?? process.env;
  if (!mvpV2EnabledForShop(args.shop, environment))
    return originalDecisionV2("V2_DISABLED");
  const assignmentSecret = secret(environment);
  const now = args.now ?? new Date();
  const shopifyProductId = canonicalProductId(args.request.productId);
  if (!shopifyProductId) throw new V2DecisionRequestError("INVALID_PRODUCT", 400);
  const merchant = await args.db.merchant.findUnique({ where: { shop: args.shop } });
  if (!merchant) return originalDecisionV2("MERCHANT_NOT_CONFIGURED");
  const visitorHash = tenantHash(
    assignmentSecret,
    merchant.id,
    "visitor",
    args.request.visitorToken,
  );
  const sessionHash = tenantHash(
    assignmentSecret,
    merchant.id,
    "session",
    args.request.sessionId,
  );
  const receiptKey = `decision:${args.request.requestId}`;

  try {
    const result = await args.db.$transaction(async (tx) => {
      const runtime = await tx.runtimeControl.findUnique({
        where: { merchantId: merchant.id },
      });
      if (!runtime)
        return { response: originalDecisionV2("DEPLOYMENT_UNAVAILABLE") };
      const runtimeLease = await tx.runtimeControl.updateMany({
        where: {
          id: runtime.id,
          merchantId: merchant.id,
          killSwitch: runtime.killSwitch,
          updatedAt: runtime.updatedAt,
        },
        data: { updatedAt: runtime.updatedAt },
      });
      if (runtimeLease.count !== 1) throw new V2AuthorityChangedError();
      if (runtime.killSwitch)
        return { response: originalDecisionV2("KILL_SWITCH_ACTIVE") };
      await assertIdentityNotSuppressed({ tx, shop: merchant.shop, environment, identities: [
        { kind: "VISITOR", value: visitorHash }, { kind: "SESSION", value: sessionHash },
        { kind: "VISITOR", value: args.request.visitorToken }, { kind: "SESSION", value: args.request.sessionId },
      ] });

      const product = await tx.product.findUnique({
        where: {
          merchantId_shopifyProductId: {
            merchantId: merchant.id,
            shopifyProductId,
          },
        },
      });
      if (!product || product.status !== "ACTIVE")
        return { response: originalDecisionV2("PRODUCT_NOT_ELIGIBLE") };
      const productLease = await tx.product.updateMany({
        where: {
          id: product.id,
          merchantId: merchant.id,
          status: "ACTIVE",
          sourceHash: product.sourceHash,
        },
        data: { status: "ACTIVE" },
      });
      if (productLease.count !== 1) throw new V2AuthorityChangedError();

      const pointer = await tx.activeDeployment.findUnique({
        where: { productId: product.id },
        include: {
          deploymentVersion: {
            include: { experiment: { include: { registration: true } } },
          },
        },
      });
      if (
        !pointer ||
        pointer.merchantId !== merchant.id ||
        pointer.deploymentVersion.merchantId !== merchant.id ||
        pointer.deploymentVersion.productId !== product.id ||
        pointer.deploymentVersion.revision !== pointer.revision ||
        pointer.deploymentVersion.protocolVersion !== MVP_V2_PROTOCOL_VERSION
      ) {
        return { response: originalDecisionV2("DEPLOYMENT_UNAVAILABLE") };
      }
      const deployment = pointer.deploymentVersion;
      if (deployment.experiment?.privacyAffectedAt)
        return { response: originalDecisionV2("PRIVACY_REVIEW_REQUIRED") };
      const deploymentRef = { id: deployment.id, revision: deployment.revision };
      const pointerLease = await tx.activeDeployment.updateMany({
        where: {
          id: pointer.id,
          merchantId: merchant.id,
          productId: product.id,
          deploymentVersionId: deployment.id,
          revision: deployment.revision,
        },
        data: { updatedAt: pointer.updatedAt },
      });
      if (pointerLease.count !== 1) throw new V2AuthorityChangedError();
      if (deployment.state !== "ACTIVE")
        return {
          response: originalDecisionV2("DEPLOYMENT_PAUSED", deploymentRef),
        };

      let experiment = deployment.experiment;
      if (experiment) {
        const experimentLease = await tx.experiment.updateMany({
          where: {
            id: experiment.id,
            merchantId: merchant.id,
            productId: product.id,
            status: experiment.status,
            lifecycleVersion: experiment.lifecycleVersion,
            enrollmentClosedAt: experiment.enrollmentClosedAt,
          },
          data: { status: experiment.status },
        });
        if (experimentLease.count !== 1) throw new V2AuthorityChangedError();
        experiment = await tx.experiment.findUnique({
          where: { id: experiment.id },
          include: { registration: true },
        });
        if (
          !experiment ||
          experiment.merchantId !== merchant.id ||
          experiment.productId !== product.id ||
          experiment.registration?.protocolVersion !== MVP_V2_PROTOCOL_VERSION ||
          experiment.registration.primaryMetric !== MVP_V2_PRIMARY_METRIC
        ) {
          return {
            response: originalDecisionV2(
              "EXPERIMENT_AUTHORITY_INVALID",
              deploymentRef,
            ),
          };
        }
        if (
          ["PAUSED", "STOPPED", "INVALIDATED", "REPAIR_REQUIRED"].includes(
            experiment.status,
          )
        ) {
          return {
            response: originalDecisionV2("EXPERIMENT_PAUSED", deploymentRef),
          };
        }
      }

      const requestMaterial = canonicalQueuePayload({
        schemaVersion: 2,
        requestId: args.request.requestId,
        productId: shopifyProductId,
        visitorHash,
        sessionHash,
        consentPolicyVersion: args.request.consent.policyVersion,
        campaignRef: args.request.campaignRef ?? null,
        blockVersion: args.request.blockVersion,
        deploymentId: deployment.id,
        deploymentRevision: deployment.revision,
      });
      const requestHash = createHash("sha256")
        .update(requestMaterial)
        .digest("hex");
      const policies = experiment
        ? [experiment.controlPolicy, experiment.treatmentPolicy]
        : [deployment.policy];
      let adaptiveConfigured = false;
      let selectedMappingVersion: number | null = null;
      let selectedMappingReason: string | null = null;
      try {
        const payload = JSON.parse(deployment.canonicalPayload) as { adaptiveBundleSet?: unknown };
        adaptiveConfigured = Boolean(payload.adaptiveBundleSet);
        const configured = payload.adaptiveBundleSet as { snapshot?: unknown } | null;
        if (configured?.snapshot) {
          const selection = resolveAdaptiveMapping({
            merchantId: merchant.id,
            productId: product.id,
            locale: "en",
            campaignRef: args.request.campaignRef,
            snapshot: configured.snapshot as never,
          });
          selectedMappingVersion = selection.mappingVersion;
          selectedMappingReason = selection.reason;
        }
      } catch {
        adaptiveConfigured = false;
      }
      if (
        adaptiveConfigured &&
        !(await adaptiveDeploymentAuthorityValid(
          tx,
          merchant.id,
          product.id,
          deployment,
        ))
      ) {
        return {
          response: originalDecisionV2("CONTENT_AUTHORITY_INVALID", deploymentRef),
        };
      }
      const matchedContent = policies.includes("MATCHED")
        ? await approvedPanel(
            tx,
            merchant.id,
            product.id,
            deployment,
            "MATCHED",
            args.request.campaignRef,
          )
        : null;
      const universalContent = policies.includes("UNIVERSAL")
        ? await approvedPanel(
            tx,
            merchant.id,
            product.id,
            deployment,
            "UNIVERSAL",
            args.request.campaignRef,
          )
        : null;
      const contentForPolicy = (policy: string) =>
        policy === "MATCHED"
          ? matchedContent
          : policy === "UNIVERSAL"
            ? universalContent
            : null;
      if (
        policies.some(
          (policy) => !["ORIGINAL", "UNIVERSAL", "MATCHED"].includes(policy),
        ) ||
        policies.some(
          (policy) => policy !== "ORIGINAL" && policy !== "MATCHED" && !contentForPolicy(policy),
        )
      ) {
        return {
          response: originalDecisionV2(
            "CONTENT_AUTHORITY_INVALID",
            deploymentRef,
          ),
        };
      }

      function baselineResponse(reason: string): DecisionResponseV2 {
        const serving = (experiment?.controlPolicy ??
          "ORIGINAL") as DecisionResponseV2["serving"];
        return {
          schemaVersion: 2,
          serving,
          reason,
          deploymentId: deployment.id,
          deploymentRevision: deployment.revision,
          experimentId: experiment?.id ?? null,
          assignmentId: null,
          assignmentArm: null,
          decisionId: null,
          measurementReference: null,
          expiresAt: null,
          content: contentForPolicy(serving),
        };
      }

      const receipt = await tx.actionReceipt.findUnique({
        where: {
          merchantId_idempotencyKey: {
            merchantId: merchant.id,
            idempotencyKey: receiptKey,
          },
        },
      });
      if (receipt) {
        if (receipt.inputHash !== requestHash)
          throw new QueueIdempotencyConflictError();
        const decision = await tx.decision.findFirst({
          where: { id: receipt.responseRef, merchantId: merchant.id },
          include: { assignment: true },
        });
        if (!decision)
          throw new Error("Decision receipt target is unavailable.");
        if (decision.assignment && decision.assignment.expiresAt <= now)
          return { response: baselineResponse("ASSIGNMENT_EXPIRED") };
        return {
          decision,
          assignment: decision.assignment,
          content: contentForPolicy(decision.policy),
        };
      }

      let assignment = null;
      let servingPolicy = deployment.policy;
      let bucket: number | null = null;
      let expiresAt: Date | null = null;
      if (experiment) {
        const existing = await tx.assignment.findUnique({
          where: {
            experimentId_randomizationUnitId: {
              experimentId: experiment.id,
              randomizationUnitId: visitorHash,
            },
          },
        });
        if (existing && existing.expiresAt <= now)
          return { response: baselineResponse("ASSIGNMENT_EXPIRED") };
        const hardCloseAt = new Date(
          (experiment.enrollmentStartedAt ?? experiment.startedAt).getTime() +
            experiment.registration!.maximumDurationDays * DAY_MS,
        );
        const enrollmentOpen =
          experiment.status === "ACTIVE" &&
          !experiment.enrollmentClosedAt &&
          now < hardCloseAt;
        if (!existing && !enrollmentOpen) {
          return {
            response: baselineResponse(
              now >= hardCloseAt
                ? "EXPERIMENT_ENROLLMENT_DEADLINE"
                : "EXPERIMENT_NOT_ENROLLING",
            ),
          };
        }
        // Adaptive matching eligibility is pre-treatment: an unknown or
        // unmapped first visit must not create an assignment. Existing visitors
        // remain in their frozen cohort even when later context disappears.
        if (!existing && adaptiveConfigured && !matchedContent) {
          const decisionId = `v2dec_${createHash("sha256")
            .update(`${merchant.id}:${args.request.requestId}`)
            .digest("hex")
            .slice(0, 32)}`;
          const diagnostic = await tx.decision.create({
            data: {
              id: decisionId,
              merchantId: merchant.id,
              experimentId: experiment.id,
              assignmentId: null,
              productId: product.id,
              experienceVersionId: null,
              sessionId: sessionHash,
              visitorId: visitorHash,
              arm: "ORIGINAL",
              policy: "ORIGINAL",
              acquisitionAngle: null,
              mappingVersion: null,
              bucket: null,
              reason: selectedMappingReason ?? "ADAPTIVE_CONTEXT_UNMATCHED",
              consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
              occurredAt: now,
              requestHash,
              deploymentVersionId: deployment.id,
              deploymentRevision: deployment.revision,
            },
          });
          await tx.actionReceipt.create({
            data: {
              merchantId: merchant.id,
              actor: "STOREFRONT_VISITOR",
              action: "V2_DECISION",
              idempotencyKey: receiptKey,
              inputHash: requestHash,
              responseRef: diagnostic.id,
            },
          });
          return { decision: diagnostic, assignment: null, content: null };
        }
        bucket = experimentBucket({
          merchantId: merchant.id,
          experimentId: experiment.id,
          visitorHash,
          salt: experiment.salt,
        });
        const assignedArm =
          bucket < experiment.controlPercentage * 100 ? "ORIGINAL" : "MATCHED";
        expiresAt = existing?.expiresAt ?? new Date(now.getTime() + 7 * DAY_MS);
        assignment =
          existing ??
          (await tx.assignment.create({
            data: {
              merchantId: merchant.id,
              experimentId: experiment.id,
              randomizationUnitId: visitorHash,
              randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR",
              visitorHash,
              arm: assignedArm,
              bucket,
              saltVersion: experiment.saltVersion,
              consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
              consentPolicyVersion: args.request.consent.policyVersion,
              eligibilityVersion: "pagnetic-v2-eligibility-v1",
              assignedAt: now,
              expiresAt,
            },
          }));
        servingPolicy =
          assignment.arm === "ORIGINAL"
            ? experiment.controlPolicy
            : experiment.treatmentPolicy;
      }
      // A known visitor can later arrive without a valid campaign context. Keep
      // the assigned visitor in the cohort, but fail open to Original instead of
      // dropping the decision or serving an unapproved bundle.
      let content = contentForPolicy(servingPolicy);
      if (adaptiveConfigured && servingPolicy === "MATCHED" && !content) {
        servingPolicy = "ORIGINAL";
        content = null;
      }

      const decisionId = `v2dec_${createHash("sha256")
        .update(`${merchant.id}:${args.request.requestId}`)
        .digest("hex")
        .slice(0, 32)}`;
      const decision = await tx.decision.create({
        data: {
          id: decisionId,
          merchantId: merchant.id,
          experimentId: experiment?.id ?? null,
          assignmentId: assignment?.id ?? null,
          productId: product.id,
          experienceVersionId:
            servingPolicy === "ORIGINAL" ? null : content?.contentVersionId ?? null,
          sessionId: sessionHash,
          visitorId: visitorHash,
          arm: experiment ? assignment!.arm : servingPolicy,
          policy: servingPolicy,
          // Mapping eligibility is pre-treatment context. Preserve it for both
          // arms so coverage does not incorrectly classify control visitors as
          // unmatched; it never selects content for the Original arm.
          acquisitionAngle: selectedMappingVersion == null ? null : "adaptive-campaign",
          mappingVersion: selectedMappingVersion,
          bucket,
          reason: experiment
            ? adaptiveConfigured
              ? selectedMappingReason ?? "INVALID_SNAPSHOT"
              : "V2_EXPERIMENT_ASSIGNMENT"
            : "V2_APPROVED_SERVING",
          consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED",
          occurredAt: now,
          requestHash,
          deploymentVersionId: deployment.id,
          deploymentRevision: deployment.revision,
        },
      });
      await tx.actionReceipt.create({
        data: {
          merchantId: merchant.id,
          actor: "STOREFRONT_VISITOR",
          action: "V2_DECISION",
          idempotencyKey: receiptKey,
          inputHash: requestHash,
          responseRef: decision.id,
        },
      });
      return { decision, assignment, content };
    });
    if ("response" in result && result.response) return result.response;

    const serving = result.decision.policy as DecisionResponseV2["serving"];
    const expiresAt = result.assignment?.expiresAt ?? null;
    const measurementReference =
      result.assignment && expiresAt
        ? signedReference(assignmentSecret, {
            merchantId: merchant.id,
            productId: result.decision.productId,
            deploymentId: result.decision.deploymentVersionId!,
            experimentId: result.assignment.experimentId,
            assignmentId: result.assignment.id,
            decisionId: result.decision.id,
            issuedAt: result.decision.occurredAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
          })
        : null;
    return {
      schemaVersion: 2,
      serving,
      reason: result.decision.reason,
      deploymentId: result.decision.deploymentVersionId,
      deploymentRevision: result.decision.deploymentRevision,
      experimentId: result.assignment?.experimentId ?? result.decision.experimentId ?? null,
      assignmentId: result.assignment?.id ?? null,
      assignmentArm: (result.assignment?.arm as "ORIGINAL" | "MATCHED" | undefined) ?? null,
      decisionId: result.decision.id,
      measurementReference,
      expiresAt: expiresAt?.toISOString() ?? null,
      content: serving === "ORIGINAL" ? null : result.content,
    };
  } catch (error) {
    if (error instanceof PrivacyIdentitySuppressedError)
      return originalDecisionV2("PRIVACY_SCOPE_SUPPRESSED");
    if (error instanceof V2AuthorityChangedError)
      return originalDecisionV2("DEPLOYMENT_AUTHORITY_CHANGED");
    throw error;
  }
}

export async function loadV2BaselineCapture(args: {
  db: PrismaClient;
  merchantId: string;
  shopifyProductId: string;
  observationStart: Date;
  observationEnd: Date;
}) {
  const events = await args.db.commerceEvent.findMany({
    where: {
      merchantId: args.merchantId,
      eventType: "product_viewed",
      productId: args.shopifyProductId,
      consentState: "analytics_and_preferences_allowed",
      occurredAt: { gte: args.observationStart, lt: args.observationEnd },
    },
    select: { eventId: true, clientId: true, sessionId: true, decisionId: true },
  });
  const visitors = new Set(
    events.map((event) => event.clientId).filter((value): value is string => Boolean(value)),
  );
  const sessions = new Set(
    events
      .map((event) => event.sessionId)
      .filter((value): value is string => Boolean(value)),
  );
  return {
    dataSource: "CONSENTED_SHOPIFY_PIXEL_PRODUCT_VIEW_V2_TRAFFIC_ONLY" as const,
    qualificationUsable: false as const,
    missingSessionEvents: events.filter((event) => !event.sessionId).length,
    uniqueEvents: new Set(events.map((event) => event.eventId)).size,
    eligibleVisitors: visitors.size,
    eligibleSessions: sessions.size,
    decisionsObserved: new Set(
      events.map((event) => event.decisionId).filter((value): value is string => Boolean(value)),
    ).size,
  };
}

import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import { assertOrderNotSuppressed, lockMerchantPrivacy, PrivacyOrderSuppressedError } from "./order-privacy-guard.server";
import { assertIdentityNotSuppressed, PrivacyIdentitySuppressedError, type PrivacyIdentity } from "./identity-privacy-guard.server";
import { mvpV2EnabledForShop } from "./mvp-v2";

import {
  canonicalProductId,
  originalRuntimeResponse,
  resolveMatchedAngle,
  resolveStorefrontExperience,
  type StorefrontRuntimeResponse,
} from "./runtime.server";
import {
  executionPolicyForArm,
  type ExperimentPolicy,
} from "./experiment-health";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_:./-]{1,160}$/;
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const ALLOWED_EVENT_TYPES = new Set([
  "adaptive_storefront_decision",
  "adaptive_storefront_render",
  "adaptive_storefront_vitals",
  "adaptive_storefront:decision",
  "adaptive_storefront:render",
  "page_viewed",
  "product_viewed",
  "product_added_to_cart",
  "cart_viewed",
  "checkout_started",
  "checkout_completed",
]);

export function pixelEventTypeForTelemetry(value: unknown) {
  return typeof value === "string" && ALLOWED_EVENT_TYPES.has(value)
    ? value
    : "unknown";
}
const PII_KEYS = new Set([
  "address",
  "customer",
  "email",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "name",
  "phone",
]);

export type MeasurementContext = {
  decisionId: string;
  experimentId: string;
  experimentVersion: number;
  assignmentId: string;
  assignmentArm: "original" | "matched";
  bucket: number;
  persistence: "visitor" | "session";
  consentState: string;
  serverProcessingMs: number;
};

export type MeasuredRuntimeResponse = StorefrontRuntimeResponse & {
  measurement: MeasurementContext;
};

export function validOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

export function experimentBucket(input: {
  merchantId: string;
  experimentId: string;
  randomizationUnitId: string;
  salt: string;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.merchantId,
        input.experimentId,
        input.randomizationUnitId,
        input.salt,
      ].join(":"),
    )
    .digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function hashPixelToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function pixelTokenMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(hashPixelToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function canonicalOrderId(value: unknown) {
  const candidate = String(value ?? "").trim();
  if (/^gid:\/\/shopify\/Order\/\d+$/.test(candidate)) return candidate;
  if (/^\d+$/.test(candidate)) return `gid://shopify/Order/${candidate}`;
  return null;
}

export function mergeOrderMetadata(
  previousJson: string | null | undefined,
  incoming: {
    webhookId: string;
    topic: string;
    lineItemCount: number;
    test: boolean;
    recovered?: boolean;
  },
) {
  let previous: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(previousJson ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      previous = parsed as Record<string, unknown>;
    }
  } catch {
    previous = {};
  }
  return JSON.stringify({
    ...previous,
    firstWebhookId:
      previous.firstWebhookId ?? previous.webhookId ?? incoming.webhookId,
    webhookId: incoming.webhookId,
    topic: incoming.topic,
    lineItemCount: Math.max(
      Number(previous.lineItemCount ?? 0),
      incoming.lineItemCount,
    ),
    test: previous.test === true || incoming.test,
    recovered: previous.recovered === true || incoming.recovered === true,
  });
}

export async function registerExperiment(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  key: string;
  controlPercentage: number;
  controlPolicy?: ExperimentPolicy;
  treatmentPolicy?: ExperimentPolicy;
  initialStatus?: "ACTIVE" | "DRAFT";
  registration?: Partial<{
    protocolVersion: string;
    hypothesis: string;
    revenueDefinition: "GROSS" | "NET";
    minimumMeaningfulLift: number;
    alpha: number;
    power: number;
    targetSampleSize: number;
    minimumDurationDays: number;
    maximumDurationDays: number;
    dataMaturityLagDays: number;
  }>;
}) {
  const key = String(args.key).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(key)) {
    throw new Error(
      "Experiment ID must use 3–64 lowercase letters, numbers, dashes, or underscores.",
    );
  }
  if (
    !Number.isInteger(args.controlPercentage) ||
    args.controlPercentage < 0 ||
    args.controlPercentage > 100
  ) {
    throw new Error(
      "Control allocation must be a whole percentage from 0 to 100.",
    );
  }
  const controlPolicy = args.controlPolicy ?? "ORIGINAL";
  const treatmentPolicy = args.treatmentPolicy ?? "MATCHED";
  if (
    !["ORIGINAL", "UNIVERSAL", "MATCHED"].includes(controlPolicy) ||
    !["ORIGINAL", "UNIVERSAL", "MATCHED"].includes(treatmentPolicy)
  ) {
    throw new Error(
      "Experiment policies must be ORIGINAL, UNIVERSAL, or MATCHED.",
    );
  }
  const product = await args.db.product.findFirst({
    where: {
      id: args.productId,
      merchantId: args.merchantId,
      status: "ACTIVE",
    },
  });
  if (!product) throw new Error("Select an active synced product.");

  const registration = {
    protocolVersion: args.registration?.protocolVersion ?? "pilot-v0.3",
    hypothesis:
      args.registration?.hypothesis ??
      (controlPolicy === treatmentPolicy
        ? "A/A instrumentation should show no material allocation, capture, or revenue-join imbalance."
        : controlPolicy === "ORIGINAL" && treatmentPolicy === "UNIVERSAL"
          ? "A universal approved panel improves revenue per eligible session versus the original PDP."
          : controlPolicy === "UNIVERSAL" && treatmentPolicy === "MATCHED"
            ? "Message-matched approved content improves revenue per eligible session versus a universal approved panel."
            : "The treatment policy improves revenue per eligible session versus the control policy."),
    primaryMetric: "REVENUE_PER_ELIGIBLE_SESSION",
    revenueDefinition: args.registration?.revenueDefinition ?? "NET",
    minimumMeaningfulLift: args.registration?.minimumMeaningfulLift ?? 0.05,
    alpha: args.registration?.alpha ?? 0.05,
    power: args.registration?.power ?? 0.8,
    targetSampleSize: args.registration?.targetSampleSize ?? 1000,
    minimumDurationDays: args.registration?.minimumDurationDays ?? 14,
    maximumDurationDays: args.registration?.maximumDurationDays ?? 42,
    randomizationUnit: "VISITOR_WITH_SESSION_FALLBACK",
    eligibilityJson: JSON.stringify({
      productId: product.shopifyProductId,
      requiresAnalyticsConsent: true,
    }),
    exclusionsJson: JSON.stringify([
      "bots",
      "staff_qa",
      "invalid_product",
      "missing_consent",
    ]),
    covariatesJson: JSON.stringify(["device", "acquisition_angle", "market"]),
    stoppingRule:
      "Fixed sample target and at least two full weekly cycles; no outcome-driven extension.",
    analysisVersion: "cluster-rps-v1",
    guardrailsJson: JSON.stringify({
      javascriptErrorRateMaximum: 0.001,
      decisionP95MillisecondsMaximum: 1000,
      serverProcessingP95MillisecondsMaximum: 150,
      renderSuccessMinimum: 0.995,
    }),
    dataMaturityLagDays: args.registration?.dataMaturityLagDays ?? 7,
  };
  if (
    !Number.isInteger(registration.targetSampleSize) ||
    registration.targetSampleSize < 20
  ) {
    throw new Error(
      "Target sample size must be at least 20 eligible sessions.",
    );
  }
  if (
    !Number.isInteger(registration.minimumDurationDays) ||
    !Number.isInteger(registration.maximumDurationDays) ||
    registration.minimumDurationDays < 1 ||
    registration.maximumDurationDays < registration.minimumDurationDays
  ) {
    throw new Error(
      "Experiment duration must have a valid minimum and maximum.",
    );
  }
  const [contentVersions, mappingVersions, pilotSettings] = await Promise.all([
    args.db.experienceVersion.findMany({
      where: {
        merchantId: args.merchantId,
        productId: product.id,
        status: "APPROVED_ACTIVE",
      },
      select: {
        id: true,
        version: true,
        contentHash: true,
        angleId: true,
        angle: { select: { key: true } },
      },
      orderBy: { id: "asc" },
    }),
    args.db.campaignMapping.findMany({
      where: { merchantId: args.merchantId, status: "ACTIVE" },
      select: { id: true, version: true, signature: true },
      orderBy: { id: "asc" },
    }),
    args.db.pilotSettings.findUnique({
      where: { merchantId: args.merchantId },
    }),
  ]);
  const unknownTrafficPolicy =
    pilotSettings?.unknownTrafficPolicy ?? "ORIGINAL";
  registration.eligibilityJson = JSON.stringify({
    productId: product.shopifyProductId,
    requiresAnalyticsConsent: true,
    unknownTrafficPolicy,
  });
  const requiresUniversal =
    controlPolicy === "UNIVERSAL" || treatmentPolicy === "UNIVERSAL";
  const requiresMatched =
    controlPolicy === "MATCHED" || treatmentPolicy === "MATCHED";
  if (
    requiresUniversal &&
    !contentVersions.some((experience) => experience.angle?.key === "universal")
  ) {
    throw new Error(
      "Approve a universal experience for this product before registering the pilot stage.",
    );
  }
  const matchedAngles = new Set(
    contentVersions
      .filter(
        (experience) =>
          experience.angle?.key && experience.angle.key !== "universal",
      )
      .map((experience) => experience.angle?.key),
  );
  if (
    requiresMatched &&
    (matchedAngles.size < 3 || mappingVersions.length < 1)
  ) {
    throw new Error(
      "Stage 2 requires three approved matched angles and at least one active campaign mapping.",
    );
  }

  const existing = await args.db.experiment.findFirst({
    where: {
      merchantId: args.merchantId,
      key,
      status: { in: ["ACTIVE", "DRAFT"] },
    },
    orderBy: { version: "desc" },
  });
  if (existing) {
    const unchanged =
      existing.productId === product.id &&
      existing.controlPercentage === args.controlPercentage &&
      existing.controlPolicy === controlPolicy &&
      existing.treatmentPolicy === treatmentPolicy;
    if (!unchanged) {
      throw new Error(
        "An active experiment with this ID already has a different frozen configuration.",
      );
    }
    const existingRegistration =
      await args.db.experimentRegistration.findUnique({
        where: { experimentId: existing.id },
      });
    if (existingRegistration) {
      const sameRegistration =
        existingRegistration.protocolVersion === registration.protocolVersion &&
        existingRegistration.revenueDefinition ===
          registration.revenueDefinition &&
        existingRegistration.minimumMeaningfulLift ===
          registration.minimumMeaningfulLift &&
        existingRegistration.alpha === registration.alpha &&
        existingRegistration.power === registration.power &&
        existingRegistration.targetSampleSize ===
          registration.targetSampleSize &&
        existingRegistration.minimumDurationDays ===
          registration.minimumDurationDays &&
        existingRegistration.maximumDurationDays ===
          registration.maximumDurationDays &&
        existingRegistration.dataMaturityLagDays ===
          registration.dataMaturityLagDays;
      if (!sameRegistration) {
        throw new Error(
          "This experiment ID already has a different frozen analysis plan. Create a new experiment version.",
        );
      }
    }
    if (!existingRegistration) {
      const registrationHash = createHash("sha256")
        .update(
          JSON.stringify({
            experimentId: existing.id,
            ...registration,
            contentVersions,
            mappingVersions,
          }),
        )
        .digest("hex");
      await args.db.experimentRegistration.create({
        data: {
          experimentId: existing.id,
          ...registration,
          contentVersionsJson: JSON.stringify(contentVersions),
          mappingVersionsJson: JSON.stringify(mappingVersions),
          registrationHash,
        },
      });
    }
    return existing;
  }
  const latest = await args.db.experiment.findFirst({
    where: { merchantId: args.merchantId, key },
    orderBy: { version: "desc" },
  });

  return args.db.experiment.create({
    data: {
      merchantId: args.merchantId,
      productId: product.id,
      key,
      version: (latest?.version ?? 0) + 1,
      salt: randomBytes(32).toString("hex"),
      saltVersion: 1,
      controlPercentage: args.controlPercentage,
      controlPolicy,
      treatmentPolicy,
      status: args.initialStatus ?? "ACTIVE",
      attributionWindowDays: 7,
      registration: {
        create: {
          ...registration,
          contentVersionsJson: JSON.stringify(contentVersions),
          mappingVersionsJson: JSON.stringify(mappingVersions),
          registrationHash: createHash("sha256")
            .update(
              JSON.stringify({
                merchantId: args.merchantId,
                productId: product.id,
                key,
                version: (latest?.version ?? 0) + 1,
                controlPercentage: args.controlPercentage,
                controlPolicy,
                treatmentPolicy,
                ...registration,
                contentVersions,
                mappingVersions,
              }),
            )
            .digest("hex"),
        },
      },
    },
  });
}

export async function resolveMeasuredExperiment(args: {
  db: PrismaClient;
  shop: string;
  productId: string | null | undefined;
  experimentKey: string | null | undefined;
  visitorId: string | null | undefined;
  sessionId: string | null | undefined;
  persistence: string | null | undefined;
  consentState: string | null | undefined;
  explicitAngle: string | null | undefined;
  utmSource: string | null | undefined;
  utmCampaign: string | null | undefined;
  utmContent: string | null | undefined;
}): Promise<MeasuredRuntimeResponse | StorefrontRuntimeResponse> {
  try {
    return await args.db.$transaction(async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { shop: args.shop }, select: { id: true } });
      if (!merchant) return originalRuntimeResponse("merchant_not_configured");
      await lockMerchantPrivacy(tx, merchant.id);
      const identities: PrivacyIdentity[] = [];
      if (validOpaqueId(args.visitorId)) identities.push({ kind: "VISITOR", value: args.visitorId });
      if (validOpaqueId(args.sessionId)) identities.push({ kind: "SESSION", value: args.sessionId });
      await assertIdentityNotSuppressed({ tx, shop: args.shop, identities });
      return resolveMeasuredExperimentInside({ ...args, db: tx });
    }, { timeout: 10_000 });
  } catch (error) {
    if (error instanceof PrivacyIdentitySuppressedError || error instanceof PrivacyOrderSuppressedError)
      return originalRuntimeResponse("privacy_scope_suppressed");
    throw error;
  }
}

async function resolveMeasuredExperimentInside(args: Omit<Parameters<typeof resolveMeasuredExperiment>[0], "db"> & {
  db: Prisma.TransactionClient;
}): Promise<MeasuredRuntimeResponse | StorefrontRuntimeResponse> {
  const startedAt = Date.now();
  const shopifyProductId = canonicalProductId(args.productId);
  if (!shopifyProductId) return originalRuntimeResponse("invalid_product");
  const merchant = await args.db.merchant.findUnique({
    where: { shop: args.shop },
  });
  if (!merchant) return originalRuntimeResponse("merchant_not_configured");
  const [runtimeControl, product] = await Promise.all([
    args.db.runtimeControl.findUnique({
      where: { merchantId: merchant.id },
    }),
    args.db.product.findUnique({
      where: {
        merchantId_shopifyProductId: {
          merchantId: merchant.id,
          shopifyProductId,
        },
      },
    }),
  ]);
  if (runtimeControl?.killSwitch) {
    return originalRuntimeResponse("merchant_kill_switch_active");
  }
  if (!product || product.status !== "ACTIVE") {
    return originalRuntimeResponse("product_not_eligible");
  }

  const experimentKey = String(args.experimentKey ?? "")
    .trim()
    .toLowerCase();
  const experiment = await args.db.experiment.findFirst({
    where: {
      merchantId: merchant.id,
      productId: product.id,
      key: experimentKey,
      status: "ACTIVE",
      privacyAffectedAt: null,
    },
    orderBy: { version: "desc" },
    include: { registration: true },
  });
  if (!experiment) return originalRuntimeResponse("experiment_not_registered");
  if (!experiment.registration)
    return originalRuntimeResponse("experiment_registration_missing");

  if (
    experiment.controlPolicy === "MATCHED" ||
    experiment.treatmentPolicy === "MATCHED"
  ) {
    const matched = await resolveMatchedAngle({
      db: args.db,
      merchantId: merchant.id,
      explicitAngle: args.explicitAngle,
      utmSource: args.utmSource,
      utmCampaign: args.utmCampaign,
      utmContent: args.utmContent,
    });
    if (!matched) {
      const settings = await args.db.pilotSettings.findUnique({
        where: { merchantId: merchant.id },
      });
      if (settings?.unknownTrafficPolicy !== "UNIVERSAL") {
        return originalRuntimeResponse(
          settings?.unknownTrafficPolicy === "EXCLUDE"
            ? "unknown_traffic_excluded"
            : "unknown_traffic_original",
        );
      }
    }
  }

  const persistence = args.persistence === "visitor" ? "visitor" : "session";
  const visitorId = validOpaqueId(args.visitorId) ? args.visitorId : null;
  const sessionId = validOpaqueId(args.sessionId) ? args.sessionId : null;
  const randomizationUnitId = persistence === "visitor" ? visitorId : sessionId;
  if (!randomizationUnitId || !sessionId) {
    return originalRuntimeResponse("randomization_unit_invalid");
  }
  const consentState = String(args.consentState ?? "unknown").slice(0, 64);
  const bucket = experimentBucket({
    merchantId: merchant.id,
    experimentId: experiment.id,
    randomizationUnitId,
    salt: experiment.salt,
  });
  const computedArm =
    bucket < experiment.controlPercentage * 100 ? "original" : "matched";
  const expiresAt = new Date(
    Date.now() + experiment.attributionWindowDays * 24 * 60 * 60 * 1000,
  );
  const assignmentKey = {
    experimentId_randomizationUnitId: {
      experimentId: experiment.id,
      randomizationUnitId,
    },
  };
  let assignment = await args.db.assignment.findUnique({
    where: assignmentKey,
  });
  if (!assignment) {
    try {
      assignment = await args.db.assignment.create({
        data: {
          merchantId: merchant.id,
          experimentId: experiment.id,
          randomizationUnitId,
          randomizationUnitType: persistence.toUpperCase(),
          arm: computedArm.toUpperCase(),
          bucket,
          saltVersion: experiment.saltVersion,
          consentState,
          expiresAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        assignment = await args.db.assignment.findUnique({
          where: assignmentKey,
        });
      } else {
        throw error;
      }
    }
  }
  if (!assignment) throw new Error("Assignment could not be resolved.");
  const assignmentArm = assignment.arm === "MATCHED" ? "matched" : "original";
  const executionPolicy = executionPolicyForArm(
    assignment.arm === "MATCHED" ? "MATCHED" : "ORIGINAL",
    experiment.controlPolicy as ExperimentPolicy,
    experiment.treatmentPolicy as ExperimentPolicy,
  );
  const decisionId = `dec_${randomUUID()}`;

  let runtime: StorefrontRuntimeResponse;
  if (executionPolicy === "ORIGINAL") {
    runtime = originalRuntimeResponse(`experiment_${assignmentArm}_original`);
  } else {
    runtime = await resolveStorefrontExperience({
      db: args.db,
      shop: args.shop,
      productId: shopifyProductId,
      policy: executionPolicy.toLowerCase(),
      explicitAngle: args.explicitAngle,
      utmSource: args.utmSource,
      utmCampaign: args.utmCampaign,
      utmContent: args.utmContent,
    });
  }

  if (runtime.experience) {
    let frozenContent: Array<{ id?: string; contentHash?: string }> = [];
    try {
      frozenContent = JSON.parse(
        experiment.registration.contentVersionsJson,
      ) as typeof frozenContent;
    } catch {
      /* fail closed below */
    }
    if (
      !frozenContent.some(
        (item) =>
          item.id === runtime.experience?.id &&
          item.contentHash === runtime.experience?.contentHash,
      )
    ) {
      runtime = originalRuntimeResponse("registered_content_drift");
    }
  }
  if (runtime.mappingVersion != null) {
    let frozenMappings: Array<{ id?: string; version?: number }> = [];
    try {
      frozenMappings = JSON.parse(
        experiment.registration.mappingVersionsJson,
      ) as typeof frozenMappings;
    } catch {
      /* fail closed below */
    }
    if (
      !runtime.mappingId ||
      !frozenMappings.some(
        (item) =>
          item.id === runtime.mappingId &&
          item.version === runtime.mappingVersion,
      )
    ) {
      runtime = originalRuntimeResponse("registered_mapping_drift");
    }
  }

  await args.db.decision.create({
    data: {
      id: decisionId,
      merchantId: merchant.id,
      experimentId: experiment.id,
      assignmentId: assignment.id,
      productId: product.id,
      experienceVersionId: runtime.experience?.id ?? null,
      sessionId,
      visitorId,
      arm: assignment.arm,
      policy: executionPolicy,
      acquisitionAngle: runtime.acquisitionAngle,
      mappingVersion: runtime.mappingVersion,
      bucket: assignment.bucket,
      reason: runtime.reason,
      consentState,
      occurredAt: new Date(),
    },
  });

  return {
    ...runtime,
    measurement: {
      decisionId,
      experimentId: experiment.key,
      experimentVersion: experiment.version,
      assignmentId: assignment.id,
      assignmentArm,
      bucket: assignment.bucket,
      persistence,
      consentState,
      serverProcessingMs: Math.max(0, Date.now() - startedAt),
    },
  };
}

function containsPiiKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPiiKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return (
        PII_KEYS.has(key.toLowerCase()) ||
        [
          "address1",
          "address2",
          "customerid",
          "emailaddress",
          "fullname",
          "postalcode",
          "zipcode",
        ].includes(normalizedKey) ||
        containsPiiKey(nested)
      );
    },
  );
}

export function sanitizedEventData(
  eventType: string,
  value: unknown,
): Record<string, unknown> | null {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowed =
    eventType === "adaptive_storefront_decision" ||
    eventType === "adaptive_storefront:decision"
      ? new Set([
          "arm",
          "assignmentArm",
          "bucket",
          "reason",
          "persistence",
          "experimentVersion",
          "decisionTimeMs",
          "serverProcessingMs",
        ])
      : eventType === "adaptive_storefront_render" ||
          eventType === "adaptive_storefront:render"
        ? new Set(["status", "errorCode"])
        : eventType === "adaptive_storefront_vitals"
          ? new Set(["lcpMs", "clsMilli", "inpMs"])
        : eventType === "checkout_started" || eventType === "checkout_completed"
          ? new Set(["amount", "currencyCode"])
          : new Set<string>();
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  for (const [key, value] of Object.entries(record)) {
    if (value == null) continue;
    if (["bucket", "experimentVersion", "decisionTimeMs", "serverProcessingMs", "amount", "lcpMs", "clsMilli", "inpMs"].includes(key)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
    } else if (typeof value !== "string" || !/^[A-Za-z0-9_:-]{1,64}$/.test(value)) return null;
    if (key === "currencyCode" && (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))) return null;
    if (key === "status" && !["rendered", "failed"].includes(String(value))) return null;
  }
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, nested]) =>
        nested == null ||
        typeof nested === "string" ||
        typeof nested === "number" ||
        typeof nested === "boolean",
    ),
  );
}

function optionalOpaque(value: unknown) {
  return validOpaqueId(value) ? value : null;
}

export type PixelIngestResult = {
  accepted: boolean;
  duplicate: boolean;
  reason?: string;
};

export async function ingestPixelEvent(args: {
  db: PrismaClient;
  payload: unknown;
  now?: Date;
  environment?: Record<string, string | undefined>;
}): Promise<PixelIngestResult> {
  if (
    !args.payload ||
    typeof args.payload !== "object" ||
    containsPiiKey(args.payload)
  ) {
    return {
      accepted: false,
      duplicate: false,
      reason: "invalid_or_pii_payload",
    };
  }
  const payload = args.payload as Record<string, unknown>;
  if (
    ![1, 2].includes(payload.schemaVersion as number) ||
    typeof payload.shop !== "string" ||
    !SHOP_PATTERN.test(payload.shop)
  ) {
    return { accepted: false, duplicate: false, reason: "invalid_envelope" };
  }
  if (
    !validOpaqueId(payload.eventId) ||
    typeof payload.eventType !== "string" ||
    !ALLOWED_EVENT_TYPES.has(payload.eventType)
  ) {
    return { accepted: false, duplicate: false, reason: "unsupported_event" };
  }
  const eventType = payload.eventType;
  const allowedEnvelope = new Set(["schemaVersion", "shop", "token", "eventId", "eventType", "occurredAt",
    "clientId", "consentState", "decisionId", "experimentId", "visitorId", "sessionId", "productId",
    "checkoutToken", "shopifyOrderId", "data"]);
  if (Object.keys(payload).some((key) => !allowedEnvelope.has(key)))
    return { accepted: false, duplicate: false, reason: "unsupported_envelope_field" };
  if (typeof payload.token !== "string" || payload.token.length > 256) {
    return {
      accepted: false,
      duplicate: false,
      reason: "authentication_failed",
    };
  }
  const merchant = await args.db.merchant.findUnique({
    where: { shop: payload.shop },
    include: { pixelCredential: true },
  });
  if (
    !merchant?.pixelCredential ||
    merchant.pixelCredential.status !== "ACTIVE" ||
    !pixelTokenMatches(payload.token, merchant.pixelCredential.tokenHash)
  ) {
    return {
      accepted: false,
      duplicate: false,
      reason: "authentication_failed",
    };
  }
  const occurredAt = new Date(String(payload.occurredAt ?? ""));
  if (Number.isNaN(occurredAt.getTime())) {
    return { accepted: false, duplicate: false, reason: "invalid_timestamp" };
  }
  const decisionId = optionalOpaque(payload.decisionId);
  const decision = decisionId
    ? await args.db.decision.findFirst({
        where: { id: decisionId, merchantId: merchant.id },
        include: { assignment: true, experiment: true, product: { select: { shopifyProductId: true } } },
      })
    : null;
  const consentState = String(payload.consentState ?? "unknown").slice(0, 64);
  const environment = args.environment ?? process.env;
  const isV2 = payload.schemaVersion === 2 || decision?.experiment?.lifecycleVersion === 2 || mvpV2EnabledForShop(merchant.shop, environment);
  if (consentState !== "analytics_and_preferences_allowed" && (isV2 || consentState !== "analytics_allowed"))
    return { accepted: false, duplicate: false, reason: "consent_not_allowed" };
  if (decisionId && !decision)
    return { accepted: false, duplicate: false, reason: "decision_authority_unavailable" };
  const claimedProduct = canonicalProductId(typeof payload.productId === "string" ? payload.productId : null);
  if (decision && isV2 && (
    (payload.experimentId != null && payload.experimentId !== decision.experimentId) ||
    (claimedProduct != null && claimedProduct !== decision.product.shopifyProductId) ||
    occurredAt < decision.occurredAt ||
    (decision.assignment && (occurredAt < decision.assignment.assignedAt || occurredAt >= decision.assignment.expiresAt))
  )) return { accepted: false, duplicate: false, reason: "decision_scope_or_window_invalid" };
  const eventData = sanitizedEventData(eventType, payload.data);
  if (!eventData)
    return {
      accepted: false,
      duplicate: false,
      reason: "unsupported_event_data",
    };

  const existing = await args.db.commerceEvent.findUnique({
    where: {
      merchantId_eventId: { merchantId: merchant.id, eventId: payload.eventId },
    },
  });
  if (existing) return { accepted: true, duplicate: true };
  const now = args.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || Math.abs(now.getTime() - occurredAt.getTime()) > 5 * 60_000)
    return { accepted: false, duplicate: false, reason: "event_outside_receipt_window" };
  const identitySecret = environment.ASSIGNMENT_SECRET?.trim() ?? "";
  if (isV2 && identitySecret.length < 32)
    return { accepted: false, duplicate: false, reason: "v2_configuration_unavailable" };
  const scopedId = (kind: string, value: unknown) => {
    const opaque = optionalOpaque(value);
    return opaque ? createHmac("sha256", identitySecret).update(`${merchant.id}\n${kind}\n${opaque}`).digest("hex") : null;
  };

  try {
    await args.db.$transaction(async (tx) => {
    const eventOrderId = canonicalOrderId(payload.shopifyOrderId);
    if (eventOrderId) await assertOrderNotSuppressed({ tx, merchantId: merchant.id, orderId: eventOrderId, environment });
    else await lockMerchantPrivacy(tx, merchant.id);
    const identities: PrivacyIdentity[] = [{ kind: "EVENT", value: payload.eventId as string }];
    const identityValues: Array<[PrivacyIdentity["kind"], string | null]> = [
      ["CLIENT", isV2 ? scopedId("pixel-client", payload.clientId) : optionalOpaque(payload.clientId)],
      ["VISITOR", isV2 ? decision?.visitorId ?? null : optionalOpaque(payload.visitorId)],
      ["SESSION", isV2 ? decision?.sessionId ?? scopedId("session", payload.sessionId) : optionalOpaque(payload.sessionId)],
      ["DECISION", optionalOpaque(payload.decisionId)], ["CHECKOUT", optionalOpaque(payload.checkoutToken)],
    ];
    for (const [kind, value] of identityValues) if (value) identities.push({ kind, value });
    await assertIdentityNotSuppressed({ tx, shop: merchant.shop, identities, environment });
    if (decision && !(await tx.decision.findFirst({ where: { id: decision.id, merchantId: merchant.id }, select: { id: true } })))
      throw new PrivacyOrderSuppressedError();
    await tx.commerceEvent.create({
      data: {
        merchantId: merchant.id,
        eventId: payload.eventId as string,
        source:
          eventType.startsWith("adaptive_storefront_") ||
          eventType.startsWith("adaptive_storefront:")
            ? "STOREFRONT_BRIDGE"
            : "SHOPIFY_PIXEL",
        eventType,
        occurredAt,
        receivedAt: now,
        clientId: isV2 ? scopedId("pixel-client", payload.clientId) : optionalOpaque(payload.clientId),
        visitorId: isV2 ? decision?.visitorId ?? null : optionalOpaque(payload.visitorId),
        sessionId: isV2 ? decision?.sessionId ?? scopedId("session", payload.sessionId) : optionalOpaque(payload.sessionId),
        decisionId: decision?.id ?? null,
        experimentKey:
          isV2 ? decision?.experimentId ?? null : typeof payload.experimentId === "string"
            ? payload.experimentId.slice(0, 64)
            : null,
        productId: (isV2 ? decision?.product.shopifyProductId : null) ?? canonicalProductId(
          typeof payload.productId === "string" ? payload.productId : null,
        ),
        checkoutToken: optionalOpaque(payload.checkoutToken),
        shopifyOrderId: canonicalOrderId(payload.shopifyOrderId),
        consentState,
        payloadJson: JSON.stringify(eventData),
      },
    });
    if ((eventType === "adaptive_storefront_render" || eventType === "adaptive_storefront:render") && decision) {
      await tx.decision.updateMany({ where: { id: decision.id, merchantId: merchant.id }, data: { reason: decision.reason } });
      const previousRender = await tx.renderEvent.findFirst({ where: { decisionId: decision.id, merchantId: merchant.id } });
      const status = eventData.status === "rendered" ? "RENDERED" : "FAILED";
      if (previousRender && previousRender.status !== status) throw new Error("CONTRADICTORY_FINAL_RENDER");
      if (!previousRender) await tx.renderEvent.create({ data: {
        merchantId: merchant.id, eventId: payload.eventId as string, decisionId: decision.id,
        status, errorCode: typeof eventData.errorCode === "string" ? eventData.errorCode.slice(0, 64) : null,
        occurredAt, receivedAt: now,
      } });
    }
    });
  } catch (error) {
    if (error instanceof PrivacyOrderSuppressedError || error instanceof PrivacyIdentitySuppressedError)
      return { accepted: false, duplicate: false, reason: "privacy_scope_suppressed" };
    if (error instanceof Error && error.message === "CONTRADICTORY_FINAL_RENDER")
      return { accepted: false, duplicate: false, reason: "contradictory_final_render" };
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { accepted: true, duplicate: true };
    }
    throw error;
  }

  return { accepted: true, duplicate: false };
}

export async function activateWebPixel(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  endpoint: string;
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
  assertActive?: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<void>;
}) {
  await args.assertActive?.(args.db);
  const token = randomBytes(32).toString("base64url");
  const settings = JSON.stringify({
    endpoint: args.endpoint,
    shop: args.shop,
    token,
  });
  // Shopify deletes the Web Pixel when an app is uninstalled. A persisted ID
  // is therefore only historical metadata after reinstall; always resolve the
  // current canonical pixel before deciding whether to update or create.
  await args.assertActive?.(args.db);
  type CurrentPixelJson = {
    data?: { webPixel?: { id: string } | null };
    errors?: Array<{
      message?: string;
      path?: unknown[];
      extensions?: { code?: string };
    }>;
  };
  const canonicalNotFoundError = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const body = (value as { body?: unknown }).body;
    if (!body || typeof body !== "object") return null;
    const typedBody = body as {
      data?: { webPixel?: unknown };
      errors?: { graphQLErrors?: CurrentPixelJson["errors"] };
    };
    const graphQLErrors = typedBody.errors?.graphQLErrors;
    const error = graphQLErrors?.[0];
    return typedBody.data?.webPixel === null &&
      graphQLErrors?.length === 1 &&
      error?.extensions?.code === "RESOURCE_NOT_FOUND" &&
      error.path?.length === 1 &&
      error.path[0] === "webPixel"
      ? { data: { webPixel: null }, errors: graphQLErrors }
      : null;
  };
  let currentJson: CurrentPixelJson;
  try {
    const currentResponse = await args.graphql(`#graphql
      query CurrentAdaptivePixel {
        webPixel {
          id
        }
      }`);
    currentJson = (await currentResponse.json()) as CurrentPixelJson;
  } catch (error) {
    const canonicalAbsent = canonicalNotFoundError(error);
    if (!canonicalAbsent) throw error;
    currentJson = canonicalAbsent;
  }
  await args.assertActive?.(args.db);
  const canonicalNotFound =
    currentJson.data?.webPixel === null &&
    currentJson.errors?.length === 1 &&
    currentJson.errors[0]?.extensions?.code === "RESOURCE_NOT_FOUND" &&
    currentJson.errors[0]?.path?.length === 1 &&
    currentJson.errors[0].path[0] === "webPixel";
  if (currentJson.errors?.length && !canonicalNotFound) {
    throw new Error(
      currentJson.errors[0]?.message ??
        "Shopify did not return the existing Web Pixel.",
    );
  }
  if (!currentJson.data || !Object.hasOwn(currentJson.data, "webPixel"))
    throw new Error("Shopify returned an invalid Web Pixel response.");
  const canonicalPixel = currentJson.data.webPixel;
  if (
    canonicalPixel !== null &&
    (typeof canonicalPixel?.id !== "string" || !canonicalPixel.id.trim())
  )
    throw new Error("Shopify returned an invalid Web Pixel response.");
  const webPixelId = canonicalPixel?.id ?? null;
  const query = webPixelId
    ? `#graphql
      mutation UpdateAdaptivePixel($id: ID!, $webPixel: WebPixelInput!) {
        webPixelUpdate(id: $id, webPixel: $webPixel) {
          userErrors { field message code }
          webPixel { id settings }
        }
      }`
    : `#graphql
      mutation CreateAdaptivePixel($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors { field message code }
          webPixel { id settings }
        }
      }`;
  const variables: Record<string, unknown> = { webPixel: { settings } };
  if (webPixelId) variables.id = webPixelId;
  await args.assertActive?.(args.db);
  const response = await args.graphql(query, { variables });
  const json = (await response.json()) as {
    data?: {
      webPixelCreate?: {
        userErrors: Array<{ message: string }>;
        webPixel: { id: string } | null;
      };
      webPixelUpdate?: {
        userErrors: Array<{ message: string }>;
        webPixel: { id: string } | null;
      };
    };
  };
  const result = json.data?.webPixelCreate ?? json.data?.webPixelUpdate;
  if (!result || result.userErrors.length || !result.webPixel) {
    throw new Error(
      result?.userErrors[0]?.message ??
      "Shopify did not activate the Web Pixel.",
    );
  }
  const activatedWebPixelId = result.webPixel.id;
  const persistCredential = (db: PrismaClient | Prisma.TransactionClient) =>
    db.pixelCredential.upsert({
      where: { merchantId: args.merchantId },
      create: {
        merchantId: args.merchantId,
        webPixelId: activatedWebPixelId,
        tokenHash: hashPixelToken(token),
        endpoint: args.endpoint,
        status: "ACTIVE",
      },
      update: {
        webPixelId: activatedWebPixelId,
        tokenHash: hashPixelToken(token),
        endpoint: args.endpoint,
        status: "ACTIVE",
        activatedAt: new Date(),
      },
    });
  if (!args.assertActive) return persistCredential(args.db);
  return args.db.$transaction(async (tx) => {
    await args.assertActive!(tx);
    return persistCredential(tx);
  });
}

export async function reconcileOrderAttribution(args: {
  db: PrismaClient | Prisma.TransactionClient;
  merchantId: string;
  orderId: string;
  decisionId: string | null;
}) {
  if (!args.decisionId) return null;
  const decision = await args.db.decision.findFirst({
    where: { id: args.decisionId, merchantId: args.merchantId },
    include: { assignment: true, experiment: true },
  });
  if (!decision?.assignment || !decision.experiment) return null;
  return args.db.orderAttribution.upsert({
    where: { orderId: args.orderId },
    create: {
      merchantId: args.merchantId,
      orderId: args.orderId,
      experimentId: decision.experiment.id,
      assignmentId: decision.assignment.id,
      decisionId: decision.id,
      joinMethod: "LINE_ITEM_PROPERTY",
    },
    update: {},
  });
}

function money(value: unknown) {
  try {
    const parsed = new Prisma.Decimal(String(value ?? "0"));
    return parsed.isFinite() && !parsed.isNegative()
      ? parsed
      : new Prisma.Decimal(0);
  } catch {
    return new Prisma.Decimal(0);
  }
}

function isoDate(value: unknown, fallback = new Date()) {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function decisionFromLineItems(payload: Record<string, unknown>) {
  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  for (const lineItem of lineItems) {
    if (!lineItem || typeof lineItem !== "object") continue;
    const properties = Array.isArray(
      (lineItem as Record<string, unknown>).properties,
    )
      ? ((lineItem as Record<string, unknown>).properties as unknown[])
      : [];
    for (const property of properties) {
      if (!property || typeof property !== "object") continue;
      const item = property as Record<string, unknown>;
      if (item.name === "_adaptive_decision" && validOpaqueId(item.value))
        return item.value;
    }
  }
  return null;
}

export async function ingestOrderWebhook(args: {
  db: PrismaClient;
  shop: string;
  topic: string;
  webhookId: string;
  payload: Record<string, unknown>;
}) {
  try {
    return await args.db.$transaction(async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { shop: args.shop }, select: { id: true } });
      if (!merchant) return null;
      const orderId = canonicalOrderId(args.topic === "REFUNDS_CREATE" ? args.payload.order_id :
        args.payload.admin_graphql_api_id ?? args.payload.id);
      if (!orderId) return null;
      await assertOrderNotSuppressed({ tx, merchantId: merchant.id, orderId });
      return ingestOrderWebhookTransaction({ ...args, db: tx });
    });
  } catch (error) {
    if (error instanceof PrivacyOrderSuppressedError) return null;
    throw error;
  }
}

async function ingestOrderWebhookTransaction(args: {
  db: Prisma.TransactionClient;
  shop: string;
  topic: string;
  webhookId: string;
  payload: Record<string, unknown>;
}) {
  const merchant = await args.db.merchant.findUnique({
    where: { shop: args.shop },
  });
  if (!merchant) return null;

  if (args.topic === "REFUNDS_CREATE") {
    const shopifyOrderId = canonicalOrderId(args.payload.order_id);
    const shopifyRefundId = String(args.payload.id ?? "");
    if (!shopifyOrderId || !/^\d+$/.test(shopifyRefundId)) return null;
    const order = await args.db.storeOrder.findUnique({
      where: {
        merchantId_shopifyOrderId: { merchantId: merchant.id, shopifyOrderId },
      },
    });
    if (!order) return null;
    const transactions = Array.isArray(args.payload.transactions)
      ? args.payload.transactions
      : [];
    const amount = transactions.reduce<Prisma.Decimal>((total, transaction) => {
      if (!transaction || typeof transaction !== "object") return total;
      const item = transaction as Record<string, unknown>;
      return item.status === "success" || item.status === "SUCCESS"
        ? total.plus(money(item.amount))
        : total;
    }, new Prisma.Decimal(0));
    const currency = transactions.find(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).currency === "string",
    ) as Record<string, unknown> | undefined;
    {
      const transaction = args.db;
      await transaction.storeRefund.upsert({
        where: {
          merchantId_shopifyRefundId: {
            merchantId: merchant.id,
            shopifyRefundId: `gid://shopify/Refund/${shopifyRefundId}`,
          },
        },
        create: {
          merchantId: merchant.id,
          orderId: order.id,
          shopifyRefundId: `gid://shopify/Refund/${shopifyRefundId}`,
          amount,
          currencyCode: String(currency?.currency ?? order.currencyCode),
          occurredAt: isoDate(args.payload.created_at),
          payloadJson: JSON.stringify({
            webhookId: args.webhookId,
            transactionCount: transactions.length,
          }),
        },
        update: {},
      });
      const refunded = await transaction.storeRefund.aggregate({
        where: { orderId: order.id },
        _sum: { amount: true },
      });
      const totalRefunded = new Prisma.Decimal(refunded._sum.amount ?? 0);
      const netAmount = new Prisma.Decimal(order.grossAmount).minus(
        totalRefunded,
      );
      await transaction.storeOrder.update({
        where: { id: order.id },
        data: {
          netAmount: netAmount.isNegative() ? new Prisma.Decimal(0) : netAmount,
        },
      });
    }
    return order;
  }

  const shopifyOrderId = canonicalOrderId(
    args.payload.admin_graphql_api_id ?? args.payload.id,
  );
  if (!shopifyOrderId) return null;
  const grossAmount = money(
    args.payload.total_price ?? args.payload.current_total_price,
  );
  const netAmount = money(
    args.payload.current_total_price ?? args.payload.total_price,
  );
  const currencyCode = String(
    args.payload.currency ?? args.payload.presentment_currency ?? "UNKNOWN",
  ).slice(0, 8);
  const decisionId = decisionFromLineItems(args.payload);
  const existingOrder = await args.db.storeOrder.findUnique({
    where: {
      merchantId_shopifyOrderId: { merchantId: merchant.id, shopifyOrderId },
    },
  });
  const orderMetadata = mergeOrderMetadata(existingOrder?.payloadJson, {
    webhookId: args.webhookId,
    topic: args.topic,
    lineItemCount: Array.isArray(args.payload.line_items)
      ? args.payload.line_items.length
      : 0,
    test: args.payload.test === true,
    recovered: args.topic === "ORDERS_RECOVERED",
  });
  const order = await args.db.storeOrder.upsert({
    where: {
      merchantId_shopifyOrderId: { merchantId: merchant.id, shopifyOrderId },
    },
    create: {
      merchantId: merchant.id,
      shopifyOrderId,
      orderNumber:
        args.payload.order_number == null
          ? null
          : String(args.payload.order_number).slice(0, 64),
      currencyCode,
      grossAmount,
      netAmount,
      financialStatus:
        args.payload.financial_status == null
          ? null
          : String(args.payload.financial_status).slice(0, 64),
      cancelledAt: args.payload.cancelled_at
        ? isoDate(args.payload.cancelled_at)
        : null,
      occurredAt: isoDate(args.payload.created_at),
      payloadJson: orderMetadata,
    },
    update: {
      currencyCode,
      grossAmount,
      netAmount,
      financialStatus:
        args.payload.financial_status == null
          ? null
          : String(args.payload.financial_status).slice(0, 64),
      cancelledAt: args.payload.cancelled_at
        ? isoDate(args.payload.cancelled_at)
        : null,
      payloadJson: orderMetadata,
    },
  });
  await reconcileOrderAttribution({
    db: args.db,
    merchantId: merchant.id,
    orderId: order.id,
    decisionId,
  });
  return order;
}

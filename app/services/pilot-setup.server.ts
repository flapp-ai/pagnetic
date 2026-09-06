import type { PrismaClient } from "@prisma/client";

import { encryptField } from "./field-encryption.server";
import {
  adaptivePanelActivation,
  evaluateQualification,
  parseScopes,
  PILOT_QA_KEYS,
  scopeHealth,
} from "./pilot-setup";
import { publicBetaCapacity } from "./public-beta-capacity";
import { publicProductConfig } from "./public-config.server";
import { privacyLookupKeys } from "./privacy-lookup-keys.server";

function bounded(value: unknown, maximum: number) {
  return String(value ?? "")
    .trim()
    .slice(0, maximum);
}

export async function syncInstallationHealth(args: {
  db: PrismaClient;
  merchantId: string;
  sessionScope: string | null | undefined;
  apiVersion: string;
}) {
  const scopes = parseScopes(args.sessionScope);
  const health = scopeHealth(scopes);
  await args.db.merchant.update({
    where: { id: args.merchantId },
    data: {
      apiVersion: args.apiVersion,
      grantedScopesJson: JSON.stringify(scopes),
      lastScopeSyncAt: new Date(),
    },
  });
  return { scopes, ...health };
}

export async function savePilotSettings(args: {
  db: PrismaClient;
  merchantId: string;
  unknownTrafficPolicy: string;
  rawEventRetentionDays: number;
  aggregateRetentionDays: number;
  incidentContactName: string;
  incidentContactEmail: string;
  vertical: string;
  reviewProvider: string;
  actor: string;
}) {
  const unknownTrafficPolicy = bounded(
    args.unknownTrafficPolicy,
    16,
  ).toUpperCase();
  if (
    !new Set(["ORIGINAL", "UNIVERSAL", "EXCLUDE"]).has(unknownTrafficPolicy)
  ) {
    throw new Error("Select a valid unknown-traffic policy.");
  }
  if (
    !Number.isInteger(args.rawEventRetentionDays) ||
    args.rawEventRetentionDays < 30 ||
    args.rawEventRetentionDays > 365
  ) {
    throw new Error("Raw-event retention must be 30–365 days.");
  }
  if (
    !Number.isInteger(args.aggregateRetentionDays) ||
    args.aggregateRetentionDays < 365 ||
    args.aggregateRetentionDays > 2555
  ) {
    throw new Error("Aggregate retention must be 365–2555 days.");
  }
  const contact = {
    name: bounded(args.incidentContactName, 120),
    email: bounded(args.incidentContactEmail, 254).toLowerCase(),
  };
  if (!contact.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
    throw new Error("A valid incident contact name and email are required.");
  }
  return args.db.pilotSettings.upsert({
    where: { merchantId: args.merchantId },
    create: {
      merchantId: args.merchantId,
      unknownTrafficPolicy,
      rawEventRetentionDays: args.rawEventRetentionDays,
      aggregateRetentionDays: args.aggregateRetentionDays,
      incidentContactJson: encryptField(contact),
      vertical: bounded(args.vertical, 120) || null,
      reviewProvider: bounded(args.reviewProvider, 120) || null,
      updatedBy: args.actor,
    },
    update: {
      unknownTrafficPolicy,
      rawEventRetentionDays: args.rawEventRetentionDays,
      aggregateRetentionDays: args.aggregateRetentionDays,
      incidentContactJson: encryptField(contact),
      vertical: bounded(args.vertical, 120) || null,
      reviewProvider: bounded(args.reviewProvider, 120) || null,
      updatedBy: args.actor,
    },
  });
}

export async function qualifyProduct(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  windowStart: Date;
  windowEnd: Date;
  eligibleSessions: number;
  orders: number;
  revenueAmount: number;
  currencyCode: string;
  eventCoverage: number;
  targetSampleSize: number;
  minimumDurationDays: number;
  maximumDurationDays: number;
  actor: string;
}) {
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
  });
  if (!product) throw new Error("Select a valid synced product.");
  const result = evaluateQualification(args);
  // SQLite/PostgreSQL numeric columns cannot portably persist Infinity. Keep the
  // human-readable reason in the assumptions while storing a finite sentinel.
  const persistedExpectedDurationDays = Number.isFinite(
    result.expectedDurationDays,
  )
    ? result.expectedDurationDays
    : 1_000_000;
  const qualification = await args.db.productQualification.upsert({
    where: { productId: product.id },
    create: {
      merchantId: args.merchantId,
      productId: product.id,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      eligibleSessions: args.eligibleSessions,
      orders: args.orders,
      revenueAmount: args.revenueAmount,
      currencyCode: args.currencyCode,
      eventCoverage: args.eventCoverage,
      weeklyEligibleSessions: result.weeklyEligibleSessions,
      targetSampleSize: args.targetSampleSize,
      expectedDurationDays: persistedExpectedDurationDays,
      status: result.status,
      assumptionsJson: JSON.stringify({
        minimumDurationDays: args.minimumDurationDays,
        maximumDurationDays: args.maximumDurationDays,
        conversionRate: result.conversionRate,
        revenuePerSession: result.revenuePerSession,
        reasons: result.reasons,
      }),
    },
    update: {
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      eligibleSessions: args.eligibleSessions,
      orders: args.orders,
      revenueAmount: args.revenueAmount,
      currencyCode: args.currencyCode,
      eventCoverage: args.eventCoverage,
      weeklyEligibleSessions: result.weeklyEligibleSessions,
      targetSampleSize: args.targetSampleSize,
      expectedDurationDays: persistedExpectedDurationDays,
      status: result.status,
      assumptionsJson: JSON.stringify({
        minimumDurationDays: args.minimumDurationDays,
        maximumDurationDays: args.maximumDurationDays,
        conversionRate: result.conversionRate,
        revenuePerSession: result.revenuePerSession,
        reasons: result.reasons,
      }),
      overrideReason: null,
      overriddenBy: null,
      overriddenAt: null,
      evaluatedAt: new Date(),
    },
  });
  await args.db.auditLog.create({
    data: {
      merchantId: args.merchantId,
      actor: args.actor,
      action: "PRODUCT_QUALIFIED",
      resourceType: "ProductQualification",
      resourceId: qualification.id,
      detailsJson: JSON.stringify({
        status: result.status,
        reasons: result.reasons,
      }),
    },
  });
  return { qualification, result };
}

export async function overrideQualification(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  reason: string;
  actor: string;
}) {
  const reason = bounded(args.reason, 500);
  if (reason.length < 20)
    throw new Error(
      "Provide a specific override rationale of at least 20 characters.",
    );
  const qualification = await args.db.productQualification.findFirst({
    where: { productId: args.productId, merchantId: args.merchantId },
  });
  if (!qualification || qualification.status === "READY")
    throw new Error(
      "Only a Limited or Not eligible qualification can be overridden.",
    );
  const updated = await args.db.productQualification.update({
    where: { id: qualification.id },
    data: {
      overrideReason: reason,
      overriddenBy: args.actor,
      overriddenAt: new Date(),
    },
  });
  await args.db.auditLog.create({
    data: {
      merchantId: args.merchantId,
      actor: args.actor,
      action: "PRODUCT_QUALIFICATION_OVERRIDDEN",
      resourceType: "ProductQualification",
      resourceId: updated.id,
      detailsJson: JSON.stringify({ reason }),
    },
  });
  return updated;
}

export async function recordThemeActivation(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  extensions: unknown;
  actor: string;
}) {
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
  });
  if (!product)
    throw new Error("Select a valid product before checking the theme.");
  const activation = adaptivePanelActivation(args.extensions);
  const saved = await args.db.themeActivation.upsert({
    where: { productId: product.id },
    create: {
      merchantId: args.merchantId,
      productId: product.id,
      themeId: activation.themeId,
      extensionStatus: activation.status,
      activationTarget: activation.target,
      activeOnPublishedTheme: activation.active,
      detectedAt: new Date(),
    },
    update: {
      themeId: activation.themeId,
      extensionStatus: activation.status,
      activationTarget: activation.target,
      activeOnPublishedTheme: activation.active,
      detectedAt: new Date(),
    },
  });
  await args.db.auditLog.create({
    data: {
      merchantId: args.merchantId,
      actor: args.actor,
      action: "PUBLISHED_THEME_CHECKED",
      resourceType: "ThemeActivation",
      resourceId: saved.id,
      detailsJson: JSON.stringify(activation),
    },
  });
  return saved;
}

export async function savePilotQa(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  passedKeys: string[];
  evidence: string;
  actor: string;
}) {
  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId },
  });
  if (!product) throw new Error("Select a valid product.");
  const passed = new Set(args.passedKeys);
  const now = new Date();
  await args.db.$transaction(
    PILOT_QA_KEYS.map((key) =>
      args.db.pilotQaCheck.upsert({
        where: { productId_key: { productId: product.id, key } },
        create: {
          merchantId: args.merchantId,
          productId: product.id,
          key,
          status: passed.has(key) ? "PASSED" : "PENDING",
          evidence: bounded(args.evidence, 500) || null,
          checkedBy: passed.has(key) ? args.actor : null,
          checkedAt: passed.has(key) ? now : null,
        },
        update: {
          status: passed.has(key) ? "PASSED" : "PENDING",
          evidence: bounded(args.evidence, 500) || null,
          checkedBy: passed.has(key) ? args.actor : null,
          checkedAt: passed.has(key) ? now : null,
        },
      }),
    ),
  );
  return args.db.pilotQaCheck.findMany({
    where: { productId: product.id },
    orderBy: { key: "asc" },
  });
}

export function productionEnvironmentStatus(environment = process.env) {
  const appUrl = environment.SHOPIFY_APP_URL ?? "";
  let stableAppUrl = false;
  try {
    const url = new URL(appUrl);
    stableAppUrl =
      url.protocol === "https:" &&
      !url.hostname.endsWith("trycloudflare.com") &&
      url.hostname !== "example.com";
  } catch {
    stableAppUrl = false;
  }
  return {
    productionMode: environment.NODE_ENV === "production",
    shopifyCredentialsConfigured: Boolean(
      environment.SHOPIFY_API_KEY && environment.SHOPIFY_API_SECRET,
    ),
    stableAppUrl,
    assignmentSecretConfigured: Boolean(
      environment.ASSIGNMENT_SECRET &&
      environment.ASSIGNMENT_SECRET.length >= 32,
    ),
    automationConfigured: Boolean(
      environment.AUTOMATION_SECRET &&
      environment.AUTOMATION_SECRET.length >= 32,
    ),
    backupConfigured: Boolean(
      environment.BACKUP_DESTINATION?.startsWith("/data/") &&
      /^[A-Za-z0-9+/]{43}=$/.test(environment.BACKUP_ENCRYPTION_KEY ?? "") &&
      environment.BACKUP_ENCRYPTION_KEY !== environment.FIELD_ENCRYPTION_KEY &&
      environment.BACKUP_S3_BUCKET &&
      environment.BACKUP_S3_ACCESS_KEY_ID &&
      environment.BACKUP_S3_SECRET_ACCESS_KEY,
    ),
    alertDeliveryConfigured: Boolean(environment.ALERT_WEBHOOK_URL),
    encryptionConfigured: Boolean(
      environment.FIELD_ENCRYPTION_KEY &&
      environment.FIELD_ENCRYPTION_KEY.length >= 32,
    ),
    privacyLookupKeyConfigured: (() => {
      try { privacyLookupKeys({ ...environment, NODE_ENV: "production" }); return true; }
      catch { return false; }
    })(),
    durableDatabaseConfigured: Boolean(
      environment.DATABASE_URL &&
      !environment.DATABASE_URL.includes("dev.sqlite"),
    ),
    funnelPrivacySecretConfigured: Boolean(
      environment.FUNNEL_HASH_SECRET &&
      environment.FUNNEL_HASH_SECRET.length >= 32,
    ),
    publicBetaCapacityConfigured: publicBetaCapacity(environment).configured,
    singleWriterConfigured: environment.APP_INSTANCE_COUNT === "1",
    trustedProxyConfigured: environment.TRUST_PROXY_HEADERS === "true",
    publicIdentityConfigured: publicProductConfig(environment).complete,
  };
}

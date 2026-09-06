export const REQUIRED_SCOPES = [
  "read_customer_events",
  "read_orders",
  "read_products",
  "write_app_proxy",
  "write_pixels",
] as const;

export const PILOT_QA_KEYS = [
  "placement",
  "mobile",
  "desktop",
  "standard_checkout",
  "accelerated_checkout",
  "shop_pay",
  "consent_flows",
  "original_fallback",
  "performance",
] as const;

export type QualificationInput = {
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
};

export function parseScopes(value: string | null | undefined) {
  return [
    ...new Set(
      String(value ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function scopeHealth(scopes: string[]) {
  const present = new Set(scopes);
  const missing = REQUIRED_SCOPES.filter((scope) => !present.has(scope));
  return { ready: missing.length === 0, missing };
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function evaluateQualification(input: QualificationInput) {
  const windowDays =
    (input.windowEnd.getTime() - input.windowStart.getTime()) / 86_400_000;
  if (!Number.isFinite(windowDays) || windowDays < 7 || windowDays > 366) {
    throw new Error("Historical window must be between 7 and 366 days.");
  }
  if (!Number.isInteger(input.eligibleSessions) || input.eligibleSessions < 0)
    throw new Error("Eligible sessions must be a non-negative whole number.");
  if (
    !Number.isInteger(input.orders) ||
    input.orders < 0 ||
    input.orders > input.eligibleSessions
  )
    throw new Error(
      "Orders must be a valid whole number no greater than sessions.",
    );
  if (!finiteNonNegative(input.revenueAmount))
    throw new Error("Revenue must be a non-negative number.");
  if (!/^[A-Z]{3}$/.test(input.currencyCode))
    throw new Error("Currency must be a three-letter ISO code.");
  if (
    !Number.isFinite(input.eventCoverage) ||
    input.eventCoverage < 0 ||
    input.eventCoverage > 1
  )
    throw new Error("Event coverage must be between 0 and 100 percent.");
  if (!Number.isInteger(input.targetSampleSize) || input.targetSampleSize < 20)
    throw new Error("Target sample must be at least 20 sessions.");
  if (
    !Number.isInteger(input.minimumDurationDays) ||
    !Number.isInteger(input.maximumDurationDays) ||
    input.minimumDurationDays < 7 ||
    input.maximumDurationDays < input.minimumDurationDays
  ) {
    throw new Error("Experiment duration is invalid.");
  }

  const weeklyEligibleSessions = (input.eligibleSessions / windowDays) * 7;
  const expectedDurationDays =
    weeklyEligibleSessions > 0
      ? (input.targetSampleSize / weeklyEligibleSessions) * 7
      : Number.POSITIVE_INFINITY;
  const conversionRate = input.eligibleSessions
    ? input.orders / input.eligibleSessions
    : 0;
  const revenuePerSession = input.eligibleSessions
    ? input.revenueAmount / input.eligibleSessions
    : 0;
  const reasons: string[] = [];

  if (input.eventCoverage < 0.9)
    reasons.push(
      `Historical event coverage is ${(input.eventCoverage * 100).toFixed(1)}%; at least 90% is required for Ready.`,
    );
  if (input.orders < 10)
    reasons.push(
      `${input.orders} historical orders provide a weak revenue baseline; at least 10 are required for Ready.`,
    );
  if (expectedDurationDays > input.maximumDurationDays)
    reasons.push(
      `The registered sample is expected to take ${Number.isFinite(expectedDurationDays) ? expectedDurationDays.toFixed(1) : "an unbounded number of"} days, above the ${input.maximumDurationDays}-day maximum.`,
    );
  if (expectedDurationDays < input.minimumDurationDays)
    reasons.push(
      `The test must still run the ${input.minimumDurationDays}-day minimum even if the sample arrives earlier.`,
    );

  let status: "READY" | "LIMITED" | "NOT_ELIGIBLE";
  if (
    input.eventCoverage < 0.7 ||
    input.eligibleSessions < 50 ||
    !Number.isFinite(expectedDurationDays) ||
    expectedDurationDays > input.maximumDurationDays * 2
  ) {
    status = "NOT_ELIGIBLE";
  } else if (
    input.eventCoverage >= 0.9 &&
    input.orders >= 10 &&
    expectedDurationDays <= input.maximumDurationDays
  ) {
    status = "READY";
  } else {
    status = "LIMITED";
  }

  return {
    status,
    windowDays,
    weeklyEligibleSessions,
    expectedDurationDays,
    conversionRate,
    revenuePerSession,
    reasons,
  };
}

type ThemeExtension = {
  type?: string;
  activations?: Array<{
    handle?: string;
    status?: string;
    activations?: Array<{ target?: string; themeId?: string }>;
  }>;
};

export function adaptivePanelActivation(value: unknown) {
  const extensions = Array.isArray(value) ? (value as ThemeExtension[]) : [];
  for (const extension of extensions) {
    if (
      extension.type !== "theme_app_extension" ||
      !Array.isArray(extension.activations)
    )
      continue;
    const block = extension.activations.find(
      (item) => item.handle === "adaptive-panel",
    );
    if (!block) continue;
    const activation = block.activations?.[0];
    return {
      status: String(block.status ?? "unknown").toUpperCase(),
      active: block.status === "active" && Boolean(activation),
      themeId: activation?.themeId ?? null,
      target: activation?.target ?? null,
    };
  }
  return { status: "UNAVAILABLE", active: false, themeId: null, target: null };
}

export function themeEditorDeepLink(
  shop: string,
  apiKey: string,
  selectedProduct?: { handle: string; templateSuffix?: string | null },
) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
    throw new Error("Invalid Shopify shop domain.");
  if (!/^[a-f0-9]{16,64}$/i.test(apiKey))
    throw new Error("Invalid Shopify application key.");
  const url = new URL(`https://${shop}/admin/themes/current/editor`);
  const suffix = selectedProduct?.templateSuffix
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  url.searchParams.set("template", suffix ? `product.${suffix}` : "product");
  if (selectedProduct?.handle) {
    const handle = selectedProduct.handle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 255);
    if (handle) url.searchParams.set("previewPath", `/products/${handle}`);
  }
  url.searchParams.set("addAppBlockId", `${apiKey}/adaptive-panel`);
  url.searchParams.set("target", "mainSection");
  return url.toString();
}

export function assessPartnerReadiness(input: {
  scopesReady: boolean;
  brandProfileApproved: boolean;
  qualificationReady: boolean;
  themeActive: boolean;
  qaPassed: number;
  qaRequired?: number;
  incidentContactConfigured: boolean;
  pixelActive: boolean;
  stableAppUrl: boolean;
  productionSecretsConfigured: boolean;
  automationConfigured: boolean;
  backupConfigured: boolean;
  alertDeliveryConfigured: boolean;
  durableDatabaseConfigured: boolean;
}) {
  const checks = [
    { key: "scopes", label: "Shopify access", passed: input.scopesReady },
    {
      key: "brand",
      label: "Brand profile",
      passed: input.brandProfileApproved,
    },
    {
      key: "qualification",
      label: "Product qualification",
      passed: input.qualificationReady,
    },
    { key: "theme", label: "Published theme block", passed: input.themeActive },
    {
      key: "qa",
      label: "Pilot QA matrix",
      passed: input.qaPassed >= (input.qaRequired ?? PILOT_QA_KEYS.length),
    },
    {
      key: "contact",
      label: "Incident contact",
      passed: input.incidentContactConfigured,
    },
    { key: "pixel", label: "Measurement pixel", passed: input.pixelActive },
    {
      key: "hosting",
      label: "Stable HTTPS hosting",
      passed: input.stableAppUrl,
    },
    {
      key: "secrets",
      label: "Production secrets",
      passed: input.productionSecretsConfigured,
    },
    {
      key: "automation",
      label: "Scheduled operations",
      passed: input.automationConfigured,
    },
    {
      key: "backup",
      label: "Backup destination",
      passed: input.backupConfigured,
    },
    {
      key: "alerts",
      label: "Alert delivery",
      passed: input.alertDeliveryConfigured,
    },
    {
      key: "database",
      label: "Durable database",
      passed: input.durableDatabaseConfigured,
    },
  ];
  return { ready: checks.every((check) => check.passed), checks };
}

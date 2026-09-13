export const MVP_V2_PROTOCOL_VERSION = "pagnetic-effect-v2";
export const LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION = "autopilot-plan-v1";
export const LEGACY_AUTOPILOT_AA_PROTOCOL_VERSION = "autopilot-aa-v1";
export const LEGACY_AUTOPILOT_EFFECT_PROTOCOL_VERSION =
  "autopilot-stage1-v1";
export const MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION =
  "pagnetic-autopilot-plan-v2";
export const MVP_V2_PRIMARY_METRIC =
  "FOCAL_NET_REVENUE_PER_ASSIGNED_VISITOR_V2";

function enabled(value: string | undefined) {
  return value === "true";
}

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function mvpV2EnabledForShop(
  shop: string,
  environment: Record<string, string | undefined> = process.env,
) {
  if (!enabled(environment.PAGNETIC_V2_ENABLED)) return false;
  const normalized = shop.trim().toLowerCase();
  if (!SHOP_DOMAIN.test(normalized)) return false;
  return String(environment.PAGNETIC_V2_ENABLED_SHOPS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SHOP_DOMAIN.test(value))
    .slice(0, 20)
    .includes(normalized);
}

export function mvpV2Config(
  environment: Record<string, string | undefined> = process.env,
) {
  const v2Enabled = enabled(environment.PAGNETIC_V2_ENABLED);
  const shadowEnabled = enabled(environment.PAGNETIC_V2_SHADOW_ENABLED);
  return {
    protocolVersion: MVP_V2_PROTOCOL_VERSION,
    primaryMetric: MVP_V2_PRIMARY_METRIC,
    enabled: v2Enabled,
    shadowEnabled: !v2Enabled && shadowEnabled,
    billingEnabled: enabled(environment.SHOPIFY_BILLING_ENABLED),
    modelEnabled:
      enabled(environment.PAGNETIC_V2_MODEL_ENABLED) &&
      Boolean(environment.PAGNETIC_V2_MODEL_PROVIDER?.trim()),
    offerPublishable: enabled(environment.PAGNETIC_V2_OFFER_PUBLISHABLE),
  } as const;
}

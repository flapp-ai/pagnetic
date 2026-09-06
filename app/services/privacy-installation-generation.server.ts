import { createHmac } from "node:crypto";

export function privacyInstallationGenerationHash(secret: string, shop: string,
  merchant: { id: string; installedAt: Date }) {
  if (!secret || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
    !merchant.id || !(merchant.installedAt instanceof Date) || !Number.isFinite(merchant.installedAt.getTime()))
    throw new Error("PRIVACY_INSTALLATION_GENERATION_INVALID");
  return createHmac("sha256", secret).update("pagnetic-privacy-installation-generation-v1\0")
    .update(shop).update("\0").update(merchant.id).update("\0").update(merchant.installedAt.toISOString()).digest("hex");
}

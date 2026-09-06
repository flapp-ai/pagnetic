import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export function privacyLookupKeyId(secret: string) {
  return createHash("sha256").update("pagnetic-privacy-lookup-key-v1\0").update(secret).digest("hex");
}

export function privacyLookupKeys(environment: Record<string, string | undefined> = process.env) {
  const active = environment.PRIVACY_LOOKUP_KEY;
  if (!active) {
    if (environment.NODE_ENV === "production") throw new Error("PRIVACY_LOOKUP_KEY is required for privacy processing.");
    if (environment.PRIVACY_LOOKUP_PREVIOUS_KEYS || environment.PRIVACY_LEGACY_LOOKUP_KEY)
      throw new Error("PRIVACY_LOOKUP_KEY is required with historical keys.");
    const development = environment.SHOPIFY_API_SECRET || "development-privacy-secret";
    return { active: development, secrets: [development], legacy: development };
  }
  const validKey = (key: unknown): key is string =>
    typeof key === "string" && key.length >= 32 && key.length <= 512 && key.trim() === key;
  let previous: unknown = [];
  try { previous = JSON.parse(environment.PRIVACY_LOOKUP_PREVIOUS_KEYS || "[]"); }
  catch { throw new Error("PRIVACY_LOOKUP_KEYRING_INVALID"); }
  const legacy = environment.PRIVACY_LEGACY_LOOKUP_KEY || null;
  if (!validKey(active) || !Array.isArray(previous) || previous.length > 7 ||
    !previous.every(validKey) || (legacy !== null && !validKey(legacy)))
    throw new Error("PRIVACY_LOOKUP_KEYRING_INVALID");
  const secrets = [...new Set([active, ...previous, ...(legacy ? [legacy] : [])])];
  if (secrets.length > 8) throw new Error("PRIVACY_LOOKUP_KEYRING_INVALID");
  // The active durable lookup key must not change with an API credential.
  if (active === environment.SHOPIFY_API_SECRET || active === environment.FIELD_ENCRYPTION_KEY)
    throw new Error("PRIVACY_LOOKUP_KEY_MUST_BE_INDEPENDENT");
  return { active, secrets, legacy };
}

export function privacyRequestLookupSecret(
  request: { lookupKeyId: string | null },
  environment: Record<string, string | undefined> = process.env,
) {
  if (request.lookupKeyId === null) throw new Error("PRIVACY_LOOKUP_LEGACY_REINDEX_REQUIRED");
  const secret = privacyLookupKeys(environment).secrets.find((key) => privacyLookupKeyId(key) === request.lookupKeyId);
  if (!secret) throw new Error("PRIVACY_LOOKUP_KEY_HISTORY_MISSING");
  return secret;
}

// Check fingerprints retained by data before any protected write. Removing a
// historical key fails closed globally instead of making its tombstones invisible.
export async function assertPrivacyLookupKeyCoverage(
  tx: Prisma.TransactionClient,
  keys: ReturnType<typeof privacyLookupKeys>,
) {
  const [suppression, requests, identities] = await Promise.all([
    tx.privacyOrderSuppression.groupBy({ by: ["lookupKeyId"], orderBy: { lookupKeyId: "asc" }, take: 10 }),
    tx.privacyRequest.groupBy({ where: { scopeCiphertext: { not: null } },
      by: ["lookupKeyId"], orderBy: { lookupKeyId: "asc" }, take: 10 }),
    tx.privacyIdentitySuppression.groupBy({ by: ["lookupKeyId"], orderBy: { lookupKeyId: "asc" }, take: 10 }),
  ]);
  const known = new Set(keys.secrets.map(privacyLookupKeyId));
  for (const row of [...suppression, ...requests, ...identities]) {
    if (row.lookupKeyId === null) throw new Error("PRIVACY_LOOKUP_LEGACY_REINDEX_REQUIRED");
    if (!known.has(row.lookupKeyId))
      throw new Error("PRIVACY_LOOKUP_KEY_HISTORY_MISSING");
  }
}

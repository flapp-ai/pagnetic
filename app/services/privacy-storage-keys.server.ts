import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

export function privacyStorageKeyId(secret: string) {
  return createHash("sha256")
    .update("pagnetic-privacy-storage-key-v1\0")
    .update(secret)
    .digest("hex");
}

export function privacyStorageKeys(
  environment: Record<string, string | undefined> = process.env,
) {
  const active = environment.FIELD_ENCRYPTION_KEY;
  if (!active) throw new Error("PRIVACY_FIELD_ENCRYPTION_KEY_REQUIRED");
  const validKey = (key: unknown): key is string =>
    typeof key === "string" &&
    key.length >= 32 &&
    key.length <= 512 &&
    key.trim() === key;
  let previous: unknown;
  try {
    previous = JSON.parse(
      environment.PRIVACY_FIELD_ENCRYPTION_PREVIOUS_KEYS || "[]",
    );
  } catch {
    throw new Error("PRIVACY_STORAGE_KEYRING_INVALID");
  }
  if (
    !validKey(active) ||
    !Array.isArray(previous) ||
    previous.length > 7 ||
    !previous.every(validKey)
  )
    throw new Error("PRIVACY_STORAGE_KEYRING_INVALID");
  const secrets = [...new Set([active, ...previous])];
  if (secrets.length > 8) throw new Error("PRIVACY_STORAGE_KEYRING_INVALID");
  if (
    active === environment.SHOPIFY_API_SECRET ||
    active === environment.PRIVACY_LOOKUP_KEY
  )
    throw new Error("PRIVACY_STORAGE_KEY_MUST_BE_INDEPENDENT");
  return { active, secrets };
}

export function privacyRequestStorageSecret(
  request: { scopeKeyId: string | null },
  environment: Record<string, string | undefined> = process.env,
) {
  if (request.scopeKeyId === null)
    throw new Error("PRIVACY_STORAGE_LEGACY_ADOPTION_REQUIRED");
  const secret = privacyStorageKeys(environment).secrets.find(
    (candidate) => privacyStorageKeyId(candidate) === request.scopeKeyId,
  );
  if (!secret) throw new Error("PRIVACY_STORAGE_KEY_HISTORY_MISSING");
  return secret;
}

export async function assertPrivacyStorageKeyCoverage(
  tx: Prisma.TransactionClient,
  environment: Record<string, string | undefined> = process.env,
) {
  const keys = privacyStorageKeys(environment);
  const fingerprints = await tx.privacyRequest.groupBy({
    where: { scopeCiphertext: { not: null } },
    by: ["scopeKeyId"],
    orderBy: { scopeKeyId: "asc" },
    take: 10,
  });
  const known = new Set(keys.secrets.map(privacyStorageKeyId));
  for (const row of fingerprints) {
    if (row.scopeKeyId === null)
      throw new Error("PRIVACY_STORAGE_LEGACY_ADOPTION_REQUIRED");
    if (!known.has(row.scopeKeyId))
      throw new Error("PRIVACY_STORAGE_KEY_HISTORY_MISSING");
  }
  return keys;
}

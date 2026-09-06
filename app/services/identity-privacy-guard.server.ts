import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { privacyHash } from "./privacy.server";
import { assertPrivacyLookupKeyCoverage, privacyLookupKeyId, privacyLookupKeys } from "./privacy-lookup-keys.server";

export type PrivacyIdentityKind = "VISITOR" | "SESSION" | "CLIENT" | "DECISION" | "ASSIGNMENT" | "CHECKOUT" | "EVENT";
export type PrivacyIdentity = { kind: PrivacyIdentityKind; value: string };
const KINDS = new Set<PrivacyIdentityKind>(["VISITOR", "SESSION", "CLIENT", "DECISION", "ASSIGNMENT", "CHECKOUT", "EVENT"]);

export class PrivacyIdentitySuppressedError extends Error {
  constructor() { super("PRIVACY_IDENTITY_SUPPRESSED"); this.name = "PrivacyIdentitySuppressedError"; }
}

export function privacyIdentityHash(secret: string, identity: PrivacyIdentity) {
  if (!KINDS.has(identity.kind) || !identity.value || identity.value.length > 256)
    throw new Error("PRIVACY_IDENTITY_INVALID");
  return createHmac("sha256", secret).update("pagnetic-privacy-identity-v1\0")
    .update(identity.kind).update("\0").update(identity.value).digest("hex");
}

// Caller holds the common merchant runtime lock in this same transaction.
export async function assertIdentityNotSuppressed(args: {
  tx: Prisma.TransactionClient; shop: string; identities: PrivacyIdentity[];
  environment?: Record<string, string | undefined>; secret?: string;
}) {
  if (args.identities.length > 100) throw new Error("PRIVACY_IDENTITY_BATCH_INVALID");
  const keys = args.secret ? { active: args.secret, secrets: [args.secret], legacy: args.secret } : privacyLookupKeys(args.environment);
  await assertPrivacyLookupKeyCoverage(args.tx, keys);
  if (!args.identities.length) return;
  for (const key of keys.secrets) {
    const found = await args.tx.privacyIdentitySuppression.findFirst({ where: {
      shopHash: privacyHash(key, args.shop), OR: args.identities.map((identity) => ({
        kind: identity.kind, identityHash: privacyIdentityHash(key, identity),
      })),
    }, select: { id: true } });
    if (found) throw new PrivacyIdentitySuppressedError();
  }
}

// Caller must already own the exact encrypted request scope and lease. Raw
// identity values never leave this transaction in tombstones or diagnostics.
export async function stagePrivacyIdentitySuppression(tx: Prisma.TransactionClient, args: {
  shop: string; requestId: string; secret: string; identities: PrivacyIdentity[];
}) {
  if (args.identities.length > 100) throw new Error("PRIVACY_IDENTITY_BATCH_INVALID");
  const shopHash = privacyHash(args.secret, args.shop);
  const lookupKeyId = privacyLookupKeyId(args.secret);
  for (const identity of args.identities) {
    const identityHash = privacyIdentityHash(args.secret, identity);
    await tx.privacyIdentitySuppression.upsert({ where: { shopHash_kind_identityHash: {
      shopHash, kind: identity.kind, identityHash,
    } }, create: { shopHash, kind: identity.kind, identityHash, requestId: args.requestId, lookupKeyId },
      update: { lookupKeyId } });
  }
}

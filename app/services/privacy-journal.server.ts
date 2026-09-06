import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

const MAX_ROWS = 100_000;
const MAX_BYTES = 16 * 1024 * 1024;

export type PrivacyJournal = {
  version: 1;
  createdAt: string;
  orderSuppressions: Array<{ shopHash: string; orderHash: string; requestId: string; lookupKeyId: string | null }>;
  identitySuppressions: Array<{ shopHash: string; kind: string; identityHash: string; requestId: string; lookupKeyId: string }>;
};

export type PrivacyJournalRows = {
  orderSuppressions: Array<{ shopHash: string; orderHash: string; requestId: string; lookupKeyId?: string | null }>;
  identitySuppressions: Array<{ shopHash: string; kind: string; identityHash: string; requestId: string; lookupKeyId: string }>;
};

function keyBytes(key: Buffer) {
  if (key.length !== 32) throw new Error("PRIVACY_JOURNAL_KEY_INVALID");
  return key;
}

function validate(journal: unknown): PrivacyJournal {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) throw new Error("PRIVACY_JOURNAL_INVALID");
  const value = journal as Record<string, unknown>;
  if (value.version !== 1 || typeof value.createdAt !== "string" ||
    !Array.isArray(value.orderSuppressions) || !Array.isArray(value.identitySuppressions) ||
    value.orderSuppressions.length + value.identitySuppressions.length > MAX_ROWS)
    throw new Error("PRIVACY_JOURNAL_INVALID");
  const digest = (entry: unknown, identity: boolean) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("PRIVACY_JOURNAL_INVALID");
    const row = entry as Record<string, unknown>;
    const required = identity ? ["shopHash", "kind", "identityHash", "requestId", "lookupKeyId"] : ["shopHash", "orderHash", "requestId"];
    if (required.some((field) => typeof row[field] !== "string" || !row[field])) throw new Error("PRIVACY_JOURNAL_INVALID");
    if (typeof row.shopHash !== "string" || !/^[a-f0-9]{64}$/.test(row.shopHash) ||
      (identity ? typeof row.identityHash !== "string" || !/^[a-f0-9]{64}$/.test(row.identityHash) :
        typeof row.orderHash !== "string" || !/^[a-f0-9]{64}$/.test(row.orderHash)))
      throw new Error("PRIVACY_JOURNAL_INVALID");
    if (typeof row.requestId !== "string" || row.requestId.length > 200) throw new Error("PRIVACY_JOURNAL_INVALID");
    return row;
  };
  const orderSuppressions = value.orderSuppressions.map((row) => {
    const item = digest(row, false);
    return { shopHash: item.shopHash as string, orderHash: item.orderHash as string,
      requestId: item.requestId as string, lookupKeyId: typeof item.lookupKeyId === "string" ? item.lookupKeyId : null };
  });
  const identitySuppressions = value.identitySuppressions.map((row) => {
    const item = digest(row, true);
    return { shopHash: item.shopHash as string, kind: item.kind as string, identityHash: item.identityHash as string,
      requestId: item.requestId as string, lookupKeyId: item.lookupKeyId as string };
  });
  return { version: 1, createdAt: value.createdAt, orderSuppressions, identitySuppressions };
}

export async function buildPrivacyJournal(tx: Prisma.TransactionClient, now = new Date()) {
  const [orders, identities] = await Promise.all([
    tx.privacyOrderSuppression.findMany({ orderBy: { id: "asc" }, take: MAX_ROWS + 1,
      select: { shopHash: true, orderHash: true, requestId: true, lookupKeyId: true } }),
    tx.privacyIdentitySuppression.findMany({ orderBy: { id: "asc" }, take: MAX_ROWS + 1,
      select: { shopHash: true, kind: true, identityHash: true, requestId: true, lookupKeyId: true } }),
  ]);
  if (orders.length + identities.length > MAX_ROWS) throw new Error("PRIVACY_JOURNAL_TOO_LARGE");
  const journal = privacyJournalFromRows({ orderSuppressions: orders, identitySuppressions: identities }, now);
  return journal;
}

export function privacyJournalFromRows(rows: PrivacyJournalRows, now = new Date()) {
  const journal = validate({ version: 1, createdAt: now.toISOString(), orderSuppressions: rows.orderSuppressions, identitySuppressions: rows.identitySuppressions });
  if (Buffer.byteLength(JSON.stringify(journal), "utf8") > MAX_BYTES) throw new Error("PRIVACY_JOURNAL_TOO_LARGE");
  return journal;
}

export function encryptPrivacyJournal(journal: PrivacyJournal, key: Buffer) {
  const plaintext = Buffer.from(JSON.stringify(validate(journal)), "utf8");
  if (plaintext.length > MAX_BYTES) throw new Error("PRIVACY_JOURNAL_TOO_LARGE");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(JSON.stringify({ version: 1, algorithm: "aes-256-gcm", nonce: nonce.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("base64url"),
    sha256: createHash("sha256").update(ciphertext).digest("hex") }), "utf8");
}

export function decryptPrivacyJournal(input: Buffer, key: Buffer) {
  if (input.length > MAX_BYTES * 2) throw new Error("PRIVACY_JOURNAL_TOO_LARGE");
  try {
    const envelope = JSON.parse(input.toString("utf8")) as Record<string, unknown>;
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm" || typeof envelope.nonce !== "string" ||
      typeof envelope.tag !== "string" || typeof envelope.ciphertext !== "string" || typeof envelope.sha256 !== "string")
      throw new Error("PRIVACY_JOURNAL_INVALID");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
    if (createHash("sha256").update(ciphertext).digest("hex") !== envelope.sha256) throw new Error("PRIVACY_JOURNAL_TAMPERED");
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(envelope.nonce, "hex"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
    return validate(JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PRIVACY_JOURNAL_")) throw error;
    throw new Error("PRIVACY_JOURNAL_INVALID");
  }
}

// Restore reapplication is additive and idempotent. It restores replay
// suppression before any application writer can serve a restored database;
// active-data deletion must still be independently verified against the journal.
export async function reapplyPrivacyJournal(tx: Prisma.TransactionClient, journal: PrivacyJournal) {
  const verified = validate(journal);
  for (const row of verified.orderSuppressions) await tx.privacyOrderSuppression.upsert({
    where: { shopHash_orderHash: { shopHash: row.shopHash, orderHash: row.orderHash } },
    create: row, update: { requestId: row.requestId, lookupKeyId: row.lookupKeyId },
  });
  for (const row of verified.identitySuppressions) await tx.privacyIdentitySuppression.upsert({
    where: { shopHash_kind_identityHash: { shopHash: row.shopHash, kind: row.kind, identityHash: row.identityHash } },
    create: row, update: { requestId: row.requestId, lookupKeyId: row.lookupKeyId },
  });
  return { orderSuppressions: verified.orderSuppressions.length, identitySuppressions: verified.identitySuppressions.length,
    reapplicationVerified: true, activeErasureVerified: false };
}

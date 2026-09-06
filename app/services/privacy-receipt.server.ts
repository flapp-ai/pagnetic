import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { privacyOrderIds } from "./customer-privacy-scope.server";
import { privacyHash, processPrivacyWebhook } from "./privacy.server";
import { privacyLookupKeyId, privacyLookupKeys } from "./privacy-lookup-keys.server";
import { PRIVACY_RECEIPT_MAX_BYTES, PRIVACY_RECEIPT_NAME, type PrivacyReceiptStore, createPrivacyReceiptStore } from "./privacy-receipt-store.server";

const DOMAIN = "pagnetic-independent-privacy-receipt-v1";
export type PrivacyReceipt = {
  version: 2; shop: string; type: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT";
  orderIds: string[]; subjectHash: string | null; lookupKeyId: string;
  providerRequestId: string | null; receivedAt: string; semanticHash: string;
  installationHash: string | null; eventId: string;
};

export function validatePrivacyReceipt(input: unknown): PrivacyReceipt {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("PRIVACY_RECEIPT_INVALID");
  const r = input as PrivacyReceipt;
  if (r.version !== 2 || typeof r.shop !== "string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(r.shop) ||
    !["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"].includes(r.type) ||
    (r.subjectHash !== null && (typeof r.subjectHash !== "string" || !/^[a-f0-9]{64}$/.test(r.subjectHash))) ||
    typeof r.lookupKeyId !== "string" || !/^[a-f0-9]{64}$/.test(r.lookupKeyId) ||
    (r.providerRequestId !== null && (typeof r.providerRequestId !== "string" || !/^[1-9]\d{0,24}$/.test(r.providerRequestId))) ||
    typeof r.semanticHash !== "string" || !/^[a-f0-9]{64}$/.test(r.semanticHash) ||
    (r.installationHash !== null && (typeof r.installationHash !== "string" || !/^[a-f0-9]{64}$/.test(r.installationHash))) ||
    typeof r.eventId !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(r.eventId) ||
    typeof r.receivedAt !== "string" || !Number.isFinite(Date.parse(r.receivedAt)) ||
    !Array.isArray(r.orderIds) || JSON.stringify(privacyOrderIds(r.orderIds)) !== JSON.stringify(r.orderIds) ||
    (r.type === "SHOP_REDACT" && r.orderIds.length)) throw new Error("PRIVACY_RECEIPT_INVALID");
  // Drop unknown fields so plaintext webhook data can never enter the journal.
  return { version: 2, shop: r.shop, type: r.type, orderIds: r.orderIds, subjectHash: r.subjectHash,
    lookupKeyId: r.lookupKeyId, providerRequestId: r.providerRequestId, receivedAt: r.receivedAt,
    semanticHash: r.semanticHash, installationHash: r.installationHash, eventId: r.eventId };
}

function identity(r: PrivacyReceipt) {
  // lookupKeyId and subjectHash are intentionally excluded: retained-key retries
  // must resolve to the same semantic request after lookup-key rotation.
  return JSON.stringify([r.shop, r.type, r.orderIds, r.providerRequestId, r.semanticHash, r.installationHash,
    r.providerRequestId ? null : r.eventId]);
}

function derivedKey(key: Buffer) {
  if (key.length !== 32) throw new Error("PRIVACY_RECEIPT_KEY_INVALID");
  return createHmac("sha256", key).update(DOMAIN).digest();
}

export function privacyReceiptInstallationHash(key: Buffer, shop: string, merchant: { id: string; installedAt: Date }) {
  return createHmac("sha256", derivedKey(key)).update("installation\0")
    .update(`${shop}:${merchant.id}:${merchant.installedAt.toISOString()}`).digest("hex");
}

export function receiptName(receipt: PrivacyReceipt, key: Buffer) {
  const r = validatePrivacyReceipt(receipt);
  // Provider IDs identify a retry, but the encrypted readback still compares
  // semanticHash so a reused/conflicting provider ID cannot be authorized.
  const stable = JSON.stringify([r.shop, r.type, r.providerRequestId ?? r.eventId]);
  return `pagnetic-privacy-${createHmac("sha256", derivedKey(key)).update(stable).digest("hex")}.enc`;
}

export function encryptPrivacyReceipt(receipt: PrivacyReceipt, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(key), nonce);
  cipher.setAAD(Buffer.from(DOMAIN));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(validatePrivacyReceipt(receipt)), "utf8"), cipher.final()]);
  const result = Buffer.concat([Buffer.from("PPR1"), nonce, cipher.getAuthTag(), ciphertext]);
  if (result.length > PRIVACY_RECEIPT_MAX_BYTES) throw new Error("PRIVACY_RECEIPT_TOO_LARGE");
  return result;
}

export function decryptPrivacyReceipt(bytes: Buffer, key: Buffer): PrivacyReceipt {
  if (bytes.length < 33 || bytes.length > PRIVACY_RECEIPT_MAX_BYTES || bytes.subarray(0, 4).toString() !== "PPR1")
    throw new Error("PRIVACY_RECEIPT_INVALID");
  try {
    const decipher = createDecipheriv("aes-256-gcm", derivedKey(key), bytes.subarray(4, 16));
    decipher.setAAD(Buffer.from(DOMAIN));
    decipher.setAuthTag(bytes.subarray(16, 32));
    return validatePrivacyReceipt(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]).toString("utf8")));
  } catch { throw new Error("PRIVACY_RECEIPT_AUTHENTICATION_FAILED"); }
}

function eventIdentity(receipt: PrivacyReceipt) {
  return JSON.stringify([receipt.shop, receipt.type, receipt.providerRequestId ?? receipt.eventId]);
}

function isNotFound(error: unknown) {
  const value = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return value?.name === "NoSuchKey" || value?.Code === "NoSuchKey" || value?.$metadata?.httpStatusCode === 404;
}

export async function publishPrivacyReceipt(receipt: PrivacyReceipt, key: Buffer, store: PrivacyReceiptStore,
  keyHistory: Buffer[] = [key], variants: Array<{ key: Buffer; receipt: PrivacyReceipt }> = [{ key, receipt }]) {
  const name = receiptName(receipt, key);
  // Intake performs at most one authenticated GET per retained key. Full LIST
  // inventory is reserved for offline recovery, never on the webhook path.
  const history = [...new Map([key, ...keyHistory].map((candidate) => [candidate.toString("base64"), candidate])).values()];
  for (const candidateKey of history) {
    const candidateReceipt = variants.find((item) => item.key.equals(candidateKey))?.receipt ?? receipt;
    const candidateName = receiptName(candidateReceipt, candidateKey);
    let bytes: Buffer;
    try { bytes = await store.get(candidateName); }
    catch (error) { if (isNotFound(error)) continue; throw error; }
    const existing = decryptPrivacyReceipt(bytes, candidateKey);
    if (receiptName(existing, candidateKey) !== candidateName) throw new Error("PRIVACY_RECEIPT_READBACK_MISMATCH");
    if (eventIdentity(existing) !== eventIdentity(receipt) || existing.semanticHash !== candidateReceipt.semanticHash ||
      existing.orderIds.join("\0") !== receipt.orderIds.join("\0"))
      throw new Error("PRIVACY_RECEIPT_SCOPE_CONFLICT");
    return { name: candidateName, receipt: existing, key: candidateKey };
  }
  try { await store.putIfAbsent(name, encryptPrivacyReceipt(receipt, key)); }
  catch { /* Readback resolves a lost response after an accepted immutable PUT. */ }
  const stored = decryptPrivacyReceipt(await store.get(name), key);
  if (receiptName(stored, key) !== name || identity(stored) !== identity(receipt))
    throw new Error("PRIVACY_RECEIPT_READBACK_MISMATCH");
  return { name, receipt: stored, key };
}

export function receiptEncryptionKeys(environment: Record<string, string | undefined> = process.env) {
  const encoded = environment.BACKUP_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("PRIVACY_RECEIPT_KEY_INVALID");
  let previous: unknown = [];
  try { previous = JSON.parse(environment.BACKUP_ENCRYPTION_PREVIOUS_KEYS || "[]"); }
  catch { throw new Error("PRIVACY_RECEIPT_KEYRING_INVALID"); }
  if (!Array.isArray(previous) || previous.length > 7 || !previous.every((value) => typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value)))
    throw new Error("PRIVACY_RECEIPT_KEYRING_INVALID");
  const keys = [...new Set([encoded, ...previous])].map((value) => Buffer.from(value, "base64"));
  if (keys.some((value) => value.length !== 32)) throw new Error("PRIVACY_RECEIPT_KEY_INVALID");
  return keys;
}

export async function collectPrivacyReceiptInventory(store: PrivacyReceiptStore, keys: Buffer[]) {
  const MAX_RECEIPTS = 10_000;
  const MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024;
  const receipts: Array<{ name: string; receipt: PrivacyReceipt; key: Buffer; ciphertextSha256: string }> = [];
  let plaintextBytes = 0;
  const names = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    if (cursor && cursors.has(cursor)) throw new Error("PRIVACY_RECEIPT_CURSOR_INVALID");
    if (cursor) cursors.add(cursor);
    const page = await store.list(cursor);
    if (page.names.length > 500) throw new Error("PRIVACY_RECEIPT_INVENTORY_REVIEW_REQUIRED");
    for (const name of page.names) {
      if (!PRIVACY_RECEIPT_NAME.test(name) || names.has(name) || names.size >= 100_000)
        throw new Error("PRIVACY_RECEIPT_INVENTORY_REVIEW_REQUIRED");
      names.add(name);
      const bytes = await store.get(name);
      if (bytes.length > PRIVACY_RECEIPT_MAX_BYTES || receipts.length >= MAX_RECEIPTS)
        throw new Error("PRIVACY_RECEIPT_INVENTORY_REVIEW_REQUIRED");
      let receipt: PrivacyReceipt | undefined;
      for (const key of keys) {
        try {
          const candidate = decryptPrivacyReceipt(bytes, key);
          if (receiptName(candidate, key) === name) { receipt = candidate; break; }
        } catch { /* try the next retained encryption key */ }
      }
      if (!receipt) throw new Error("PRIVACY_RECEIPT_AUTHENTICATION_FAILED");
      const receiptKey = keys.find((key) => { try { return receiptName(receipt!, key) === name; } catch { return false; } });
      if (!receiptKey) throw new Error("PRIVACY_RECEIPT_AUTHENTICATION_FAILED");
      plaintextBytes += Buffer.byteLength(JSON.stringify(receipt), "utf8");
      if (plaintextBytes > MAX_PLAINTEXT_BYTES) throw new Error("PRIVACY_RECEIPT_INVENTORY_REVIEW_REQUIRED");
      receipts.push({ name, receipt, key: receiptKey, ciphertextSha256: createHash("sha256").update(bytes).digest("hex") });
    }
    if (page.next && cursors.has(page.next)) throw new Error("PRIVACY_RECEIPT_CURSOR_INVALID");
    cursor = page.next;
  } while (cursor);
  return { receipts, names: [...names].sort(), plaintextBytes };
}

export async function* readPrivacyReceipts(store: PrivacyReceiptStore, keys: Buffer[]) {
  if (!keys.length || keys.length > 8) throw new Error("PRIVACY_RECEIPT_KEY_INVALID");
  const inventory = await collectPrivacyReceiptInventory(store, keys);
  for (const item of inventory.receipts) yield item;
}

export async function processJournaledPrivacyWebhook(
  args: Parameters<typeof processPrivacyWebhook>[0],
  options: { key?: Buffer; store?: PrivacyReceiptStore } = {},
) {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY;
  const key = options.key ?? (encoded && /^[A-Za-z0-9+/]{43}=$/.test(encoded) ? Buffer.from(encoded, "base64") : Buffer.alloc(0));
  derivedKey(key); // Fail before database mutation when off-volume durability is unavailable.
  if (encoded && encoded === (args.scopeSecret ?? process.env.FIELD_ENCRYPTION_KEY))
    throw new Error("PRIVACY_RECEIPT_KEY_NOT_INDEPENDENT");
  const customer = args.payload.customer as Record<string, unknown> | undefined;
  const subject = customer?.id ?? args.payload.customer_id;
  const provider = (args.payload.data_request as Record<string, unknown> | undefined)?.id;
  if (typeof provider === "number" && !Number.isSafeInteger(provider)) throw new Error("PRIVACY_REQUEST_ID_INVALID");
  const orderIds = args.type === "SHOP_REDACT" ? [] : privacyOrderIds(args.payload[args.type === "CUSTOMERS_REDACT" ? "orders_to_redact" : "orders_requested"]);
  // The preflight above is deliberately pure. It rejects malformed scope and
  // provider IDs before an immutable receipt can authorize local work.
  const installation = args.type === "SHOP_REDACT"
    ? await args.db.merchant.findUnique({ where: { shop: args.shop }, select: { id: true, installedAt: true } })
    : null;
  if (args.type === "SHOP_REDACT" && installation) {
    const shopHashes = [...new Set([args.secret, ...privacyLookupKeys(process.env).secrets].map((secret) => privacyHash(secret, args.shop)))];
    const prior = await args.db.privacyRequest.findFirst({ where: { requestType: "SHOP_REDACT", shopHash: { in: shopHashes } }, select: { id: true } });
    if (prior) throw new Error("PRIVACY_SHOP_REDACT_GENERATION_REVIEW_REQUIRED");
  }
  const installMaterial = installation ? `${args.shop}:${installation.id}:${installation.installedAt.toISOString()}` : null;
  const semanticHash = createHmac("sha256", derivedKey(key)).update("semantic\0")
    .update(JSON.stringify([args.shop, args.type, orderIds, subject == null ? null : String(subject), installMaterial])).digest("hex");
  const eventId = args.eventId ?? args.webhookId;
  if (!eventId) throw new Error("PRIVACY_WEBHOOK_ID_REQUIRED");
  const receipt = validatePrivacyReceipt({ version: 2, shop: args.shop, type: args.type,
    orderIds, subjectHash: subject == null ? null : privacyHash(args.secret, subject), lookupKeyId: privacyLookupKeyId(args.secret),
    providerRequestId: provider == null ? null : String(provider), semanticHash,
    installationHash: installation ? privacyReceiptInstallationHash(key, args.shop, installation) : null,
    eventId, receivedAt: (args.now ?? new Date()).toISOString() });
  const store = options.store ?? createPrivacyReceiptStore();
  const keyHistory = encoded ? receiptEncryptionKeys(process.env) : [key];
  const variants = keyHistory.map((candidateKey) => {
    const candidateSemanticHash = createHmac("sha256", derivedKey(candidateKey)).update("semantic\0")
      .update(JSON.stringify([args.shop, args.type, orderIds, subject == null ? null : String(subject), installMaterial])).digest("hex");
    return { key: candidateKey, receipt: validatePrivacyReceipt({ ...receipt,
      semanticHash: candidateSemanticHash,
      installationHash: installation ? privacyReceiptInstallationHash(candidateKey, args.shop, installation) : null }) };
  });
  const published = await publishPrivacyReceipt(receipt, key, store, keyHistory, variants);
  if (args.type === "SHOP_REDACT") {
    const current = await args.db.merchant.findUnique({ where: { shop: args.shop }, select: { id: true, installedAt: true } });
    if (current && (!published.receipt.installationHash || privacyReceiptInstallationHash(published.key, args.shop, current) !== published.receipt.installationHash))
      throw new Error("PRIVACY_SHOP_REDACT_GENERATION_REVIEW_REQUIRED");
  }
  // A 204 is only possible after independent durability plus local intake.
  const retainedLookup = privacyLookupKeys(process.env).secrets.find((candidate) => privacyLookupKeyId(candidate) === published.receipt.lookupKeyId);
  if (!retainedLookup) throw new Error("PRIVACY_LOOKUP_KEY_HISTORY_MISSING");
  const local = await processPrivacyWebhook({ ...args, secret: retainedLookup,
    now: new Date(published.receipt.receivedAt), lookupSecrets: privacyLookupKeys(process.env).secrets });
  return { ...local, receipt: published.receipt };
}

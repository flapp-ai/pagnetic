import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1";

function normalizedKey(secret?: string) {
  const source =
    secret ??
    process.env.FIELD_ENCRYPTION_KEY ??
    process.env.SHOPIFY_API_SECRET;
  if (!source || source.length < 16) {
    throw new Error(
      "Configure FIELD_ENCRYPTION_KEY before saving protected pilot settings.",
    );
  }
  return createHash("sha256").update(source).digest();
}

export function encryptField(value: unknown, secret?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", normalizedKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptField<T>(
  value: string | null | undefined,
  secret?: string,
): T | null {
  if (!value) return null;
  // Read legacy development rows so existing stores can migrate when settings
  // are next saved. Newly written values are always authenticated ciphertext.
  if (!value.startsWith(`${PREFIX}:`)) {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      normalizedKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  } catch {
    return null;
  }
}

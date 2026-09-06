import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { backupS3Config } from "../../scripts/lib/backup-s3";

export const PRIVACY_RECEIPT_PREFIX = "pagnetic-privacy-";
export const PRIVACY_RECEIPT_NAME = /^pagnetic-privacy-[a-f0-9]{64}\.enc$/;
export const PRIVACY_RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

export interface PrivacyReceiptStore {
  putIfAbsent(name: string, bytes: Buffer): Promise<void>;
  get(name: string): Promise<Buffer>;
  list(cursor?: string): Promise<{ names: string[]; next?: string }>;
}

// Immutable objects in the existing approved backup destination. No delete or
// overwrite API: request durability is independent of database backup timing.
export function createPrivacyReceiptStore(environment: NodeJS.ProcessEnv = process.env): PrivacyReceiptStore {
  const config = backupS3Config(environment);
  const client = new S3Client({ endpoint: config.endpoint, region: config.region,
    credentials: config.credentials, forcePathStyle: true, maxAttempts: 2 });
  const prefix = `${config.prefix}/${PRIVACY_RECEIPT_PREFIX}`;
  const objectKey = (name: string) => {
    if (!PRIVACY_RECEIPT_NAME.test(name)) throw new Error("PRIVACY_RECEIPT_NAME_INVALID");
    return `${config.prefix}/${name}`;
  };
  return {
    async putIfAbsent(name, bytes) {
      if (bytes.length > PRIVACY_RECEIPT_MAX_BYTES) throw new Error("PRIVACY_RECEIPT_TOO_LARGE");
      try {
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: objectKey(name),
          Body: bytes, ContentLength: bytes.length, ContentType: "application/octet-stream", IfNoneMatch: "*" }),
        { abortSignal: AbortSignal.timeout(8_000) });
      } catch (error) {
        // A simultaneous identical receipt or an ambiguous accepted PUT must be
        // verified by the caller's authenticated GET, never assumed successful.
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
      }
    },
    async get(name) {
      const signal = AbortSignal.timeout(8_000);
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(name) }), { abortSignal: signal });
      if (!(response.Body instanceof Readable)) throw new Error("PRIVACY_RECEIPT_BODY_INVALID");
      const body = response.Body;
      const abort = () => body.destroy(new Error("PRIVACY_RECEIPT_READ_TIMEOUT"));
      signal.addEventListener("abort", abort, { once: true });
      try {
        if (signal.aborted) abort();
        if ((response.ContentLength ?? 0) > PRIVACY_RECEIPT_MAX_BYTES) throw new Error("PRIVACY_RECEIPT_TOO_LARGE");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of body) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > PRIVACY_RECEIPT_MAX_BYTES) throw new Error("PRIVACY_RECEIPT_TOO_LARGE");
          chunks.push(bytes);
        }
        return Buffer.concat(chunks);
      } finally { signal.removeEventListener("abort", abort); body.destroy(); }
    },
    async list(cursor) {
      const page = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix,
        MaxKeys: 500, ContinuationToken: cursor }), { abortSignal: AbortSignal.timeout(8_000) });
      const names = (page.Contents ?? []).map((item) => {
        const name = item.Key?.slice(config.prefix.length + 1);
        if (!name || !PRIVACY_RECEIPT_NAME.test(name)) throw new Error("PRIVACY_RECEIPT_LIST_INVALID");
        return name;
      });
      if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === cursor))
        throw new Error("PRIVACY_RECEIPT_CURSOR_INVALID");
      return { names, ...(page.IsTruncated ? { next: page.NextContinuationToken } : {}) };
    },
  };
}

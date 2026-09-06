import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { BackupStore } from "./sqlite-backup";

export function backupS3Config(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = new URL(
    env.BACKUP_S3_ENDPOINT || "https://s3.amazonaws.com",
  );
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new Error(
      "BACKUP_S3_ENDPOINT must be an HTTPS origin without credentials",
    );
  const bucket = env.BACKUP_S3_BUCKET || "";
  const prefix = env.BACKUP_S3_PREFIX || "pagnetic-backups";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error("Configure BACKUP_S3_BUCKET");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix))
    throw new Error("Invalid BACKUP_S3_PREFIX");
  if (!env.BACKUP_S3_ACCESS_KEY_ID || !env.BACKUP_S3_SECRET_ACCESS_KEY)
    throw new Error("Configure dedicated backup S3 credentials");
  return {
    endpoint: endpoint.origin,
    bucket,
    prefix,
    region: env.BACKUP_S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
    },
    destination: `${endpoint.origin}/${bucket}/${prefix}`,
  };
}

export function createBackupStore(
  env: NodeJS.ProcessEnv = process.env,
): BackupStore {
  const config = backupS3Config(env);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: config.credentials,
    forcePathStyle: true,
    maxAttempts: 3,
  });
  const objectKey = (key: string) => {
    if (!/^pagnetic-[a-f0-9-]{36}\.sqlite\.enc(?:\.privacy\.enc|\.json)?$/.test(key))
      throw new Error("Invalid backup object name");
    return `${config.prefix}/${key}`;
  };
  return {
    kind: "s3",
    destination: config.destination,
    async put(key, path) {
      const size = (await stat(path)).size;
      if (size > 5 * 1024 ** 3)
        throw new Error(
          "Backup exceeds single-upload limit; migrate storage or configure multipart support",
        );
      const body = createReadStream(path);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: objectKey(key),
            Body: body,
            ContentLength: size,
            ContentType: "application/octet-stream",
            IfNoneMatch: "*",
          }),
          { abortSignal: AbortSignal.timeout(120_000) },
        );
      } finally {
        body.destroy();
      }
    },
    async get(key, path) {
      const signal = AbortSignal.timeout(120_000);
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(key) }),
        { abortSignal: signal },
      );
      if (!(response.Body instanceof Readable))
        throw new Error("S3 download did not return a readable stream");
      await pipeline(
        response.Body,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
        { signal },
      );
    },
  };
}

import { lstat, mkdir, rmdir } from "node:fs/promises";

export const BACKUP_BUCKET_HARD_BYTES = 4_000_000_000;
export const BACKUP_OBJECT_HARD_BYTES = 64 * 1024 ** 2;
export const BACKUP_UPLOAD_LOCK_PATH = "/data/.pagnetic-backup-s3-upload.lock";
export const BACKUP_LIST_MAX_PAGES = 4;
export const BACKUP_LIST_TIMEOUT_MS = 10_000;

function lowerOnly(value: string | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!/^[1-9]\d*$/.test(value))
    throw new Error("BACKUP_BUDGET_CONFIGURATION_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum)
    throw new Error("BACKUP_BUDGET_CONFIGURATION_INVALID");
  return parsed;
}

export function backupUploadBudget(env: NodeJS.ProcessEnv) {
  return {
    bucketBytes: lowerOnly(
      env.BACKUP_BUCKET_MAX_BYTES,
      BACKUP_BUCKET_HARD_BYTES,
    ),
    objectBytes: lowerOnly(
      env.BACKUP_OBJECT_MAX_BYTES,
      BACKUP_OBJECT_HARD_BYTES,
    ),
  };
}

type BucketPage = {
  Contents?: Array<{ Size?: number }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

export async function assertBackupUploadBudget(args: {
  size: number;
  budget: ReturnType<typeof backupUploadBudget>;
  list: (token: string | undefined, signal: AbortSignal) => Promise<BucketPage>;
}) {
  if (
    !Number.isSafeInteger(args.size) ||
    args.size < 0 ||
    args.size > args.budget.objectBytes
  )
    throw new Error("BACKUP_OBJECT_BUDGET_EXCEEDED");
  const signal = AbortSignal.timeout(BACKUP_LIST_TIMEOUT_MS);
  let token: string | undefined;
  let retained = 0;
  const tokens = new Set<string>();
  for (let page = 0; page < BACKUP_LIST_MAX_PAGES; page++) {
    signal.throwIfAborted();
    const response = await args.list(token, signal);
    signal.throwIfAborted();
    for (const object of response.Contents ?? []) {
      if (!Number.isSafeInteger(object.Size) || object.Size! < 0)
        throw new Error("BACKUP_BUCKET_INVENTORY_INVALID");
      retained += object.Size!;
      if (
        !Number.isSafeInteger(retained) ||
        retained + args.size > args.budget.bucketBytes
      )
        throw new Error("BACKUP_BUCKET_BUDGET_EXCEEDED");
    }
    if (response.IsTruncated === false) {
      if (retained + args.size > args.budget.bucketBytes)
        throw new Error("BACKUP_BUCKET_BUDGET_EXCEEDED");
      return;
    }
    if (
      response.IsTruncated !== true ||
      !response.NextContinuationToken ||
      tokens.has(response.NextContinuationToken)
    )
      throw new Error("BACKUP_BUCKET_INVENTORY_INVALID");
    token = response.NextContinuationToken;
    tokens.add(token);
  }
  throw new Error("BACKUP_BUCKET_INVENTORY_PAGE_LIMIT");
}

/** Fail fast on overlap/crash remnants. Never infer that a stale lock is safe.
 * This coordinates this deployment's volume, not other machines or credentials.
 */
export async function withBackupUploadLock<T>(
  operation: () => Promise<T>,
  lockPath = BACKUP_UPLOAD_LOCK_PATH,
) {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    )
      throw new Error("BACKUP_UPLOAD_ALREADY_RUNNING_OR_STALE_LOCK");
    throw error;
  }
  const owned = await lstat(lockPath);
  const release = async () => {
    const current = await lstat(lockPath);
    if (
      !current.isDirectory() ||
      current.dev !== owned.dev ||
      current.ino !== owned.ino
    )
      throw new Error("BACKUP_UPLOAD_LOCK_OWNERSHIP_CHANGED");
    await rmdir(lockPath);
  };
  try {
    return await operation();
  } finally {
    await release();
  }
}

/** FIFO without transparent retries; a failed upload doesn't poison later puts. */
export function serializedBackupUploads() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>) => {
    const next = tail.then(operation);
    tail = next.catch(() => undefined);
    return next;
  };
}

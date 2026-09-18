type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function requestAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function consumeRateLimit(args: {
  key: string;
  limit: number;
  windowMilliseconds: number;
  now?: number;
}) {
  const now = args.now ?? Date.now();
  if (
    !args.key ||
    !Number.isSafeInteger(args.limit) ||
    args.limit < 1 ||
    !Number.isSafeInteger(args.windowMilliseconds) ||
    args.windowMilliseconds < 1 ||
    !Number.isFinite(now) ||
    !Number.isSafeInteger(now + args.windowMilliseconds)
  )
    throw new Error("INVALID_RATE_LIMIT_ARGUMENTS");
  if (!buckets.has(args.key) && buckets.size >= 10_000) {
    for (const [key, value] of buckets)
      if (value.resetAt <= now) buckets.delete(key);
    if (buckets.size >= 10_000)
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(args.windowMilliseconds / 1000),
        ),
      };
  }
  const existing = buckets.get(args.key);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + args.windowMilliseconds }
      : existing;
  bucket.count = Math.min(bucket.count + 1, Number.MAX_SAFE_INTEGER);
  buckets.set(args.key, bucket);
  if (buckets.size > 10_000) {
    for (const [key, value] of buckets)
      if (value.resetAt <= now) buckets.delete(key);
  }
  return {
    allowed: bucket.count <= args.limit,
    remaining: Math.max(0, args.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

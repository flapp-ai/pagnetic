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
  const existing = buckets.get(args.key);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + args.windowMilliseconds }
      : existing;
  bucket.count += 1;
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

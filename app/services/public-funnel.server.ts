import { createHmac, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

const COOKIE_NAME = "adaptive_preview_id";

function secret() {
  const value = process.env.FUNNEL_HASH_SECRET || process.env.ASSIGNMENT_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production")
    throw new Error("FUNNEL_HASH_SECRET is required in production.");
  return "development-preview-secret";
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) ?? null
  );
}

export function publicFunnelIdentity(request: Request) {
  const existing = cookieValue(request);
  const anonymousId =
    existing && /^[a-f0-9-]{36}$/i.test(existing) ? existing : randomUUID();
  const anonymousIdHash = createHmac("sha256", secret())
    .update(anonymousId)
    .digest("hex");
  const setCookie = existing
    ? null
    : `${COOKIE_NAME}=${anonymousId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  return { anonymousIdHash, setCookie };
}

export async function recordPublicFunnelEvent(args: {
  db: PrismaClient;
  requestId?: string;
  anonymousIdHash: string;
  eventType: "SCAN_SUCCEEDED" | "SCAN_FAILED" | "INSTALL_STARTED";
  productHostHash?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  return args.db.publicFunnelEvent.create({
    data: {
      requestId: args.requestId ?? randomUUID(),
      anonymousIdHash: args.anonymousIdHash,
      eventType: args.eventType,
      productHostHash: args.productHostHash ?? null,
      metadataJson: JSON.stringify(args.metadata ?? {}),
    },
  });
}

export function hashPublicHost(host: string) {
  return createHmac("sha256", secret())
    .update(host.toLowerCase())
    .digest("hex");
}

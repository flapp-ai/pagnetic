import { randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient, PrivacyRequest } from "@prisma/client";
import { decryptField } from "./field-encryption.server";
import { privacyOrderIds } from "./customer-privacy-scope.server";
import { privacyHash } from "./privacy.server";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 10;
const REQUEST_TYPES = ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"];

export function customerPrivacyRequestSummary(request: Pick<PrivacyRequest,
  "id" | "requestType" | "status" | "requestedAt" | "completedAt" | "dueAt">) {
  return { id: request.id, requestType: request.requestType, status: request.status,
    requestedAt: request.requestedAt.toISOString(), completedAt: request.completedAt?.toISOString() ?? null,
    dueAt: request.dueAt?.toISOString() ?? null };
}

export type CustomerPrivacyScope = {
  version: 1 | 2;
  shop: string;
  orderIds: string[];
  installationGenerationHash?: string | null;
};
export type CustomerPrivacyLease = { request: PrivacyRequest; token: string };

// This must not use decryptField's legacy plaintext compatibility path. A
// misconfigured/rotated key is review work, never evidence of an empty scope.
export function readCustomerPrivacyScope(args: {
  request: PrivacyRequest;
  scopeSecret: string;
  privacySecret: string;
}): CustomerPrivacyScope {
  if (
    args.scopeSecret.length < 32 ||
    !args.request.scopeCiphertext?.startsWith("enc:v1:")
  )
    throw new Error("PRIVACY_SCOPE_UNREADABLE");
  const decoded = decryptField<unknown>(
    args.request.scopeCiphertext,
    args.scopeSecret,
  );
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
    throw new Error("PRIVACY_SCOPE_INVALID");
  const scope = decoded as Record<string, unknown>;
  if (
    ![1, 2].includes(Number(scope.version)) ||
    typeof scope.shop !== "string" ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(scope.shop) ||
    !REQUEST_TYPES.includes(args.request.requestType)
  )
    throw new Error("PRIVACY_SCOPE_INVALID");
  const expectedHash = privacyHash(args.privacySecret, scope.shop);
  const actualHash = args.request.shopHash;
  if (
    !/^[a-f0-9]{64}$/.test(actualHash) ||
    !timingSafeEqual(
      Buffer.from(actualHash, "hex"),
      Buffer.from(expectedHash, "hex"),
    )
  )
    throw new Error("PRIVACY_SCOPE_TENANT_MISMATCH");
  const orderIds = privacyOrderIds(scope.orderIds);
  // Intake stores normalized sorted identifiers; reject noncanonical tampering
  // or an empty scope, rather than broadening it to every merchant order.
  if (
    !orderIds.length ||
    JSON.stringify(orderIds) !== JSON.stringify(scope.orderIds)
  )
    throw new Error("PRIVACY_SCOPE_INVALID");
  const installationGenerationHash = scope.version === 2
    ? scope.installationGenerationHash
    : null;
  if (installationGenerationHash !== null &&
    (typeof installationGenerationHash !== "string" || !/^[a-f0-9]{64}$/.test(installationGenerationHash)))
    throw new Error("PRIVACY_SCOPE_INVALID");
  return scope.version === 1
    ? { version: 1, shop: scope.shop, orderIds }
    : { version: 2, shop: scope.shop, orderIds,
      installationGenerationHash: installationGenerationHash as string | null };
}

export async function claimCustomerPrivacyRequest(args: {
  db: PrismaClient;
  now?: Date;
  requestTypes?: Array<"CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT">;
}) {
  const now = args.now ?? new Date();
  // Bounded candidates; the conditional write, not this read, grants authority.
  const candidates = await args.db.privacyRequest.findMany({
    where: {
      requestType: { in: (args.requestTypes ?? REQUEST_TYPES).filter((type) => REQUEST_TYPES.includes(type)) },
      completedAt: null,
      OR: [
        { status: "PENDING_ORDER_SCOPE", nextRunAt: { lte: now } },
        { status: "PROCESSING_ORDER_SCOPE", leaseUntil: { lte: now } },
      ],
    },
    orderBy: [{ dueAt: "asc" }, { requestedAt: "asc" }, { id: "asc" }],
    take: 20,
  });
  for (const request of candidates) {
    const where = {
      id: request.id,
      status: request.status,
      attempts: request.attempts,
      leaseToken: request.leaseToken,
      leaseUntil: request.leaseUntil,
      completedAt: null,
    };
    const expiredDeadline = !request.dueAt || request.dueAt <= now;
    if (expiredDeadline || request.attempts >= MAX_ATTEMPTS) {
      await args.db.privacyRequest.updateMany({
        where,
        data: {
          status: expiredDeadline
            ? "REVIEW_REQUIRED_DEADLINE"
            : "REVIEW_REQUIRED_RETRIES",
          nextRunAt: null,
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: expiredDeadline
            ? "PRIVACY_DEADLINE_REACHED"
            : "PRIVACY_RETRY_LIMIT",
        },
      });
      continue;
    }
    const token = randomUUID();
    const leaseUntil = new Date(
      Math.min(now.getTime() + LEASE_MS, request.dueAt!.getTime()),
    );
    const claimed = await args.db.privacyRequest.updateMany({
      where,
      data: {
        status: "PROCESSING_ORDER_SCOPE",
        leaseToken: token,
        leaseUntil,
        attempts: { increment: 1 },
        nextRunAt: null,
        lastErrorCode: null,
      },
    });
    if (claimed.count === 1)
      return {
        token,
        request: {
          ...request,
          status: "PROCESSING_ORDER_SCOPE",
          leaseToken: token,
          leaseUntil,
          attempts: request.attempts + 1,
          nextRunAt: null,
          lastErrorCode: null,
        },
      } satisfies CustomerPrivacyLease;
  }
  return null;
}

function authority(lease: CustomerPrivacyLease, now: Date) {
  return {
    id: lease.request.id,
    status: "PROCESSING_ORDER_SCOPE",
    leaseToken: lease.token,
    attempts: lease.request.attempts,
    leaseUntil: { gt: now },
    dueAt: { gt: now },
    completedAt: null,
  };
}

export async function renewCustomerPrivacyLease(args: {
  db: PrismaClient;
  lease: CustomerPrivacyLease;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const dueAt = args.lease.request.dueAt;
  if (!dueAt) return false;
  const result = await args.db.privacyRequest.updateMany({
    where: authority(args.lease, now),
    data: {
      leaseUntil: new Date(Math.min(now.getTime() + LEASE_MS, dueAt.getTime())),
    },
  });
  return result.count === 1;
}

export type PrivacyFailureCode =
  | "PRIVACY_SCOPE_UNREADABLE"
  | "PRIVACY_SCOPE_INVALID"
  | "PRIVACY_SCOPE_TENANT_MISMATCH"
  | "PRIVACY_STORAGE_UNAVAILABLE"
  | "PRIVACY_EXPORT_ORDER_TOO_LARGE"
  | "PRIVACY_EXPORT_CHUNK_TOO_LARGE"
  | "PRIVACY_EXPORT_PROGRESS_INVALID"
  | "PRIVACY_EXPORT_ARTIFACT_GAP_OR_EXPIRED"
  | "PRIVACY_ERASURE_REQUEST_TYPE_INVALID"
  | "PRIVACY_ERASURE_PROGRESS_INVALID"
  | "PRIVACY_ERASURE_GRAPH_INVALID"
  | "PRIVACY_ERASURE_MERCHANT_CHANGED"
  | "PRIVACY_ERASURE_LINK_REMAINS"
  | "PRIVACY_ERASURE_RECORD_REMAINS"
  | "PRIVACY_ERASURE_CURSOR_INVALID"
  | "PRIVACY_GRAPH_SHARED_ORDER_REVIEW"
  | "PRIVACY_GRAPH_TOO_LARGE"
  | "PRIVACY_FULFILLMENT_FAILED";

const SAFE_FAILURES = new Set<PrivacyFailureCode>([
  "PRIVACY_SCOPE_UNREADABLE",
  "PRIVACY_SCOPE_INVALID",
  "PRIVACY_SCOPE_TENANT_MISMATCH",
  "PRIVACY_STORAGE_UNAVAILABLE",
  "PRIVACY_EXPORT_ORDER_TOO_LARGE",
  "PRIVACY_EXPORT_CHUNK_TOO_LARGE",
  "PRIVACY_EXPORT_PROGRESS_INVALID",
  "PRIVACY_EXPORT_ARTIFACT_GAP_OR_EXPIRED",
  "PRIVACY_ERASURE_REQUEST_TYPE_INVALID",
  "PRIVACY_ERASURE_PROGRESS_INVALID",
  "PRIVACY_ERASURE_GRAPH_INVALID",
  "PRIVACY_ERASURE_MERCHANT_CHANGED",
  "PRIVACY_ERASURE_LINK_REMAINS",
  "PRIVACY_ERASURE_RECORD_REMAINS",
  "PRIVACY_ERASURE_CURSOR_INVALID",
  "PRIVACY_GRAPH_SHARED_ORDER_REVIEW",
  "PRIVACY_GRAPH_TOO_LARGE",
  "PRIVACY_FULFILLMENT_FAILED",
]);

export async function releaseCustomerPrivacyFailure(args: {
  db: PrismaClient;
  lease: CustomerPrivacyLease;
  code: PrivacyFailureCode;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const code = SAFE_FAILURES.has(args.code)
    ? args.code
    : "PRIVACY_FULFILLMENT_FAILED";
  const invalidScope = code.startsWith("PRIVACY_SCOPE_");
  const exportReview = code.startsWith("PRIVACY_EXPORT_");
  const erasureReview = code.startsWith("PRIVACY_ERASURE_") || code.startsWith("PRIVACY_GRAPH_");
  const exhausted = args.lease.request.attempts >= MAX_ATTEMPTS;
  const delayMs = Math.min(
    3_600_000,
    30_000 * 2 ** Math.min(args.lease.request.attempts - 1, 7),
  );
  const retryAt = new Date(now.getTime() + delayMs);
  const deadline =
    !args.lease.request.dueAt || retryAt >= args.lease.request.dueAt;
  const review = invalidScope || exportReview || erasureReview || exhausted || deadline;
  const result = await args.db.privacyRequest.updateMany({
    where: authority(args.lease, now),
    data: {
      status: invalidScope
        ? "REVIEW_REQUIRED_SCOPE"
        : exportReview
          ? "REVIEW_REQUIRED_EXPORT"
          : erasureReview
            ? "REVIEW_REQUIRED_ERASURE"
        : exhausted
          ? "REVIEW_REQUIRED_RETRIES"
          : deadline
            ? "REVIEW_REQUIRED_DEADLINE"
            : "PENDING_ORDER_SCOPE",
      nextRunAt: review ? null : retryAt,
      leaseToken: null,
      leaseUntil: null,
      lastErrorCode: code,
    },
  });
  return result.count === 1;
}

// Deliberately no generic "complete" operation: verified fulfillment and backup
// obligations must be implemented before a caller can finalize these requests.

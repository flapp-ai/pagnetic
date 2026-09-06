import type { PrismaClient } from "@prisma/client";
import { processCustomerPrivacyExportStep, purgeExpiredCustomerPrivacyArtifacts } from "./customer-privacy-artifact.server";
import { claimCustomerPrivacyRequest, releaseCustomerPrivacyFailure, type PrivacyFailureCode } from "./customer-privacy-queue.server";
import { assertPrivacyLookupKeyCoverage, privacyLookupKeys, privacyRequestLookupSecret } from "./privacy-lookup-keys.server";
import { assertPrivacyStorageKeyCoverage, privacyRequestStorageSecret } from "./privacy-storage-keys.server";
import { processCustomerPrivacyErasureStep } from "./customer-privacy-erasure.server";

// Separate from merchant automation and Shopify offline access. Uninstallation
// or a failed merchant recovery job cannot strand a privacy request.
export async function runCustomerPrivacyExportWorker(args: {
  db: PrismaClient; environment?: Record<string, string | undefined>;
}) {
  const environment = args.environment ?? process.env;
  const purged = await purgeExpiredCustomerPrivacyArtifacts({ db: args.db });
  const deadlineAt = new Date();
  const overdue = await args.db.privacyRequest.findMany({ where: {
    completedAt: null, dueAt: { lte: deadlineAt },
    requestType: { in: ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"] },
    status: { not: "REVIEW_REQUIRED_DEADLINE" },
  }, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 100, select: { id: true } });
  if (overdue.length) await args.db.privacyRequest.updateMany({ where: {
    id: { in: overdue.map((row) => row.id) }, completedAt: null, dueAt: { lte: deadlineAt },
  }, data: { status: "REVIEW_REQUIRED_DEADLINE", leaseToken: null, leaseUntil: null,
    nextRunAt: null, lastErrorCode: "PRIVACY_DEADLINE_REACHED" } });
  const queued = await args.db.privacyRequest.count({ where: {
    requestType: { in: ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"] }, completedAt: null,
    status: { in: ["PENDING_ORDER_SCOPE", "PROCESSING_ORDER_SCOPE"] },
  } });
  let processed = 0;
  let failures = 0;
  let readyForOwnerReview = 0;
  let configurationError = false;
  const retainedScopes = await args.db.privacyRequest.count({ where: { scopeCiphertext: { not: null } } });
  if (retainedScopes) {
    try {
      const keys = privacyLookupKeys(environment);
      await args.db.$transaction(async (tx) => {
        await assertPrivacyLookupKeyCoverage(tx, keys);
        await assertPrivacyStorageKeyCoverage(tx, environment);
      });
    } catch { configurationError = true; }
  }
  const startedAt = Date.now();
  if (queued && !configurationError) for (let index = 0; index < 20 && Date.now() - startedAt < 30_000; index++) {
    const lease = await claimCustomerPrivacyRequest({ db: args.db });
    if (!lease) break;
    try {
      if (lease.request.requestType === "CUSTOMERS_REDACT") {
        await processCustomerPrivacyErasureStep({ db: args.db, lease, environment });
      } else {
        const result = await processCustomerPrivacyExportStep({ db: args.db, lease,
          scopeSecret: privacyRequestStorageSecret(lease.request, environment),
          privacySecret: privacyRequestLookupSecret(lease.request, environment) });
        if (result.readyForDelivery) readyForOwnerReview++;
      }
      processed++;
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : "";
      // Never persist or return arbitrary errors, payloads, identifiers or secrets.
      const safeCodes = new Set<PrivacyFailureCode>([
        "PRIVACY_SCOPE_UNREADABLE", "PRIVACY_SCOPE_INVALID", "PRIVACY_SCOPE_TENANT_MISMATCH",
        "PRIVACY_EXPORT_ORDER_TOO_LARGE", "PRIVACY_EXPORT_CHUNK_TOO_LARGE", "PRIVACY_EXPORT_PROGRESS_INVALID",
        "PRIVACY_EXPORT_ARTIFACT_GAP_OR_EXPIRED", "PRIVACY_ERASURE_REQUEST_TYPE_INVALID",
        "PRIVACY_ERASURE_PROGRESS_INVALID", "PRIVACY_ERASURE_GRAPH_INVALID", "PRIVACY_ERASURE_MERCHANT_CHANGED",
        "PRIVACY_ERASURE_LINK_REMAINS", "PRIVACY_ERASURE_RECORD_REMAINS", "PRIVACY_ERASURE_CURSOR_INVALID",
        "PRIVACY_GRAPH_SHARED_ORDER_REVIEW", "PRIVACY_GRAPH_TOO_LARGE",
      ]);
      const code: PrivacyFailureCode = safeCodes.has(message as PrivacyFailureCode)
        ? message as PrivacyFailureCode : "PRIVACY_FULFILLMENT_FAILED";
      await releaseCustomerPrivacyFailure({ db: args.db, lease, code });
    }
  }
  const reviewRequired = await args.db.privacyRequest.count({ where: {
    completedAt: null, requestType: { in: ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"] },
    OR: [{ status: { startsWith: "REVIEW_REQUIRED_" } }, { status: "EXPORT_READY_OWNER_DELIVERY" },
      { requestType: "CUSTOMERS_REDACT" }],
  } });
  return { ok: !configurationError && failures === 0 && reviewRequired === 0,
    processed, failures, readyForOwnerReview, configurationError, purged,
    overdueEscalated: overdue.length, reviewRequired,
    erasureWorkerImplemented: true, deliveryVerified: false };
}

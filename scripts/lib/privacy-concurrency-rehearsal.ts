import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { processPrivacyWebhook, privacySecret } from "../../app/services/privacy.server";
import { decryptField } from "../../app/services/field-encryption.server";
import { claimCustomerPrivacyRequest, releaseCustomerPrivacyFailure } from "../../app/services/customer-privacy-queue.server";
import { assertOrderNotSuppressed, stagePrivacyOrderSuppression, PrivacyOrderSuppressedError } from "../../app/services/order-privacy-guard.server";
import { processCustomerPrivacyExportStep } from "../../app/services/customer-privacy-artifact.server";

export async function rehearsePrivacyIntakeConcurrency(db: PrismaClient, other: PrismaClient) {
  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: "merchant-a" } });
  const scopeSecret = "synthetic-privacy-field-key-32-bytes";
  const args = { shop: merchant.shop, type: "CUSTOMERS_REDACT" as const,
    payload: { customer: { id: 9991 }, orders_to_redact: [7777, 8888] },
    secret: privacySecret(), scopeSecret };
  const [first, second] = await Promise.all([
    processPrivacyWebhook({ ...args, db }), processPrivacyWebhook({ ...args, db: other }),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(first.status, "PENDING_ORDER_SCOPE");
  assert.equal(first.completedAt, null);
  assert.equal(await db.privacyRequest.count({ where: { idempotencyKey: first.idempotencyKey } }), 1);
  const scope = decryptField<{ orderIds: string[] }>(first.scopeCiphertext, scopeSecret);
  assert.deepEqual(scope?.orderIds, ["gid://shopify/Order/7777", "gid://shopify/Order/8888"]);
  assert.doesNotMatch(JSON.stringify(first), /7777|8888/);
  const rotatedKey = "synthetic-rotated-privacy-key-at-least-32-bytes";
  const rotatedReplay = await processPrivacyWebhook({ ...args, db: other,
    secret: rotatedKey, lookupSecrets: [rotatedKey, args.secret] });
  assert.equal(rotatedReplay.id, first.id);
  const detachedArgs = { shop: "detached-privacy-race.myshopify.com", type: "CUSTOMERS_DATA_REQUEST" as const,
    payload: { customer: { id: 9 }, data_request: { id: 999 }, orders_requested: [456] }, scopeSecret };
  const detached = await Promise.allSettled([
    processPrivacyWebhook({ ...detachedArgs, db, secret: args.secret, lookupSecrets: [args.secret] }),
    processPrivacyWebhook({ ...detachedArgs, db: other, secret: rotatedKey, lookupSecrets: [rotatedKey, args.secret] }),
  ]);
  const receipts = detached.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  assert.ok(receipts.length >= 1);
  assert.equal(new Set(receipts.map((receipt) => receipt.id)).size, 1);
  for (const result of detached) if (result.status === "rejected") assert.match(String(result.reason), /KEY_HISTORY_MISSING/);
  assert.equal(await db.merchant.count({ where: { shop: detachedArgs.shop } }), 0);
  // Remove this isolated synthetic receipt before the unrelated worker-claim
  // rehearsal; it used a synthetic rotated key unavailable to that worker.
  await db.privacyRequest.delete({ where: { id: receipts[0].id } });
  const now = new Date();
  const claims = await Promise.all([
    claimCustomerPrivacyRequest({ db, now }), claimCustomerPrivacyRequest({ db: other, now }),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const claimed = claims.find((claim) => claim !== null)!;
  const later = new Date(now.getTime() + 60_000);
  const replacements = await Promise.all([
    claimCustomerPrivacyRequest({ db, now: later }), claimCustomerPrivacyRequest({ db: other, now: later }),
  ]);
  assert.equal(replacements.filter(Boolean).length, 1);
  assert.equal(await releaseCustomerPrivacyFailure({ db, lease: claimed, now: later,
    code: "PRIVACY_STORAGE_UNAVAILABLE" }), false);
  const replacement = replacements.find((claim) => claim !== null)!;
  await assert.rejects(stagePrivacyOrderSuppression({ db, lease: claimed, scopeSecret, secret: args.secret, now: later }), /STALE_PRIVACY_LEASE/);
  await Promise.all([
    stagePrivacyOrderSuppression({ db, lease: replacement, scopeSecret, secret: args.secret, now: later }),
    stagePrivacyOrderSuppression({ db: other, lease: replacement, scopeSecret, secret: args.secret, now: later }),
  ]);
  assert.equal(await db.privacyOrderSuppression.count({ where: { requestId: first.id } }), 2);
  await assert.rejects(other.$transaction((tx) => assertOrderNotSuppressed({ tx,
    merchantId: merchant.id, orderId: "gid://shopify/Order/7777", secret: args.secret })), PrivacyOrderSuppressedError);
  await other.$transaction((tx) => assertOrderNotSuppressed({ tx,
    merchantId: merchant.id, orderId: "gid://shopify/Order/9999", secret: args.secret }));
  assert.equal(await releaseCustomerPrivacyFailure({ db, lease: replacement, now: later,
    code: "PRIVACY_STORAGE_UNAVAILABLE" }), true);
  const exportRequest = await processPrivacyWebhook({ db, shop: "pg-artifact-detached.myshopify.com",
    type: "CUSTOMERS_DATA_REQUEST", secret: args.secret, scopeSecret,
    payload: { data_request: { id: 998 }, orders_requested: [501, 502] } });
  const exportLease = await claimCustomerPrivacyRequest({ db, requestTypes: ["CUSTOMERS_DATA_REQUEST"] });
  assert.ok(exportLease);
  assert.equal(exportLease.request.id, exportRequest.id);
  const exports = await Promise.allSettled([
    processCustomerPrivacyExportStep({ db, lease: exportLease, scopeSecret, privacySecret: args.secret }),
    processCustomerPrivacyExportStep({ db: other, lease: exportLease, scopeSecret, privacySecret: args.secret }),
  ]);
  assert.equal(exports.filter((result) => result.status === "fulfilled").length, 1);
  for (const result of exports) if (result.status === "rejected") assert.match(String(result.reason), /PRIVACY_LEASE_LOST/);
  assert.equal(await db.privacyArtifactChunk.count({ where: { requestId: exportRequest.id } }), 1);
  const exportNext = await claimCustomerPrivacyRequest({ db: other, requestTypes: ["CUSTOMERS_DATA_REQUEST"] });
  assert.ok(exportNext);
  assert.equal(exportNext.request.attempts, 1);
  const ready = await processCustomerPrivacyExportStep({ db, lease: exportNext, scopeSecret, privacySecret: args.secret });
  assert.equal(ready.readyForDelivery, true);
  assert.equal(await db.privacyArtifactChunk.count({ where: { requestId: exportRequest.id } }), 2);
  const exported = await db.privacyRequest.findUniqueOrThrow({ where: { id: exportRequest.id } });
  assert.equal(exported.completedAt, null);
  assert.equal(exported.status, "EXPORT_READY_OWNER_DELIVERY");
  assert.equal(await db.merchant.count({ where: { shop: "pg-artifact-detached.myshopify.com" } }), 0);
  return { clients: 2, concurrentRequests: 2, persistedRequests: 1, exactEncryptedScopeVerified: true,
    exclusiveClaims: 1, exclusiveExpiredReclaims: 1, staleWorkerRejected: true,
    concurrentSuppressionReplayRows: 2, scopedWriteGuardVerified: true,
    rotationReplayStable: true, detachedCrossKeyConcurrencySingleReceipt: true,
    artifactConcurrentWinners: 1, artifactParts: 2, artifactProgressAttemptsReset: true,
    detachedArtifactCollectionVerified: true, artifactDeliveryVerified: false,
    processingClaim: "INTAKE_QUEUE_SUPPRESSION_AND_ENCRYPTED_EXPORT_NOT_ERASURE_OR_DELIVERY" };
}

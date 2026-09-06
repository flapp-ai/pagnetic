import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { snapshotV2ExperimentReport } from "../../app/services/experiment-report-v2.server";
import { reconcileCanonicalFinancialOrderV2 } from "../../app/services/financial-ledger-v2.server";
import { normalizeShopifyFinancialSnapshotV2, type ShopifyFinancialSnapshotV2 } from "../../app/services/financial-v2";
import { canonicalQueuePayload } from "../../app/services/job-outbox.server";

export async function rehearseReportConcurrency(db: PrismaClient, other: PrismaClient) {
  const experiment = await db.experiment.findFirstOrThrow({ where: { merchantId: "merchant-a", key: "close-race" } });
  const assignment = await db.assignment.findFirstOrThrow({ where: { experimentId: experiment.id, randomizationUnitId: "late-close-visitor" } });
  const deployment = await db.deploymentVersion.create({ data: {
    merchantId: "merchant-a", productId: "product-a", revision: 1, protocolVersion: "pagnetic-effect-v2",
    policy: "UNIVERSAL", contentSetHash: "synthetic-report-content", experimentId: experiment.id,
    state: "ACTIVE", approvedAuthorityHash: "synthetic-report-authority", canonicalPayload: "{}",
  } });
  const decision = await db.decision.create({ data: {
    id: "synthetic-report-decision",
    merchantId: "merchant-a", productId: "product-a", experimentId: experiment.id, assignmentId: assignment.id,
    deploymentVersionId: deployment.id, deploymentRevision: 1, sessionId: "synthetic-report-session",
    arm: "ORIGINAL", policy: "UNIVERSAL", reason: "V2_EXPERIMENT_ASSIGNMENT",
    consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED", occurredAt: assignment.assignedAt,
  } });
  const secret = "synthetic-report-concurrency-at-least-32-characters";
  const body = Buffer.from(canonicalQueuePayload({ merchantId: "merchant-a", productId: "product-a",
    experimentId: experiment.id, assignmentId: assignment.id, deploymentId: deployment.id,
    decisionId: decision.id, issuedAt: decision.occurredAt.toISOString(), expiresAt: assignment.expiresAt.toISOString(),
  })).toString("base64url");
  const signed = `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  const money = (amount: string) => ({ amount, currencyCode: "USD" });
  function source(updatedAt: string, discount: string): ShopifyFinancialSnapshotV2 {
    return {
      merchantId: "merchant-a", orderId: "gid://shopify/Order/99002", createdAt: "2026-09-15T00:00:00Z",
      sourceUpdatedAt: updatedAt, observedAt: updatedAt, test: false, cancelledAt: null, taxesIncluded: false,
      originalTotalPrice: money("100"), completeness: { lines: true, transactions: true, refunds: true, refundChildren: true, graphQlErrors: false },
      lines: [{ lineId: "gid://shopify/LineItem/report-race", productId: "gid://shopify/Product/123", variantId: null,
        giftCardProduct: false, sellingPlan: false, originalTotal: money("100"), discountAllocations: [money(discount)],
        taxLines: [], signedAssignmentReference: signed }],
      transactions: [{ transactionId: "gid://shopify/OrderTransaction/report-race", parentId: null,
        kind: "SALE", status: "SUCCESS", test: false, processedAt: "2026-09-15T00:00:01Z", amount: money("100") }], refunds: [],
    };
  }
  const reconcile = (client: PrismaClient, revision: ShopifyFinancialSnapshotV2) => reconcileCanonicalFinancialOrderV2({
    db: client, merchantId: "merchant-a", assignmentSecret: secret, order: normalizeShopifyFinancialSnapshotV2(revision),
  });
  await reconcile(db, source("2026-09-16T00:00:00Z", "0"));
  let signalLock!: () => void;
  let releaseLock!: () => void;
  const reached = new Promise<void>((resolve) => { signalLock = resolve; });
  const release = new Promise<void>((resolve) => { releaseLock = resolve; });
  let intercepted = false;
  const delayed = db.$extends({ query: { experiment: { async updateMany({ args, query }) {
    if (!intercepted) { intercepted = true; signalLock(); await release; }
    return query(args);
  } } } }) as unknown as PrismaClient;
  const args = { merchantId: "merchant-a", experimentId: experiment.id, healthState: "READY" as const, now: new Date("2026-09-30Z") };
  const finalizing = snapshotV2ExperimentReport({ ...args, db: delayed });
  const observed = finalizing.then((value) => ({ value, error: null }), (error) => ({ value: null, error }));
  try {
    await reached;
    await reconcile(other, source("2026-09-20T00:00:00Z", "20"));
  } finally { releaseLock(); }
  const outcome = await observed;
  if (outcome.error) throw outcome.error;
  const report = outcome.value!;
  assert.equal(JSON.parse(report.payloadJson).analysis.control.netRevenueMinor, "8000");
  await reconcile(other, source("2026-10-01T00:00:00Z", "60"));
  const replay = await snapshotV2ExperimentReport({ ...args, db, now: new Date("2026-10-02Z") });
  assert.equal(replay.id, report.id);
  assert.equal(replay.payloadJson, report.payloadJson);
  assert.equal((await db.visitorOutcome.findUniqueOrThrow({ where: { assignmentId: assignment.id } })).netFocalRevenueMinor, "4000");
  return { concurrentPreCutoffRevisionIncluded: true, frozenMinor: "8000", laterOperationalMinor: "4000", finalizedReportUnchanged: true };
}

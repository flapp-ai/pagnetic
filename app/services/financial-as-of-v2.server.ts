import type { PrismaClient } from "@prisma/client";

import { financialSourceIsCompleteV2, type CanonicalFinancialOrderV2 } from "./financial-v2";
import { canonicalQueuePayload } from "./job-outbox.server";

export type FinancialRevisionV2 = {
  id: string;
  canonicalPayload: string;
  links: Array<{ merchantId: string; experimentId: string; assignmentId: string; shopifyLineId: string }>;
};

// Deliberately independent of today's mutable ledger/projection. Missing
// historical authority is a reconciliation gap, never an invented zero sale.
export function evaluateFinancialAsOfV2(args: {
  merchantId: string; experimentId: string; cutoff: Date; revisions: FinancialRevisionV2[];
}) {
  if (!Number.isFinite(args.cutoff.getTime())) throw new Error("FINANCIAL_CUTOFF_INVALID");
  const cutoff = args.cutoff.toISOString();
  const grouped = new Map<string, Array<{ record: FinancialRevisionV2; order: CanonicalFinancialOrderV2 }>>();
  for (const record of args.revisions) {
    const order = JSON.parse(record.canonicalPayload) as CanonicalFinancialOrderV2;
    if (order.merchantId !== args.merchantId) throw new Error("FINANCIAL_REVISION_TENANT_MISMATCH");
    const group = grouped.get(order.orderId) ?? [];
    group.push({ record, order });
    grouped.set(order.orderId, group);
  }
  const reasons = new Set<string>();
  const currencies = new Set<string>();
  const outcomes = new Map<string, { net: bigint; orders: Set<string> }>();
  const usedRevisionIds = new Set<string>();
  let linkedEligibleOrders = 0;
  let reconciledLinkedOrders = 0;
  let contradictoryLinks = 0;
  for (const entries of grouped.values()) {
    const linked = entries.some(({ record }) => record.links.some((link) =>
      link.merchantId === args.merchantId && link.experimentId === args.experimentId));
    if (!linked || entries.every(({ order }) => order.test)) continue;
    linkedEligibleOrders += 1;
    const candidates = entries.filter(({ order }) => order.sourceUpdatedAt <= cutoff && financialSourceIsCompleteV2(order.completeness))
      .sort((a, b) => b.order.sourceUpdatedAt.localeCompare(a.order.sourceUpdatedAt) || a.record.id.localeCompare(b.record.id));
    const selected = candidates[0];
    if (!selected) { reasons.add("AS_OF_ORDER_REVISION_UNAVAILABLE"); continue; }
    const { order, record } = selected;
    if (entries.some((entry) => entry.order.sourceUpdatedAt <= cutoff && entry.order.sourceUpdatedAt > order.sourceUpdatedAt)) {
      reasons.add("AS_OF_NEWER_REVISION_INCOMPLETE"); continue;
    }
    usedRevisionIds.add(record.id);
    const sameTime = candidates.filter((item) => item.order.sourceUpdatedAt === order.sourceUpdatedAt);
    if (new Set(sameTime.map((item) => item.order.sourceHash)).size > 1) {
      reasons.add("AS_OF_SOURCE_CONFLICT"); contradictoryLinks += 1; continue;
    }
    const links = record.links.filter((link) => link.merchantId === args.merchantId && link.experimentId === args.experimentId);
    if (links.length === 0) { reasons.add("AS_OF_LINK_AUTHORITY_UNAVAILABLE"); contradictoryLinks += 1; continue; }
    if (order.test) continue;
    currencies.add(order.currency);
    const refundOnlyReasons = new Set(["REFUND_PENDING", "REFUND_AMOUNT_MISMATCH", "REFUND_EXCEEDS_LINE_MERCHANDISE"]);
    if (order.paymentState !== "CAPTURED" || order.unresolvedReasons.some((reason) => !refundOnlyReasons.has(reason))) {
      reasons.add("AS_OF_FINANCIAL_RECONCILIATION_INCOMPLETE"); continue;
    }
    const captures = order.transactions.filter((transaction) => !transaction.test &&
      ["SALE", "CAPTURE"].includes(transaction.kind) && transaction.status === "SUCCESS");
    if (captures.some((transaction) => !transaction.processedAt)) {
      reasons.add("AS_OF_PAYMENT_TIMING_UNAVAILABLE"); continue;
    }
    const capturedByCutoff = captures.filter((transaction) => transaction.processedAt! <= cutoff)
      .reduce((total, transaction) => total + BigInt(transaction.amount.minor), 0n);
    if (capturedByCutoff < BigInt(order.originalObligation.minor)) {
      reasons.add("AS_OF_PAYMENT_NOT_SETTLED"); continue;
    }
    // Later delivery may contain a refund whose source facts belong before the
    // cutoff. Keep those; distinguish later settlement from unknown allocation.
    const refundVersions = new Map<string, Array<{ refund: CanonicalFinancialOrderV2["refunds"][number]; revisionId: string }>>();
    for (const entry of entries) {
      if (!financialSourceIsCompleteV2(entry.order.completeness)) continue;
      for (const refund of entry.order.refunds) {
        const versions = refundVersions.get(refund.refundId) ?? [];
        versions.push({ refund, revisionId: entry.record.id });
        refundVersions.set(refund.refundId, versions);
      }
    }
    let ready = true;
    const refunds: CanonicalFinancialOrderV2["refunds"] = [];
    for (const versions of refundVersions.values()) {
      const inWindow = versions.filter(({ refund }) => refund.sourceUpdatedAt <= cutoff)
        .sort((a, b) => b.refund.sourceUpdatedAt.localeCompare(a.refund.sourceUpdatedAt));
      if (inWindow[0]) {
        const { refund, revisionId } = inWindow[0];
        if (new Set(inWindow.filter((item) => item.refund.sourceUpdatedAt === refund.sourceUpdatedAt)
          .map((item) => canonicalQueuePayload(item.refund))).size > 1) {
          reasons.add("AS_OF_REFUND_SOURCE_CONFLICT"); contradictoryLinks += 1; ready = false; continue;
        }
        usedRevisionIds.add(revisionId);
        if (refund.settledAt && refund.settledAt > cutoff) continue;
        if (refund.hasUnresolvedAdjustment || refund.lines.some((line) => line.settlementState !== "SETTLED" || line.merchandise == null)) {
          reasons.add("AS_OF_REFUND_UNRESOLVED"); ready = false;
        } else refunds.push(refund);
      } else if (versions.some(({ refund }) => !refund.settledAt || refund.settledAt <= cutoff)) {
        reasons.add("AS_OF_REFUND_ALLOCATION_UNAVAILABLE"); ready = false;
      }
    }
    const contributions = [];
    for (const link of links) {
      const line = order.lines.find((item) => item.lineId === link.shopifyLineId);
      if (!line || line.giftCardProduct || line.sellingPlan || !line.merchandiseBeforeRefunds) {
        reasons.add("AS_OF_LINE_AUTHORITY_UNAVAILABLE"); ready = false; continue;
      }
      let net = BigInt(line.merchandiseBeforeRefunds.minor);
      for (const refund of refunds) for (const refunded of refund.lines)
        if (refunded.lineId === line.lineId) net -= BigInt(refunded.merchandise!.minor);
      if (net < 0n) { reasons.add("AS_OF_REFUND_EXCEEDS_MERCHANDISE"); ready = false; }
      contributions.push({ assignmentId: link.assignmentId, net });
    }
    if (!ready) continue;
    reconciledLinkedOrders += 1;
    for (const contribution of contributions) {
      const outcome = outcomes.get(contribution.assignmentId) ?? { net: 0n, orders: new Set<string>() };
      outcome.net += contribution.net;
      outcome.orders.add(order.orderId);
      outcomes.set(contribution.assignmentId, outcome);
    }
  }
  if (currencies.size > 1) reasons.add("MULTIPLE_SHOP_CURRENCIES");
  return {
    linkedEligibleOrders, reconciledLinkedOrders, contradictoryLinks,
    complete: reasons.size === 0 && linkedEligibleOrders === reconciledLinkedOrders,
    reasons: [...reasons].sort(), currencyCode: currencies.size === 1 ? [...currencies][0]! : "UNKNOWN",
    cutoff, revisionIds: [...usedRevisionIds].sort(),
    outcomes: [...outcomes].sort(([a], [b]) => a.localeCompare(b)).map(([assignmentId, value]) => ({
      assignmentId, netFocalRevenueMinor: value.net.toString(), paidOrders: value.orders.size,
    })),
  };
}

export async function loadFinancialAsOfV2(args: {
  db: PrismaClient; merchantId: string; experimentId: string; cutoff: Date;
}) {
  const linked = await args.db.financialOrderRevision.findMany({
    where: { merchantId: args.merchantId, links: { some: { merchantId: args.merchantId, experimentId: args.experimentId } } },
    select: { shopifyOrderId: true }, distinct: ["shopifyOrderId"],
  });
  const revisions = await args.db.financialOrderRevision.findMany({
    where: { merchantId: args.merchantId, shopifyOrderId: { in: linked.map((item) => item.shopifyOrderId) } },
    include: { links: true },
  });
  const result = evaluateFinancialAsOfV2({ ...args, revisions });
  const previous = await args.db.orderLedger.findMany({
    where: { merchantId: args.merchantId, test: false,
      lines: { some: { attributions: { some: { merchantId: args.merchantId, experimentId: args.experimentId } } } } },
    select: { shopifyOrderId: true },
  });
  const recorded = new Set(linked.map((item) => item.shopifyOrderId));
  const missing = previous.filter((item) => !recorded.has(item.shopifyOrderId));
  if (missing.length) {
    result.linkedEligibleOrders += missing.length;
    result.complete = false;
    result.reasons.push("IMMUTABLE_FINANCIAL_HISTORY_MISSING");
  }
  return result;
}

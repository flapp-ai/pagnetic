import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFinancialAsOfV2, type FinancialRevisionV2 } from "../app/services/financial-as-of-v2.server";
import { normalizeShopifyFinancialSnapshotV2, type ShopifyFinancialSnapshotV2 } from "../app/services/financial-v2";

const money = (amount: string) => ({ amount, currencyCode: "USD" });
const cutoff = new Date("2026-09-20T00:00:00Z");
function source(): ShopifyFinancialSnapshotV2 {
  return {
    merchantId: "merchant", orderId: "order", createdAt: "2026-09-02T00:00:00Z",
    sourceUpdatedAt: "2026-09-02T00:00:01Z", observedAt: "2026-09-02T00:01:00Z",
    test: false, cancelledAt: null, taxesIncluded: false, originalTotalPrice: money("100"),
    completeness: { lines: true, transactions: true, refunds: true, refundChildren: true, graphQlErrors: false },
    lines: [{ lineId: "line", productId: "product", variantId: "variant", giftCardProduct: false,
      sellingPlan: false, originalTotal: money("100"), discountAllocations: [], taxLines: [], signedAssignmentReference: "verified-fixture" }],
    transactions: [{ transactionId: "payment", parentId: null, kind: "SALE", status: "SUCCESS", test: false,
      processedAt: "2026-09-02T00:00:01Z", amount: money("100") }],
    refunds: [],
  };
}
function refund(updatedAt: string, processedAt: string | null, amount = "20"): ShopifyFinancialSnapshotV2["refunds"][number] {
  return { refundId: "refund", sourceUpdatedAt: updatedAt, hasUnresolvedAdjustment: false,
    transactions: [{ transactionId: "refund-payment", kind: "REFUND", status: "SUCCESS", processedAt, amount: money(amount) }],
    lines: [{ refundLineKey: "refund-line", lineId: "line", merchandise: money(amount), tax: money("0") }] };
}
function record(input: ShopifyFinancialSnapshotV2, id: string): FinancialRevisionV2 {
  return { id, canonicalPayload: JSON.stringify(normalizeShopifyFinancialSnapshotV2(input)),
    links: [{ merchantId: "merchant", experimentId: "experiment", assignmentId: "assignment", shopifyLineId: "line" }] };
}
function analyze(revisions: FinancialRevisionV2[]) {
  return evaluateFinancialAsOfV2({ merchantId: "merchant", experimentId: "experiment", cutoff, revisions });
}

test("post-cutoff settlement does not subtract from frozen focal revenue", () => {
  const initial = source();
  const later = { ...source(), sourceUpdatedAt: "2026-09-22T00:00:00Z", refunds: [refund("2026-09-22T00:00:00Z", "2026-09-22T00:00:00Z")] };
  const result = analyze([record(initial, "first"), record(later, "later")]);
  assert.equal(result.complete, true);
  assert.equal(result.outcomes[0]!.netFocalRevenueMinor, "10000");
});

test("late-arriving pre-cutoff refund facts count once despite delivery order", () => {
  const later = { ...source(), sourceUpdatedAt: "2026-09-22T00:00:00Z", observedAt: "2026-09-25T00:00:00Z",
    refunds: [refund("2026-09-19T00:00:00Z", "2026-09-19T00:00:00Z")] };
  const original = record(source(), "first");
  const late = record(later, "late");
  const a = analyze([original, late, late]);
  const b = analyze([late, original]);
  assert.equal(a.complete, true);
  assert.equal(a.outcomes[0]!.netFocalRevenueMinor, "8000");
  assert.deepEqual(a.outcomes, b.outcomes);
  assert.equal(a.outcomes[0]!.paidOrders, 1);
});

test("no historical order allocation and unknown later refund times fail closed", () => {
  const onlyLate = record({ ...source(), sourceUpdatedAt: "2026-09-22T00:00:00Z" }, "late");
  assert.ok(analyze([onlyLate]).reasons.includes("AS_OF_ORDER_REVISION_UNAVAILABLE"));
  const later = record({ ...source(), sourceUpdatedAt: "2026-09-22T00:00:00Z",
    refunds: [refund("2026-09-22T00:00:00Z", null)] }, "later");
  assert.ok(analyze([record(source(), "first"), later]).reasons.includes("AS_OF_REFUND_ALLOCATION_UNAVAILABLE"));
});

test("conflicting full revisions at the cutoff cannot select an arbitrary winner", () => {
  const other = source();
  other.lines[0]!.discountAllocations = [money("10")];
  const result = analyze([record(source(), "first"), record(other, "conflict")]);
  assert.equal(result.complete, false);
  assert.equal(result.contradictoryLinks, 1);
  assert.ok(result.reasons.includes("AS_OF_SOURCE_CONFLICT"));
});

test("a newer incomplete pre-cutoff revision prevents certifying an older amount", () => {
  const incomplete = source();
  incomplete.sourceUpdatedAt = "2026-09-19T00:00:00Z";
  incomplete.completeness.lines = false;
  incomplete.lines = [];
  const result = analyze([record(source(), "first"), record(incomplete, "incomplete")]);
  // Incomplete evidence of a newer pre-cutoff revision cannot certify the old amount.
  assert.equal(result.complete, false);
  assert.ok(result.reasons.includes("AS_OF_NEWER_REVISION_INCOMPLETE"));
});

test("a later capture cannot be smuggled into an earlier financial cutoff", () => {
  const input = source();
  input.transactions[0]!.processedAt = "2026-09-22T00:00:00Z";
  assert.ok(analyze([record(input, "future-capture")]).reasons.includes("AS_OF_PAYMENT_NOT_SETTLED"));
});

test("equal refund watermarks with different allocations remain contradictory", () => {
  const first = { ...source(), sourceUpdatedAt: "2026-09-21T00:00:00Z", refunds: [refund("2026-09-19T00:00:00Z", "2026-09-19T00:00:00Z", "20")] };
  const second = { ...source(), sourceUpdatedAt: "2026-09-22T00:00:00Z", refunds: [refund("2026-09-19T00:00:00Z", "2026-09-19T00:00:00Z", "30")] };
  const result = analyze([record(source(), "original"), record(first, "one"), record(second, "two")]);
  assert.equal(result.complete, false);
  assert.ok(result.reasons.includes("AS_OF_REFUND_SOURCE_CONFLICT"));
});

test("test and cross-tenant facts never contribute to a live experiment", () => {
  assert.equal(analyze([record({ ...source(), test: true }, "test")]).outcomes.length, 0);
  assert.throws(() => analyze([record({ ...source(), merchantId: "other" }, "foreign")]), /TENANT_MISMATCH/);
});

test("refund settlement time uses the last successful split transaction", () => {
  const input = source();
  const item = refund("2026-09-22T00:00:00Z", "2026-09-19T00:00:00Z");
  item.transactions[0]!.amount = money("10");
  item.transactions.push({ transactionId: "refund-second", kind: "REFUND", status: "SUCCESS",
    processedAt: "2026-09-22T00:00:00Z", amount: money("10") });
  input.refunds = [item];
  assert.equal(normalizeShopifyFinancialSnapshotV2(input).refunds[0]!.settledAt, "2026-09-22T00:00:00.000Z");
});

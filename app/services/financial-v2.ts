import { createHash } from "node:crypto";

import { canonicalQueuePayload } from "./job-outbox.server";

export const PAGNETIC_FINANCIAL_POLICY_VERSION = "pagnetic-financial-v2.2";
export const PAGNETIC_FINANCIAL_API_VERSION = "2026-07";
const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "TRY", "ILS"]);
const MAX_MINOR = 9_000_000_000_000_000n;

export type MinorMoneyV2 = { minor: string; currency: string };
export function financialSourceIsCompleteV2(
  value: ShopifyFinancialSnapshotV2["completeness"],
) {
  return (
    value.lines === true &&
    value.transactions === true &&
    value.refunds === true &&
    value.refundChildren === true &&
    value.graphQlErrors === false
  );
}
export type ShopifyMoneyV2 = { amount: string; currencyCode: string };
export type ShopifyFinancialSnapshotV2 = {
  merchantId: string;
  orderId: string;
  createdAt: string;
  sourceUpdatedAt: string;
  observedAt: string;
  test: boolean;
  cancelledAt: string | null;
  taxesIncluded: boolean;
  originalTotalPrice: ShopifyMoneyV2;
  completeness: {
    lines: boolean;
    transactions: boolean;
    refunds: boolean;
    refundChildren: boolean;
    graphQlErrors: boolean;
  };
  lines: Array<{
    lineId: string;
    productId: string | null;
    variantId: string | null;
    giftCardProduct: boolean;
    sellingPlan: boolean;
    originalTotal: ShopifyMoneyV2;
    discountAllocations: ShopifyMoneyV2[];
    taxLines: ShopifyMoneyV2[];
    signedAssignmentReference: string | null;
  }>;
  transactions: Array<{
    transactionId: string;
    parentId: string | null;
    kind: string;
    status: string;
    test: boolean;
    processedAt: string | null;
    amount: ShopifyMoneyV2;
  }>;
  refunds: Array<{
    refundId: string;
    sourceUpdatedAt: string;
    hasUnresolvedAdjustment: boolean;
    transactions: Array<{
      transactionId: string;
      kind: string;
      status: string;
      processedAt?: string | null;
      amount: ShopifyMoneyV2;
    }>;
    lines: Array<{
      refundLineKey: string;
      lineId: string;
      merchandise: ShopifyMoneyV2 | null;
      tax: ShopifyMoneyV2;
    }>;
  }>;
  taxInclusiveRefundBasisVerified?: boolean;
};

export type CanonicalFinancialOrderV2 = {
  schemaVersion: 2;
  apiVersion: typeof PAGNETIC_FINANCIAL_API_VERSION;
  policyVersion: typeof PAGNETIC_FINANCIAL_POLICY_VERSION;
  merchantId: string;
  orderId: string;
  createdAt: string;
  sourceUpdatedAt: string;
  observedAt: string;
  test: boolean;
  cancelledAt: string | null;
  currency: string;
  originalObligation: MinorMoneyV2;
  completeness: ShopifyFinancialSnapshotV2["completeness"];
  sourceHash: string;
  paymentState:
    "CAPTURED" | "UNPAID" | "PARTIAL" | "CONTRADICTORY" | "TEST_ONLY";
  reconciliationState: "RECONCILED" | "PENDING" | "TEST_ONLY";
  lines: Array<{
    lineId: string;
    productId: string | null;
    variantId: string | null;
    giftCardProduct: boolean;
    sellingPlan: boolean;
    merchandiseBeforeRefunds: MinorMoneyV2 | null;
    signedAssignmentReference: string | null;
  }>;
  transactions: Array<{
    transactionId: string;
    parentId: string | null;
    kind: string;
    status: string;
    test: boolean;
    processedAt: string | null;
    amount: MinorMoneyV2;
  }>;
  refunds: Array<{
    refundId: string;
    sourceUpdatedAt: string;
    transactionIds: string[];
    settledAt: string | null;
    lines: Array<{
      refundLineKey: string;
      lineId: string;
      merchandise: MinorMoneyV2 | null;
      tax: MinorMoneyV2;
      settlementState: "SETTLED" | "PENDING" | "CONTRADICTORY";
    }>;
    hasUnresolvedAdjustment: boolean;
  }>;
  unresolvedReasons: string[];
};

function identifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_:/.-]{1,200}$/.test(value))
    throw new Error(`${label} is invalid.`);
  return value;
}

function timestamp(value: string, label: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

export function parseShopMoneyV2(value: ShopifyMoneyV2): MinorMoneyV2 {
  const currency = String(value.currencyCode ?? "").toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency))
    throw new Error("UNSUPPORTED_CURRENCY");
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value.amount);
  if (!match) throw new Error("INVALID_MONEY_DECIMAL");
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const absolute = BigInt(match[2]) * 100n + BigInt(fraction || "0");
  const minor = match[1] ? -absolute : absolute;
  if (minor < -MAX_MINOR || minor > MAX_MINOR)
    throw new Error("MONEY_OUT_OF_RANGE");
  return { minor: minor.toString(), currency };
}

function sameCurrency(values: MinorMoneyV2[], expected: string) {
  if (values.some((value) => value.currency !== expected))
    throw new Error("CURRENCY_MISMATCH");
}

function sum(values: MinorMoneyV2[], currency: string) {
  sameCurrency(values, currency);
  return values.reduce((total, value) => total + BigInt(value.minor), 0n);
}

function uniqueById<T extends { transactionId: string }>(values: T[]) {
  const seen = new Map<string, string>();
  return values.filter((value) => {
    identifier(value.transactionId, "Transaction identity");
    const material = canonicalQueuePayload(value);
    if (seen.has(value.transactionId)) {
      if (seen.get(value.transactionId) !== material)
        throw new Error("CONTRADICTORY_TRANSACTION");
      return false;
    }
    seen.set(value.transactionId, material);
    return true;
  });
}

export function normalizeShopifyFinancialSnapshotV2(
  input: ShopifyFinancialSnapshotV2,
): CanonicalFinancialOrderV2 {
  identifier(input.merchantId, "Merchant identity");
  identifier(input.orderId, "Order identity");
  const currency = parseShopMoneyV2(input.originalTotalPrice).currency;
  const originalObligation = parseShopMoneyV2(input.originalTotalPrice);
  const unresolved = new Set<string>();
  const transactions = uniqueById(input.transactions).map((source) => {
    return {
      ...source,
      parentId: source.parentId
        ? identifier(source.parentId, "Parent transaction identity")
        : null,
      processedAt: source.processedAt
        ? timestamp(source.processedAt, "Transaction time")
        : null,
      kind: source.kind.toUpperCase(),
      status: source.status.toUpperCase(),
      amount: parseShopMoneyV2(source.amount),
    };
  });
  sameCurrency(
    transactions.map((item) => item.amount),
    currency,
  );
  const captured = sum(
    transactions
      .filter(
        (item) =>
          ["SALE", "CAPTURE"].includes(item.kind) &&
          item.status === "SUCCESS" &&
          !item.test,
      )
      .map((item) => item.amount),
    currency,
  );
  const obligation = BigInt(originalObligation.minor);
  let paymentState: CanonicalFinancialOrderV2["paymentState"];
  if (input.test || transactions.some((item) => item.test))
    paymentState = "TEST_ONLY";
  else if (captured === obligation) paymentState = "CAPTURED";
  else if (captured === 0n) paymentState = "UNPAID";
  else if (captured > 0n && captured < obligation) {
    paymentState = "PARTIAL";
    unresolved.add("PARTIAL_PAYMENT");
  } else {
    paymentState = "CONTRADICTORY";
    unresolved.add("CONTRADICTORY_PAYMENT");
  }

  const lines = input.lines.map((line) => {
    identifier(line.lineId, "Line identity");
    const original = parseShopMoneyV2(line.originalTotal);
    const discounts = line.discountAllocations.map(parseShopMoneyV2);
    const taxes = line.taxLines.map(parseShopMoneyV2);
    sameCurrency([original, ...discounts, ...taxes], currency);
    let merchandise = BigInt(original.minor) - sum(discounts, currency);
    if (input.taxesIncluded) merchandise -= sum(taxes, currency);
    let merchandiseBeforeRefunds: MinorMoneyV2 | null = {
      minor: merchandise.toString(),
      currency,
    };
    if (merchandise < 0n) {
      unresolved.add("UNRESOLVED_FINANCIAL_ALLOCATION");
      merchandiseBeforeRefunds = null;
    }
    return {
      lineId: line.lineId,
      productId: line.productId,
      variantId: line.variantId,
      giftCardProduct: line.giftCardProduct,
      sellingPlan: line.sellingPlan,
      merchandiseBeforeRefunds,
      signedAssignmentReference: line.signedAssignmentReference,
    };
  });

  const refunds = input.refunds.map((refund) => {
    identifier(refund.refundId, "Refund identity");
    if (refund.hasUnresolvedAdjustment)
      unresolved.add("UNRESOLVED_FINANCIAL_ALLOCATION");
    const refundTransactions = uniqueById(refund.transactions).map(
      (transaction) => {
        return {
          ...transaction,
          kind: transaction.kind.toUpperCase(),
          status: transaction.status.toUpperCase(),
          processedAt: transaction.processedAt ? timestamp(transaction.processedAt, "Refund transaction time") : null,
          amount: parseShopMoneyV2(transaction.amount),
        };
      },
    );
    sameCurrency(
      refundTransactions.map((item) => item.amount),
      currency,
    );
    const settledAmount = sum(
      refundTransactions
        .filter((item) => item.kind === "REFUND" && item.status === "SUCCESS")
        .map((item) => item.amount),
      currency,
    );
    const expectedAmount = refund.lines.reduce((total, line) => {
      const merchandise = line.merchandise
        ? parseShopMoneyV2(line.merchandise)
        : null;
      const tax = parseShopMoneyV2(line.tax);
      sameCurrency(merchandise ? [merchandise, tax] : [tax], currency);
      return (
        total +
        (merchandise ? BigInt(merchandise.minor) : 0n) +
        BigInt(tax.minor)
      );
    }, 0n);
    let settlementState: "SETTLED" | "PENDING" | "CONTRADICTORY" = "SETTLED";
    if (settledAmount === 0n && expectedAmount > 0n) {
      settlementState = "PENDING";
      unresolved.add("REFUND_PENDING");
    } else if (settledAmount !== expectedAmount) {
      settlementState = "CONTRADICTORY";
      unresolved.add("REFUND_AMOUNT_MISMATCH");
    }
    if (input.taxesIncluded && !input.taxInclusiveRefundBasisVerified) {
      settlementState = "PENDING";
      unresolved.add("TAX_BASIS_UNVERIFIED");
    }
    return {
      refundId: refund.refundId,
      sourceUpdatedAt: timestamp(refund.sourceUpdatedAt, "Refund update time"),
      transactionIds: refundTransactions.map((item) => item.transactionId),
      settledAt: (() => {
        const settled = refundTransactions.filter((item) => item.kind === "REFUND" && item.status === "SUCCESS");
        return settled.length && settled.every((item) => item.processedAt)
          ? settled.map((item) => item.processedAt!).sort().at(-1)!
          : null;
      })(),
      lines: refund.lines.map((line) => ({
        refundLineKey: identifier(line.refundLineKey, "Refund line identity"),
        lineId: identifier(line.lineId, "Refund parent line identity"),
        merchandise: line.merchandise
          ? parseShopMoneyV2(line.merchandise)
          : null,
        tax: parseShopMoneyV2(line.tax),
        settlementState,
      })),
      hasUnresolvedAdjustment: refund.hasUnresolvedAdjustment,
    };
  });

  for (const line of lines) {
    if (!line.merchandiseBeforeRefunds) continue;
    const settledRefunds = refunds.reduce(
      (total, refund) =>
        total +
        refund.lines.reduce(
          (lineTotal, refundedLine) =>
            lineTotal +
            (refundedLine.lineId === line.lineId &&
            refundedLine.settlementState === "SETTLED" &&
            refundedLine.merchandise
              ? BigInt(refundedLine.merchandise.minor)
              : 0n),
          0n,
        ),
      0n,
    );
    if (settledRefunds > BigInt(line.merchandiseBeforeRefunds.minor))
      unresolved.add("REFUND_EXCEEDS_LINE_MERCHANDISE");
  }

  if (
    !input.completeness.lines ||
    !input.completeness.transactions ||
    !input.completeness.refunds ||
    !input.completeness.refundChildren ||
    input.completeness.graphQlErrors
  )
    unresolved.add("SOURCE_INCOMPLETE");
  if (input.cancelledAt && paymentState === "CAPTURED" && refunds.length === 0)
    unresolved.add("CANCELLED_CAPTURE_PENDING_RECONCILIATION");

  const sourceMaterial = {
    ...input,
    // Fetch timing is local observation metadata, not a Shopify source revision.
    observedAt: undefined,
    completeness: undefined,
    taxInclusiveRefundBasisVerified: undefined,
    lines: [...input.lines]
      .map((line) => ({
        ...line,
        discountAllocations: [...line.discountAllocations].sort((a, b) =>
          canonicalQueuePayload(a).localeCompare(canonicalQueuePayload(b)),
        ),
        taxLines: [...line.taxLines].sort((a, b) =>
          canonicalQueuePayload(a).localeCompare(canonicalQueuePayload(b)),
        ),
      }))
      .sort((left, right) => left.lineId.localeCompare(right.lineId)),
    transactions: uniqueById(input.transactions).sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId),
    ),
    refunds: [...input.refunds]
      .map((refund) => ({
        ...refund,
        transactions: uniqueById(refund.transactions).sort((left, right) =>
          left.transactionId.localeCompare(right.transactionId),
        ),
        lines: [...refund.lines].sort((left, right) =>
          left.refundLineKey.localeCompare(right.refundLineKey),
        ),
      }))
      .sort((left, right) => left.refundId.localeCompare(right.refundId)),
  };
  const sourceHash = createHash("sha256")
    .update(canonicalQueuePayload(sourceMaterial))
    .digest("hex");
  const unresolvedReasons = [...unresolved].sort();
  const reconciliationState =
    input.test || paymentState === "TEST_ONLY"
      ? "TEST_ONLY"
      : paymentState === "CAPTURED" && unresolvedReasons.length === 0
        ? "RECONCILED"
        : "PENDING";
  return {
    schemaVersion: 2,
    apiVersion: PAGNETIC_FINANCIAL_API_VERSION,
    policyVersion: PAGNETIC_FINANCIAL_POLICY_VERSION,
    merchantId: input.merchantId,
    orderId: input.orderId,
    createdAt: timestamp(input.createdAt, "Order creation time"),
    sourceUpdatedAt: timestamp(input.sourceUpdatedAt, "Order update time"),
    observedAt: timestamp(input.observedAt, "Observation time"),
    test: input.test,
    cancelledAt: input.cancelledAt
      ? timestamp(input.cancelledAt, "Cancellation time")
      : null,
    currency,
    originalObligation,
    completeness: input.completeness,
    sourceHash,
    paymentState,
    reconciliationState,
    lines,
    transactions,
    refunds,
    unresolvedReasons,
  };
}

export function netLineMerchandiseV2(
  order: CanonicalFinancialOrderV2,
  lineId: string,
) {
  const line = order.lines.find((candidate) => candidate.lineId === lineId);
  if (!line?.merchandiseBeforeRefunds) return null;
  let net = BigInt(line.merchandiseBeforeRefunds.minor);
  for (const refund of order.refunds) {
    for (const refundedLine of refund.lines) {
      if (
        refundedLine.lineId === lineId &&
        refundedLine.settlementState === "SETTLED" &&
        refundedLine.merchandise
      )
        net -= BigInt(refundedLine.merchandise.minor);
    }
  }
  return { minor: net.toString(), currency: order.currency };
}

export function netFocalMerchandiseV2(
  order: CanonicalFinancialOrderV2,
  productId: string,
) {
  if (order.reconciliationState !== "RECONCILED") return null;
  let total = 0n;
  for (const line of order.lines) {
    if (line.productId !== productId || line.giftCardProduct) continue;
    const net = netLineMerchandiseV2(order, line.lineId);
    if (!net) return null;
    total += BigInt(net.minor);
  }
  return { minor: total.toString(), currency: order.currency };
}

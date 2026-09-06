import type { Prisma } from "@prisma/client";

import { privacyOrderIds } from "./customer-privacy-scope.server";

const MAX_ORDERS = 100;
const PAGE_SIZE = 500;
const MAX_SOURCE_ROWS = 2_000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_CANONICAL_PAYLOAD_BYTES = 1024 * 1024;

type Tx = Prisma.TransactionClient;
type JsonPrimitive = string | number | boolean | null;
type ExportBudget = { rows: number; bytes: number };

function accountSourceRow<T extends { id: string }>(
  row: T,
  budget: ExportBudget,
) {
  const canonicalPayload = (row as { canonicalPayload?: unknown })
    .canonicalPayload;
  if (
    typeof canonicalPayload === "string" &&
    Buffer.byteLength(canonicalPayload, "utf8") > MAX_CANONICAL_PAYLOAD_BYTES
  )
    throw new Error("PRIVACY_EXPORT_ORDER_TOO_LARGE");

  // Account each source row exactly once as it arrives. This avoids repeatedly
  // serializing the growing result arrays and enforces the limit before append.
  const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
  if (
    budget.rows + 1 > MAX_SOURCE_ROWS ||
    budget.bytes + rowBytes > MAX_SOURCE_BYTES
  )
    throw new Error("PRIVACY_EXPORT_ORDER_TOO_LARGE");
  budget.rows += 1;
  budget.bytes += rowBytes;
}

async function readPages<T extends { id: string }>(
  load: (cursor: string | undefined) => Promise<T[]>,
  budget: ExportBudget,
) {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await load(cursor);
    if (page.length > PAGE_SIZE)
      throw new Error("PRIVACY_EXPORT_PAGE_OVERFLOW");
    for (const row of page) accountSourceRow(row, budget);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    const next = page[page.length - 1]?.id;
    if (!next || next === cursor)
      throw new Error("PRIVACY_EXPORT_CURSOR_STALLED");
    cursor = next;
  }
}

function chunks<T>(values: T[], size = 100) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

async function readIdChunks<T extends { id: string }>(
  ids: string[],
  load: (ids: string[], cursor: string | undefined) => Promise<T[]>,
  budget: ExportBudget,
) {
  const rows = new Map<string, T>();
  for (const batch of chunks([...new Set(ids)].sort())) {
    const pageRows = await readPages((cursor) => load(batch, cursor), budget);
    for (const row of pageRows) rows.set(row.id, row);
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

function safeJsonObject(json: string, allowed: ReadonlySet<string>) {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, item]) =>
            allowed.has(key) &&
            (item === null ||
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean"),
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    ) as Record<string, JsonPrimitive>;
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function money(value: unknown) {
  const item = record(value);
  const minor = text(item?.minor);
  const currency = text(item?.currency);
  return minor && currency ? { minor, currency } : null;
}

function canonicalFinancialView(json: string, expectedOrderId: string) {
  try {
    const source = record(JSON.parse(json));
    if (!source || source.orderId !== expectedOrderId) return null;
    const completeness = record(source.completeness);
    return {
      schemaVersion: finiteNumber(source.schemaVersion),
      apiVersion: text(source.apiVersion),
      policyVersion: text(source.policyVersion),
      orderId: expectedOrderId,
      createdAt: text(source.createdAt),
      sourceUpdatedAt: text(source.sourceUpdatedAt),
      observedAt: text(source.observedAt),
      test: boolean(source.test),
      cancelledAt: text(source.cancelledAt),
      currency: text(source.currency),
      originalObligation: money(source.originalObligation),
      completeness: completeness
        ? {
            lines: boolean(completeness.lines),
            transactions: boolean(completeness.transactions),
            refunds: boolean(completeness.refunds),
            refundChildren: boolean(completeness.refundChildren),
            graphQlErrors: boolean(completeness.graphQlErrors),
          }
        : null,
      paymentState: text(source.paymentState),
      reconciliationState: text(source.reconciliationState),
      lines: Array.isArray(source.lines)
        ? source.lines.flatMap((value) => {
            const line = record(value);
            const lineId = text(line?.lineId);
            return line && lineId
              ? [
                  {
                    lineId,
                    productId: text(line.productId),
                    variantId: text(line.variantId),
                    giftCardProduct: boolean(line.giftCardProduct),
                    sellingPlan: boolean(line.sellingPlan),
                    merchandiseBeforeRefunds: money(
                      line.merchandiseBeforeRefunds,
                    ),
                  },
                ]
              : [];
          })
        : [],
      transactions: Array.isArray(source.transactions)
        ? source.transactions.flatMap((value) => {
            const transaction = record(value);
            const transactionId = text(transaction?.transactionId);
            return transaction && transactionId
              ? [
                  {
                    transactionId,
                    parentId: text(transaction.parentId),
                    kind: text(transaction.kind),
                    status: text(transaction.status),
                    test: boolean(transaction.test),
                    processedAt: text(transaction.processedAt),
                    amount: money(transaction.amount),
                  },
                ]
              : [];
          })
        : [],
      refunds: Array.isArray(source.refunds)
        ? source.refunds.flatMap((value) => {
            const refund = record(value);
            const refundId = text(refund?.refundId);
            return refund && refundId
              ? [
                  {
                    refundId,
                    sourceUpdatedAt: text(refund.sourceUpdatedAt),
                    transactionIds: Array.isArray(refund.transactionIds)
                      ? refund.transactionIds.filter(
                          (id): id is string => typeof id === "string",
                        )
                      : [],
                    settledAt: text(refund.settledAt),
                    lines: Array.isArray(refund.lines)
                      ? refund.lines.flatMap((lineValue) => {
                          const line = record(lineValue);
                          const refundLineKey = text(line?.refundLineKey);
                          const lineId = text(line?.lineId);
                          return line && refundLineKey && lineId
                            ? [
                                {
                                  refundLineKey,
                                  lineId,
                                  merchandise: money(line.merchandise),
                                  tax: money(line.tax),
                                  settlementState: text(line.settlementState),
                                },
                              ]
                            : [];
                        })
                      : [],
                    hasUnresolvedAdjustment: boolean(
                      refund.hasUnresolvedAdjustment,
                    ),
                  },
                ]
              : [];
          })
        : [],
      unresolvedReasons: Array.isArray(source.unresolvedReasons)
        ? source.unresolvedReasons.filter(
            (reason): reason is string => typeof reason === "string",
          )
        : [],
    };
  } catch {
    return null;
  }
}

const LEGACY_ORDER_METADATA = new Set([
  "lineItemCount",
  "recovered",
  "test",
  "topic",
]);
const LEGACY_REFUND_METADATA = new Set(["transactionCount"]);
const EVENT_DATA = new Set([
  "amount",
  "arm",
  "bucket",
  "clsMilli",
  "currencyCode",
  "decisionTimeMs",
  "errorCode",
  "experimentVersion",
  "inpMs",
  "lcpMs",
  "policy",
  "reason",
  "serverProcessingMs",
  "serving",
  "status",
]);

function addLink(map: Map<string, Set<string>>, key: string, value: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function idsFor(map: Map<string, Set<string>>, key: string) {
  return [...(map.get(key) ?? [])].sort();
}

export async function collectCustomerPrivacyExport(args: {
  tx: Tx;
  merchantId: string;
  orderIds: unknown;
}) {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(args.merchantId))
    throw new Error("PRIVACY_EXPORT_MERCHANT_INVALID");
  if (!Array.isArray(args.orderIds) || args.orderIds.length < 1)
    throw new Error("PRIVACY_EXPORT_ORDER_SCOPE_INVALID");
  if (args.orderIds.length > MAX_ORDERS)
    throw new Error("PRIVACY_EXPORT_ORDER_LIMIT_EXCEEDED");
  const orderIds = privacyOrderIds(args.orderIds);
  if (!orderIds.length) throw new Error("PRIVACY_EXPORT_ORDER_SCOPE_INVALID");
  const budget: ExportBudget = { rows: 0, bytes: 0 };

  const legacyOrders = await readPages(
    (cursor) =>
      args.tx.storeOrder.findMany({
        where: {
          merchantId: args.merchantId,
          shopifyOrderId: { in: orderIds },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          shopifyOrderId: true,
          orderNumber: true,
          currencyCode: true,
          grossAmount: true,
          netAmount: true,
          financialStatus: true,
          cancelledAt: true,
          occurredAt: true,
          payloadJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    budget,
  );
  const legacyOrderIds = legacyOrders.map((order) => order.id);
  const legacyRefunds = await readIdChunks(
    legacyOrderIds,
    (ids, cursor) =>
      args.tx.storeRefund.findMany({
        where: { merchantId: args.merchantId, orderId: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          orderId: true,
          shopifyRefundId: true,
          amount: true,
          currencyCode: true,
          occurredAt: true,
          payloadJson: true,
          createdAt: true,
        },
      }),
    budget,
  );
  const legacyAttributions = await readIdChunks(
    legacyOrderIds,
    (ids, cursor) =>
      args.tx.orderAttribution.findMany({
        where: { merchantId: args.merchantId, orderId: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          orderId: true,
          experimentId: true,
          assignmentId: true,
          decisionId: true,
          joinMethod: true,
          joinedAt: true,
        },
      }),
    budget,
  );

  const v2Orders = await readPages(
    (cursor) =>
      args.tx.orderLedger.findMany({
        where: {
          merchantId: args.merchantId,
          shopifyOrderId: { in: orderIds },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          shopifyOrderId: true,
          shopifyCreatedAt: true,
          sourceUpdatedAt: true,
          shopCurrency: true,
          originalObligationMinor: true,
          paymentState: true,
          test: true,
          cancelledAt: true,
          reconciliationState: true,
          sourceWatermark: true,
          completenessJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    budget,
  );
  const v2OrderIds = v2Orders.map((order) => order.id);
  const v2Lines = await readIdChunks(
    v2OrderIds,
    (ids, cursor) =>
      args.tx.orderLedgerLine.findMany({
        where: { orderId: { in: ids }, order: { merchantId: args.merchantId } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          orderId: true,
          shopifyLineItemId: true,
          shopifyProductId: true,
          shopifyVariantId: true,
          merchandiseAfterDiscountMinor: true,
          currencyCode: true,
          giftCardProduct: true,
          allocationState: true,
        },
      }),
    budget,
  );
  const v2LineIds = v2Lines.map((line) => line.id);
  const v2Refunds = await readPages(
    (cursor) =>
      args.tx.refundLedger.findMany({
        where: {
          merchantId: args.merchantId,
          shopifyOrderId: { in: orderIds },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          orderId: true,
          shopifyOrderId: true,
          shopifyRefundId: true,
          shopifyTransactionId: true,
          shopifyLineItemId: true,
          amountMinor: true,
          currencyCode: true,
          sourceOccurredAt: true,
          allocationState: true,
          createdAt: true,
        },
      }),
    budget,
  );
  const v2Attributions = await readIdChunks(
    v2LineIds,
    (ids, cursor) =>
      args.tx.attributionV2.findMany({
        where: { merchantId: args.merchantId, orderLineId: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          orderLineId: true,
          assignmentId: true,
          experimentId: true,
          joinMethod: true,
          validAt: true,
          reason: true,
          status: true,
          correctedAt: true,
          createdAt: true,
        },
      }),
    budget,
  );

  const revisions = await readPages(
    (cursor) =>
      args.tx.financialOrderRevision.findMany({
        where: {
          merchantId: args.merchantId,
          shopifyOrderId: { in: orderIds },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          shopifyOrderId: true,
          sourceUpdatedAt: true,
          firstObservedAt: true,
          revisionHash: true,
          canonicalPayload: true,
          createdAt: true,
        },
      }),
    budget,
  );
  const revisionLinks = await readIdChunks(
    revisions.map((revision) => revision.id),
    (ids, cursor) =>
      args.tx.financialRevisionLink.findMany({
        where: { merchantId: args.merchantId, revisionId: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          revisionId: true,
          experimentId: true,
          assignmentId: true,
          shopifyLineId: true,
        },
      }),
    budget,
  );

  const directCommerceEvents = await readPages(
    (cursor) =>
      args.tx.commerceEvent.findMany({
        where: {
          merchantId: args.merchantId,
          shopifyOrderId: { in: orderIds },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          eventId: true,
          source: true,
          eventType: true,
          occurredAt: true,
          receivedAt: true,
          clientId: true,
          visitorId: true,
          sessionId: true,
          decisionId: true,
          experimentKey: true,
          productId: true,
          checkoutToken: true,
          shopifyOrderId: true,
          consentState: true,
          payloadJson: true,
        },
      }),
    budget,
  );
  const decisionIds = [
    ...legacyAttributions.map((attribution) => attribution.decisionId),
    ...directCommerceEvents.flatMap((event) =>
      event.decisionId ? [event.decisionId] : [],
    ),
  ];
  const decisions = await readIdChunks(
    decisionIds,
    (ids, cursor) =>
      args.tx.decision.findMany({
        where: { merchantId: args.merchantId, id: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          experimentId: true,
          assignmentId: true,
          productId: true,
          experienceVersionId: true,
          sessionId: true,
          visitorId: true,
          arm: true,
          policy: true,
          acquisitionAngle: true,
          mappingVersion: true,
          reason: true,
          consentState: true,
          occurredAt: true,
          receivedAt: true,
          deploymentRevision: true,
        },
      }),
    budget,
  );
  const linkedNonOrderEvents = await readIdChunks(
    decisions.map((decision) => decision.id),
    (ids, cursor) =>
      args.tx.commerceEvent.findMany({
        where: {
          merchantId: args.merchantId,
          decisionId: { in: ids },
          shopifyOrderId: null,
          // Checkout values without an exact order identifier cannot be proven
          // to belong to the requested order, even when a decision is shared.
          eventType: { notIn: ["checkout_started", "checkout_completed"] },
        },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          eventId: true,
          source: true,
          eventType: true,
          occurredAt: true,
          receivedAt: true,
          clientId: true,
          visitorId: true,
          sessionId: true,
          decisionId: true,
          experimentKey: true,
          productId: true,
          checkoutToken: true,
          shopifyOrderId: true,
          consentState: true,
          payloadJson: true,
        },
      }),
    budget,
  );
  const renderEvents = await readIdChunks(
    decisions.map((decision) => decision.id),
    (ids, cursor) =>
      args.tx.renderEvent.findMany({
        where: { merchantId: args.merchantId, decisionId: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          eventId: true,
          decisionId: true,
          status: true,
          errorCode: true,
          occurredAt: true,
          receivedAt: true,
        },
      }),
    budget,
  );

  const assignmentIds = [
    ...legacyAttributions.map((item) => item.assignmentId),
    ...v2Attributions.map((item) => item.assignmentId),
    ...revisionLinks.map((item) => item.assignmentId),
    ...decisions.flatMap((item) =>
      item.assignmentId ? [item.assignmentId] : [],
    ),
  ];
  const assignments = await readIdChunks(
    assignmentIds,
    (ids, cursor) =>
      args.tx.assignment.findMany({
        where: { merchantId: args.merchantId, id: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          experimentId: true,
          randomizationUnitId: true,
          randomizationUnitType: true,
          arm: true,
          consentState: true,
          assignedAt: true,
          expiresAt: true,
          visitorHash: true,
          eligibilityVersion: true,
          consentPolicyVersion: true,
        },
      }),
    budget,
  );
  const visitorOutcomes = await readIdChunks(
    assignments.map((assignment) => assignment.id),
    (ids, cursor) =>
      args.tx.visitorOutcome.findMany({
        where: { merchantId: args.merchantId, assignmentId: { in: ids } },
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          experimentId: true,
          assignmentId: true,
          projectionVersion: true,
          updatedAt: true,
        },
      }),
    budget,
  );

  const legacyOrderById = new Map(
    legacyOrders.map((order) => [order.id, order]),
  );
  const v2OrderById = new Map(v2Orders.map((order) => [order.id, order]));
  const v2LineById = new Map(v2Lines.map((line) => [line.id, line]));
  const revisionById = new Map(
    revisions.map((revision) => [revision.id, revision]),
  );
  const decisionOrders = new Map<string, Set<string>>();
  const assignmentOrders = new Map<string, Set<string>>();
  for (const attribution of legacyAttributions) {
    const order = legacyOrderById.get(attribution.orderId);
    if (!order) continue;
    addLink(decisionOrders, attribution.decisionId, order.shopifyOrderId);
    addLink(assignmentOrders, attribution.assignmentId, order.shopifyOrderId);
  }
  for (const attribution of v2Attributions) {
    const line = v2LineById.get(attribution.orderLineId);
    const order = line ? v2OrderById.get(line.orderId) : null;
    if (order)
      addLink(assignmentOrders, attribution.assignmentId, order.shopifyOrderId);
  }
  for (const link of revisionLinks) {
    const revision = revisionById.get(link.revisionId);
    if (revision)
      addLink(assignmentOrders, link.assignmentId, revision.shopifyOrderId);
  }
  for (const event of directCommerceEvents) {
    if (event.decisionId && event.shopifyOrderId)
      addLink(decisionOrders, event.decisionId, event.shopifyOrderId);
  }
  for (const decision of decisions) {
    if (!decision.assignmentId) continue;
    for (const orderId of idsFor(decisionOrders, decision.id))
      addLink(assignmentOrders, decision.assignmentId, orderId);
  }

  const commerceEvents = [...directCommerceEvents, ...linkedNonOrderEvents]
    .filter(
      (event, index, all) =>
        all.findIndex((candidate) => candidate.id === event.id) === index,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const found = new Set([
    ...legacyOrders.map((order) => order.shopifyOrderId),
    ...v2Orders.map((order) => order.shopifyOrderId),
    ...revisions.map((revision) => revision.shopifyOrderId),
    ...v2Refunds.map((refund) => refund.shopifyOrderId),
    ...directCommerceEvents.flatMap((event) =>
      event.shopifyOrderId ? [event.shopifyOrderId] : [],
    ),
  ]);

  const records = orderIds.map((shopifyOrderId) => {
    const legacy = legacyOrders.filter(
      (order) => order.shopifyOrderId === shopifyOrderId,
    );
    const legacyInternalIds = new Set(legacy.map((order) => order.id));
    const currentV2 = v2Orders.filter(
      (order) => order.shopifyOrderId === shopifyOrderId,
    );
    const v2InternalIds = new Set(currentV2.map((order) => order.id));
    const lines = v2Lines.filter((line) => v2InternalIds.has(line.orderId));
    const lineIds = new Set(lines.map((line) => line.id));
    const orderRevisions = revisions.filter(
      (revision) => revision.shopifyOrderId === shopifyOrderId,
    );
    const revisionIds = new Set(orderRevisions.map((revision) => revision.id));
    const orderDecisionIds = new Set(
      [...decisionOrders.entries()]
        .filter(([, linkedOrders]) => linkedOrders.has(shopifyOrderId))
        .map(([id]) => id),
    );
    const orderAssignmentIds = new Set(
      [...assignmentOrders.entries()]
        .filter(([, linkedOrders]) => linkedOrders.has(shopifyOrderId))
        .map(([id]) => id),
    );
    return {
      shopifyOrderId,
      found: found.has(shopifyOrderId),
      legacy: {
        orders: legacy.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          currencyCode: order.currencyCode,
          grossAmount: order.grossAmount.toString(),
          netAmount: order.netAmount.toString(),
          financialStatus: order.financialStatus,
          cancelledAt: iso(order.cancelledAt),
          occurredAt: iso(order.occurredAt),
          metadata: safeJsonObject(order.payloadJson, LEGACY_ORDER_METADATA),
          createdAt: iso(order.createdAt),
          updatedAt: iso(order.updatedAt),
        })),
        refunds: legacyRefunds
          .filter((refund) => legacyInternalIds.has(refund.orderId))
          .map((refund) => ({
            id: refund.id,
            orderId: refund.orderId,
            shopifyRefundId: refund.shopifyRefundId,
            amount: refund.amount.toString(),
            currencyCode: refund.currencyCode,
            occurredAt: iso(refund.occurredAt),
            metadata: safeJsonObject(
              refund.payloadJson,
              LEGACY_REFUND_METADATA,
            ),
            createdAt: iso(refund.createdAt),
          })),
        attributions: legacyAttributions
          .filter((attribution) => legacyInternalIds.has(attribution.orderId))
          .map((attribution) => ({
            id: attribution.id,
            orderId: attribution.orderId,
            experimentId: attribution.experimentId,
            assignmentId: attribution.assignmentId,
            decisionId: attribution.decisionId,
            joinMethod: attribution.joinMethod,
            joinedAt: iso(attribution.joinedAt),
          })),
      },
      v2: {
        orders: currentV2.map((order) => ({
          id: order.id,
          shopifyCreatedAt: iso(order.shopifyCreatedAt),
          sourceUpdatedAt: iso(order.sourceUpdatedAt),
          shopCurrency: order.shopCurrency,
          originalObligationMinor: order.originalObligationMinor,
          paymentState: order.paymentState,
          test: order.test,
          cancelledAt: iso(order.cancelledAt),
          reconciliationState: order.reconciliationState,
          sourceWatermark: order.sourceWatermark,
          completeness: safeJsonObject(
            order.completenessJson,
            new Set([
              "graphQlErrors",
              "lines",
              "refundChildren",
              "refunds",
              "transactions",
            ]),
          ),
          createdAt: iso(order.createdAt),
          updatedAt: iso(order.updatedAt),
        })),
        lines: lines.map((line) => ({
          id: line.id,
          orderId: line.orderId,
          shopifyLineItemId: line.shopifyLineItemId,
          shopifyProductId: line.shopifyProductId,
          shopifyVariantId: line.shopifyVariantId,
          merchandiseAfterDiscountMinor: line.merchandiseAfterDiscountMinor,
          currencyCode: line.currencyCode,
          giftCardProduct: line.giftCardProduct,
          allocationState: line.allocationState,
        })),
        refunds: v2Refunds
          .filter((refund) => refund.shopifyOrderId === shopifyOrderId)
          .map((refund) => ({
            id: refund.id,
            orderId: refund.orderId,
            shopifyRefundId: refund.shopifyRefundId,
            shopifyTransactionId: refund.shopifyTransactionId,
            shopifyLineItemId: refund.shopifyLineItemId,
            amountMinor: refund.amountMinor,
            currencyCode: refund.currencyCode,
            sourceOccurredAt: iso(refund.sourceOccurredAt),
            allocationState: refund.allocationState,
            createdAt: iso(refund.createdAt),
          })),
        attributions: v2Attributions
          .filter((attribution) => lineIds.has(attribution.orderLineId))
          .map((attribution) => ({
            id: attribution.id,
            orderLineId: attribution.orderLineId,
            assignmentId: attribution.assignmentId,
            experimentId: attribution.experimentId,
            joinMethod: attribution.joinMethod,
            validAt: iso(attribution.validAt),
            reason: attribution.reason,
            status: attribution.status,
            correctedAt: iso(attribution.correctedAt),
            createdAt: iso(attribution.createdAt),
          })),
      },
      immutableFinancialRevisions: orderRevisions.map((revision) => ({
        id: revision.id,
        sourceUpdatedAt: iso(revision.sourceUpdatedAt),
        firstObservedAt: iso(revision.firstObservedAt),
        revisionHash: revision.revisionHash,
        createdAt: iso(revision.createdAt),
        financialSnapshot: canonicalFinancialView(
          revision.canonicalPayload,
          shopifyOrderId,
        ),
        signedAssignmentReferencesOmitted: true,
        links: revisionLinks
          .filter((link) => revisionIds.has(link.revisionId))
          .filter((link) => link.revisionId === revision.id)
          .map((link) => ({
            id: link.id,
            revisionId: link.revisionId,
            experimentId: link.experimentId,
            assignmentId: link.assignmentId,
            shopifyLineId: link.shopifyLineId,
          })),
      })),
      measurement: {
        decisions: decisions
          .filter((decision) => orderDecisionIds.has(decision.id))
          .map((decision) => ({
            id: decision.id,
            experimentId: decision.experimentId,
            assignmentId: decision.assignmentId,
            productId: decision.productId,
            experienceVersionId: decision.experienceVersionId,
            sessionId: decision.sessionId,
            visitorId: decision.visitorId,
            arm: decision.arm,
            policy: decision.policy,
            acquisitionAngle: decision.acquisitionAngle,
            mappingVersion: decision.mappingVersion,
            reason: decision.reason,
            consentState: decision.consentState,
            occurredAt: iso(decision.occurredAt),
            receivedAt: iso(decision.receivedAt),
            deploymentRevision: decision.deploymentRevision,
          })),
        assignments: assignments
          .filter((assignment) => orderAssignmentIds.has(assignment.id))
          .map((assignment) => ({
            id: assignment.id,
            experimentId: assignment.experimentId,
            randomizationUnitId: assignment.randomizationUnitId,
            randomizationUnitType: assignment.randomizationUnitType,
            arm: assignment.arm,
            consentState: assignment.consentState,
            assignedAt: iso(assignment.assignedAt),
            expiresAt: iso(assignment.expiresAt),
            visitorHash: assignment.visitorHash,
            eligibilityVersion: assignment.eligibilityVersion,
            consentPolicyVersion: assignment.consentPolicyVersion,
          })),
        visitorOutcomes: visitorOutcomes
          .filter((outcome) => orderAssignmentIds.has(outcome.assignmentId))
          .map((outcome) => ({
            id: outcome.id,
            experimentId: outcome.experimentId,
            assignmentId: outcome.assignmentId,
            projectionVersion: outcome.projectionVersion,
            updatedAt: iso(outcome.updatedAt),
            aggregateMetricsOmitted: true,
            omissionReason: "MAY_INCLUDE_UNRELATED_ORDERS_OR_SESSIONS",
          })),
        renderEvents: renderEvents
          .filter((event) => orderDecisionIds.has(event.decisionId))
          .map((event) => ({
            id: event.id,
            eventId: event.eventId,
            decisionId: event.decisionId,
            status: event.status,
            errorCode: event.errorCode,
            occurredAt: iso(event.occurredAt),
            receivedAt: iso(event.receivedAt),
          })),
        commerceEvents: commerceEvents
          .filter(
            (event) =>
              event.shopifyOrderId === shopifyOrderId ||
              (event.shopifyOrderId === null &&
                event.decisionId !== null &&
                orderDecisionIds.has(event.decisionId)),
          )
          .map((event) => ({
            id: event.id,
            eventId: event.eventId,
            source: event.source,
            eventType: event.eventType,
            occurredAt: iso(event.occurredAt),
            receivedAt: iso(event.receivedAt),
            clientId: event.clientId,
            visitorId: event.visitorId,
            sessionId: event.sessionId,
            decisionId: event.decisionId,
            experimentKey: event.experimentKey,
            productId: event.productId,
            checkoutToken: event.checkoutToken,
            shopifyOrderId: event.shopifyOrderId,
            consentState: event.consentState,
            data: safeJsonObject(event.payloadJson, EVENT_DATA),
          })),
      },
    };
  });

  return {
    schemaVersion: "pagnetic-customer-privacy-export-v1",
    merchantId: args.merchantId,
    requestedOrderIds: orderIds,
    missingOrderIds: orderIds.filter((orderId) => !found.has(orderId)),
    records,
    limits: {
      maximumOrdersPerBatch: MAX_ORDERS,
      maximumRowsPerRead: PAGE_SIZE,
      maximumSourceRowsPerCall: MAX_SOURCE_ROWS,
      maximumSourceBytesPerCall: MAX_SOURCE_BYTES,
      maximumCanonicalPayloadBytes: MAX_CANONICAL_PAYLOAD_BYTES,
      exactOrderScopeOnly: true,
      canonicalFinancialPayloadSanitized: true,
      visitorOutcomeAggregateMetricsOmitted: true,
      externalDeliveryPerformed: false,
    },
  };
}

import type { Prisma } from "@prisma/client";
import { collectCustomerPrivacyExport } from "./customer-privacy-export.server";
import type { PrivacyIdentity, PrivacyIdentityKind } from "./identity-privacy-guard.server";

const MAX_GRAPH_ROWS = 5_000;
const PAGE_SIZE = 500;
type AssignmentRow = { id: string; experimentId: string; randomizationUnitId: string; randomizationUnitType: string; visitorHash: string | null };
type DecisionRow = { id: string; assignmentId: string | null; experimentId: string | null; visitorId: string | null; sessionId: string };
type EventRow = { id: string; eventId: string; decisionId: string | null; visitorId: string | null; sessionId: string | null;
  clientId: string | null; checkoutToken: string | null; shopifyOrderId: string | null };

export function privacyChunks<T>(values: Iterable<T>, size = 100) {
  const list = [...values];
  const batches: T[][] = [];
  for (let index = 0; index < list.length; index += size) batches.push(list.slice(index, index + size));
  return batches;
}

async function pages<T extends { id: string }>(load: (cursor?: string) => Promise<T[]>, visit: (row: T) => void) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await load(cursor);
    for (const row of rows) visit(row);
    if (rows.length < PAGE_SIZE) return;
    const next = rows[rows.length - 1]?.id;
    if (!next || next === cursor) throw new Error("PRIVACY_GRAPH_CURSOR_INVALID");
    cursor = next;
  }
}

// Discover all connected persisted identities before deleting any join. A shared
// identity linked to an order outside Shopify's authorized scope requires review;
// it cannot silently widen a request to another customer's purchase.
export async function discoverCustomerPrivacyGraph(args: {
  tx: Prisma.TransactionClient; merchantId: string; orderId: string; authorizedOrderIds: string[];
}) {
  const { tx, merchantId } = args;
  const authorized = new Set(args.authorizedOrderIds);
  if (!authorized.has(args.orderId)) throw new Error("PRIVACY_GRAPH_SCOPE_INVALID");
  const seed = (await collectCustomerPrivacyExport({ tx, merchantId, orderIds: [args.orderId] })).records[0];
  const assignmentIds = new Set(seed.measurement.assignments.map((row) => row.id));
  const decisionIds = new Set(seed.measurement.decisions.map((row) => row.id));
  const assignments = new Map<string, AssignmentRow>();
  const decisions = new Map<string, DecisionRow>();
  const events = new Map<string, EventRow>();
  const identities = new Map<string, PrivacyIdentity>();
  const experiments = new Set<string>();
  const addIdentity = (kind: PrivacyIdentityKind, value: string | null) => {
    if (value) identities.set(`${kind}\0${value}`, { kind, value });
  };
  const values = (kind: PrivacyIdentityKind) => [...identities.values()].filter((row) => row.kind === kind).map((row) => row.value);
  const assertSize = () => {
    if (assignments.size + decisions.size + events.size + identities.size > MAX_GRAPH_ROWS)
      throw new Error("PRIVACY_GRAPH_TOO_LARGE");
  };
  const assignment = (row: AssignmentRow) => {
    assignments.set(row.id, row); assignmentIds.add(row.id); experiments.add(row.experimentId);
    addIdentity("ASSIGNMENT", row.id); addIdentity("VISITOR", row.visitorHash);
    addIdentity(row.randomizationUnitType === "SESSION" ? "SESSION" : "VISITOR", row.randomizationUnitId);
    assertSize();
  };
  const decision = (row: DecisionRow) => {
    decisions.set(row.id, row); decisionIds.add(row.id);
    if (row.assignmentId) assignmentIds.add(row.assignmentId);
    if (row.experimentId) experiments.add(row.experimentId);
    addIdentity("DECISION", row.id); addIdentity("VISITOR", row.visitorId); addIdentity("SESSION", row.sessionId);
    assertSize();
  };
  const event = (row: EventRow) => {
    if (row.shopifyOrderId && !authorized.has(row.shopifyOrderId)) throw new Error("PRIVACY_GRAPH_SHARED_ORDER_REVIEW");
    events.set(row.id, row); if (row.decisionId) decisionIds.add(row.decisionId);
    addIdentity("EVENT", row.eventId); addIdentity("CLIENT", row.clientId); addIdentity("VISITOR", row.visitorId);
    addIdentity("SESSION", row.sessionId); addIdentity("CHECKOUT", row.checkoutToken); assertSize();
  };
  seed.measurement.assignments.forEach(assignment);
  seed.measurement.decisions.forEach(decision);
  seed.measurement.commerceEvents.forEach(event);
  let stable = false;
  for (let round = 0; round < 32; round++) {
    const before = assignments.size + decisions.size + events.size + identities.size + assignmentIds.size + decisionIds.size;
    const assignmentFilters: Prisma.AssignmentWhereInput[] = [
      ...privacyChunks(assignmentIds).map((ids) => ({ id: { in: ids } })),
      ...privacyChunks(values("VISITOR")).flatMap((ids) => [{ visitorHash: { in: ids } }, { randomizationUnitId: { in: ids } }]),
      ...privacyChunks(values("SESSION")).map((ids) => ({ randomizationUnitId: { in: ids }, randomizationUnitType: "SESSION" })),
    ];
    for (const filter of assignmentFilters) await pages((cursor) => tx.assignment.findMany({
      where: { merchantId, ...filter }, orderBy: { id: "asc" }, take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, experimentId: true, randomizationUnitId: true, randomizationUnitType: true, visitorHash: true },
    }), assignment);
    const decisionFilters: Prisma.DecisionWhereInput[] = [
      ...privacyChunks(decisionIds).map((ids) => ({ id: { in: ids } })),
      ...privacyChunks(assignmentIds).map((ids) => ({ assignmentId: { in: ids } })),
      ...privacyChunks(values("VISITOR")).map((ids) => ({ visitorId: { in: ids } })),
      ...privacyChunks(values("SESSION")).map((ids) => ({ sessionId: { in: ids } })),
    ];
    for (const filter of decisionFilters) await pages((cursor) => tx.decision.findMany({
      where: { merchantId, ...filter }, orderBy: { id: "asc" }, take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, assignmentId: true, experimentId: true, visitorId: true, sessionId: true },
    }), decision);
    const eventFilters: Prisma.CommerceEventWhereInput[] = [
      { shopifyOrderId: args.orderId },
      ...privacyChunks(decisionIds).map((ids) => ({ decisionId: { in: ids } })),
      ...privacyChunks(values("VISITOR")).map((ids) => ({ visitorId: { in: ids } })),
      ...privacyChunks(values("SESSION")).map((ids) => ({ sessionId: { in: ids } })),
      ...privacyChunks(values("CLIENT")).map((ids) => ({ clientId: { in: ids } })),
      ...privacyChunks(values("CHECKOUT")).map((ids) => ({ checkoutToken: { in: ids } })),
    ];
    for (const filter of eventFilters) await pages((cursor) => tx.commerceEvent.findMany({
      where: { merchantId, ...filter }, orderBy: { id: "asc" }, take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, eventId: true, decisionId: true, visitorId: true, sessionId: true,
        clientId: true, checkoutToken: true, shopifyOrderId: true },
    }), event);
    const after = assignments.size + decisions.size + events.size + identities.size + assignmentIds.size + decisionIds.size;
    if (before === after) { stable = true; break; }
  }
  if (!stable) throw new Error("PRIVACY_GRAPH_TOO_LARGE");
  const checkOrder = (orderId: string) => {
    if (!authorized.has(orderId)) throw new Error("PRIVACY_GRAPH_SHARED_ORDER_REVIEW");
  };
  for (const ids of privacyChunks(assignmentIds)) {
    await pages((cursor) => tx.orderAttribution.findMany({ where: { merchantId, assignmentId: { in: ids } },
      orderBy: { id: "asc" }, take: PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, order: { select: { shopifyOrderId: true } } },
    }), (row) => checkOrder(row.order.shopifyOrderId));
    await pages((cursor) => tx.attributionV2.findMany({ where: { merchantId, assignmentId: { in: ids } },
      orderBy: { id: "asc" }, take: PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, orderLine: { select: { order: { select: { shopifyOrderId: true } } } } },
    }), (row) => checkOrder(row.orderLine.order.shopifyOrderId));
    await pages((cursor) => tx.financialRevisionLink.findMany({ where: { merchantId, assignmentId: { in: ids } },
      orderBy: { id: "asc" }, take: PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, revision: { select: { shopifyOrderId: true } } },
    }), (row) => checkOrder(row.revision.shopifyOrderId));
  }
  return {
    version: 1 as const, merchantId, orderId: args.orderId,
    assignmentIds: [...assignmentIds].sort(), decisionIds: [...decisionIds].sort(),
    eventIds: [...events.keys()].sort(), experimentIds: [...experiments].sort(),
    identities: [...identities.values()].sort((a, b) => `${a.kind}:${a.value}`.localeCompare(`${b.kind}:${b.value}`)),
    financialRecordIds: [...seed.legacy.orders, ...seed.legacy.refunds, ...seed.legacy.attributions,
      ...seed.v2.orders, ...seed.v2.lines, ...seed.v2.refunds, ...seed.v2.attributions, ...seed.immutableFinancialRevisions]
      .map((row) => row.id).sort(),
  };
}

export type CustomerPrivacyGraph = Awaited<ReturnType<typeof discoverCustomerPrivacyGraph>>;

import type { PrismaClient } from "@prisma/client";

import { assessExperimentHealthV2, type V2HealthInput } from "./experiment-health-v2";
import { loadFinancialAsOfV2 } from "./financial-as-of-v2.server";
import { financialReconciliationReadinessV2 } from "./experiment-lifecycle-v2.server";

export async function loadExperimentHealthV2(args: {
  db: PrismaClient; merchantId: string; experimentId: string; now?: Date;
  financial?: { linkedEligibleOrders: number; reconciledLinkedOrders: number; contradictoryLinks: number };
}) {
  const now = args.now ?? new Date();
  const experiment = await args.db.experiment.findFirstOrThrow({
    where: { id: args.experimentId, merchantId: args.merchantId, lifecycleVersion: 2 },
    include: { product: true, assignments: true,
      decisions: { include: { renderEvents: true, commerceEvents: true } } },
  });
  const end = experiment.attributionClosesAt && experiment.attributionClosesAt < now ? experiment.attributionClosesAt : now;
  const events = await args.db.commerceEvent.findMany({
    where: { merchantId: args.merchantId, productId: experiment.product.shopifyProductId,
      eventType: "checkout_completed", consentState: "analytics_and_preferences_allowed",
      occurredAt: { gte: experiment.enrollmentStartedAt ?? experiment.startedAt, lte: end } },
    include: { decision: { select: { assignmentId: true, experimentId: true } } },
  });
  const orders = await args.db.orderLedger.findMany({
    where: { merchantId: args.merchantId, shopifyCreatedAt: { gte: experiment.enrollmentStartedAt ?? experiment.startedAt, lte: end },
      lines: { some: { shopifyProductId: experiment.product.shopifyProductId } } },
    include: { lines: { include: { attributions: { where: { merchantId: args.merchantId, experimentId: experiment.id,
      status: { in: ["ACTIVE", "FINANCIAL_PENDING", "TEST_ONLY"] } } } } } },
  });
  const orderById = new Map(orders.map((order) => [order.shopifyOrderId, order]));
  const linkedAssignment = (order: typeof orders[number] | undefined) => {
    const ids = [...new Set(order?.lines.flatMap((line) => line.attributions.map((item) => item.assignmentId)) ?? [])];
    return ids.length === 1 ? ids[0]! : null;
  };
  let contradictoryOrderLinks = orders.filter((order) => new Set(order.lines.flatMap((line) => line.attributions.map((item) => item.assignmentId))).size > 1).length;
  const orderByCheckout = new Map<string, string>();
  for (const event of events) if (event.checkoutToken && event.shopifyOrderId) {
    if (orderByCheckout.has(event.checkoutToken) && orderByCheckout.get(event.checkoutToken) !== event.shopifyOrderId)
      contradictoryOrderLinks += 1;
    orderByCheckout.set(event.checkoutToken, event.shopifyOrderId);
  }
  const checkouts: V2HealthInput["checkouts"] = [];
  let missingObservableIdentity = 0;
  for (const event of events) {
    const orderId = event.shopifyOrderId ?? (event.checkoutToken ? orderByCheckout.get(event.checkoutToken) : null);
    const identity = orderId ? `order:${orderId}` : event.checkoutToken ? `checkout:${event.checkoutToken}` : null;
    if (!identity) { missingObservableIdentity += 1; continue; }
    const order = orderId ? orderById.get(orderId) : undefined;
    checkouts.push({ identity,
      assignmentId: event.decision?.experimentId === experiment.id ? event.decision.assignmentId : null,
      linkedAssignmentId: linkedAssignment(order), test: order?.test ?? false });
  }
  // Server orders remain observable even when thank-you-page pixels never load.
  // Union them with ALL observed pixel outcomes, including missing-link cases.
  for (const order of orders) {
    const assignmentId = linkedAssignment(order);
    if (!assignmentId) continue;
    checkouts.push({ identity: `order:${order.shopifyOrderId}`, assignmentId, linkedAssignmentId: assignmentId, test: order.test });
  }
  const financial = args.financial ?? (experiment.financialMaturityAt
    ? await loadFinancialAsOfV2({ ...args, cutoff: experiment.financialMaturityAt })
    : await financialReconciliationReadinessV2(args));
  const result = assessExperimentHealthV2({
    now,
    assignments: experiment.assignments.map((item) => {
      if (item.arm !== "ORIGINAL" && item.arm !== "MATCHED") throw new Error("V2_HEALTH_ASSIGNMENT_ARM_INVALID");
      return { id: item.id, arm: item.arm };
    }),
    decisions: experiment.decisions.filter((item) => item.assignmentId).map((item) => ({
      id: item.id, assignmentId: item.assignmentId!, policy: item.policy, occurredAt: item.occurredAt,
    })),
    bridgeDecisionIds: experiment.decisions.flatMap((decision) => decision.commerceEvents.filter((event) =>
      ["adaptive_storefront_decision", "adaptive_storefront:decision"].includes(event.eventType) &&
      event.consentState === "analytics_and_preferences_allowed").map(() => decision.id)),
    renders: experiment.decisions.flatMap((decision) => decision.renderEvents.map((event) => ({ decisionId: decision.id, status: event.status }))),
    checkouts, linkedEligibleOrders: financial.linkedEligibleOrders,
    reconciledLinkedOrders: financial.reconciledLinkedOrders,
    contradictoryLinks: financial.contradictoryLinks + contradictoryOrderLinks,
    unassignedFocalOrders: orders.filter((order) => !order.test && !linkedAssignment(order)).length,
  });
  if (missingObservableIdentity) {
    result.reasons.push("CHECKOUT_OBSERVATION_IDENTITY_MISSING");
    result.state = "INVALID";
  }
  return { ...result, missingObservableIdentity,
    sources: { pixelCheckoutEvents: events.length, focalServerOrders: orders.filter((order) => !order.test).length } };
}

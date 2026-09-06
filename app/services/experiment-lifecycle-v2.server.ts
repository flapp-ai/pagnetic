import type { Prisma, PrismaClient } from "@prisma/client";

import { V2_CHECKOUT_ARM_FLOOR } from "./experiment-health-v2";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "./mvp-v2";
import { assertPrivacyAnalysisUsable } from "./privacy-analysis.server";

const DAY_MS = 86_400_000;

function validStopReason(value: string | null | undefined) {
  if (value == null) return null;
  if (!["MERCHANT_PAUSE", "SAFETY_STOP", "OWNER_STOP"].includes(value))
    throw new Error("V2_STOP_REASON_INVALID");
  return value;
}

async function observableCheckoutCountsByArm(args: {
  tx: Prisma.TransactionClient;
  merchantId: string;
  experimentId: string;
  shopifyProductId: string;
  startedAt: Date;
  through: Date;
  assignments: Array<{ id: string; arm: string }>;
}) {
  const assignmentArms = new Map(
    args.assignments.map((item) => [item.id, item.arm]),
  );
  const events = await args.tx.commerceEvent.findMany({
    where: {
      merchantId: args.merchantId,
      productId: args.shopifyProductId,
      eventType: "checkout_completed",
      consentState: "analytics_and_preferences_allowed",
      occurredAt: { gte: args.startedAt, lte: args.through },
    },
    include: {
      decision: { select: { assignmentId: true, experimentId: true } },
    },
  });
  const orders = await args.tx.orderLedger.findMany({
    where: {
      merchantId: args.merchantId,
      shopifyCreatedAt: { gte: args.startedAt, lte: args.through },
      lines: { some: { shopifyProductId: args.shopifyProductId } },
    },
    include: {
      lines: {
        include: {
          attributions: {
            where: {
              merchantId: args.merchantId,
              experimentId: args.experimentId,
              status: { in: ["ACTIVE", "FINANCIAL_PENDING"] },
            },
          },
        },
      },
    },
  });
  const ordersById = new Map(
    orders.map((order) => [order.shopifyOrderId, order]),
  );
  const ordersByCheckout = new Map<string, string>();
  for (const event of events) {
    if (
      event.checkoutToken &&
      event.shopifyOrderId &&
      !ordersByCheckout.has(event.checkoutToken)
    ) {
      ordersByCheckout.set(event.checkoutToken, event.shopifyOrderId);
    }
  }
  const orderAssignment = (order: (typeof orders)[number] | undefined) => {
    const ids = [
      ...new Set(
        order?.lines.flatMap((line) =>
          line.attributions.map((item) => item.assignmentId),
        ) ?? [],
      ),
    ];
    return ids.length === 1 ? ids[0]! : null;
  };
  const observations = new Map<
    string,
    { assignmentId: string | null; test: boolean }
  >();
  const addObservation = (
    identity: string,
    assignmentId: string | null,
    test: boolean,
  ) => {
    const prior = observations.get(identity);
    observations.set(identity, {
      assignmentId:
        prior?.assignmentId &&
        assignmentId &&
        prior.assignmentId !== assignmentId
          ? null
          : (assignmentId ?? prior?.assignmentId ?? null),
      test: prior?.test === true || test,
    });
  };
  for (const event of events) {
    const orderId =
      event.shopifyOrderId ??
      (event.checkoutToken ? ordersByCheckout.get(event.checkoutToken) : null);
    const identity = orderId
      ? `order:${orderId}`
      : event.checkoutToken
        ? `checkout:${event.checkoutToken}`
        : null;
    if (!identity) continue;
    const order = orderId ? ordersById.get(orderId) : undefined;
    addObservation(
      identity,
      event.decision?.experimentId === args.experimentId
        ? event.decision.assignmentId
        : null,
      order?.test ?? false,
    );
  }
  for (const order of orders) {
    const assignmentId = orderAssignment(order);
    if (assignmentId) {
      addObservation(`order:${order.shopifyOrderId}`, assignmentId, order.test);
    }
  }
  const counts = { ORIGINAL: 0, MATCHED: 0 };
  for (const observation of observations.values()) {
    if (observation.test || !observation.assignmentId) continue;
    const arm = assignmentArms.get(observation.assignmentId);
    if (arm === "ORIGINAL" || arm === "MATCHED") counts[arm] += 1;
  }
  return counts;
}

export async function closeV2EnrollmentIfDue(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  now?: Date;
  stopReason?: string | null;
}) {
  const now = args.now ?? new Date();
  const requestedStop = validStopReason(args.stopReason);
  return args.db.$transaction(async (tx) => {
    // Enrollment decisions take this same row lock before creating assignments.
    // Acquire it before reading the cohort, not only when writing its cutoff:
    // READ COMMITTED PostgreSQL otherwise permits a newly committed assignment
    // to be omitted from the frozen maximum attribution expiry.
    await tx.experiment.updateMany({
      where: {
        id: args.experimentId,
        merchantId: args.merchantId,
        lifecycleVersion: 2,
        enrollmentClosedAt: null,
        privacyAffectedAt: null,
      },
      data: { lifecycleVersion: 2 },
    });
    const experiment = await tx.experiment.findFirst({
      where: { id: args.experimentId, merchantId: args.merchantId },
      include: {
        registration: true,
        product: { select: { shopifyProductId: true } },
        assignments: { select: { id: true, arm: true, expiresAt: true } },
      },
    });
    if (!experiment?.registration)
      throw new Error("V2_EXPERIMENT_REGISTRATION_MISSING");
    if (
      experiment.registration.protocolVersion !== MVP_V2_PROTOCOL_VERSION ||
      experiment.registration.primaryMetric !== MVP_V2_PRIMARY_METRIC ||
      experiment.lifecycleVersion !== 2
    )
      throw new Error("V2_EXPERIMENT_PROTOCOL_MISMATCH");
    assertPrivacyAnalysisUsable(experiment);
    if (experiment.enrollmentClosedAt) {
      return { phase: "CLOSED" as const, changed: false, experiment };
    }
    const enrollmentStartedAt =
      experiment.enrollmentStartedAt ?? experiment.startedAt;
    const minimumAt = new Date(
      enrollmentStartedAt.getTime() +
        experiment.registration.minimumDurationDays * DAY_MS,
    );
    const deadlineAt = new Date(
      enrollmentStartedAt.getTime() +
        experiment.registration.maximumDurationDays * DAY_MS,
    );
    const targetReached =
      experiment.assignments.length >= experiment.registration.targetSampleSize;
    let fixedBaselineDeadline = false;
    try {
      const guardrails = JSON.parse(experiment.registration.guardrailsJson) as {
        baselineFixedDeadline?: unknown;
      };
      fixedBaselineDeadline = guardrails.baselineFixedDeadline === true;
    } catch {
      fixedBaselineDeadline = false;
    }
    const checkoutCounts =
      targetReached && now >= minimumAt
        ? await observableCheckoutCountsByArm({
            tx,
            merchantId: args.merchantId,
            experimentId: experiment.id,
            shopifyProductId: experiment.product.shopifyProductId,
            startedAt: enrollmentStartedAt,
            through: now,
            assignments: experiment.assignments.map((item) => ({
              id: item.id,
              arm: item.arm,
            })),
          })
        : { ORIGINAL: 0, MATCHED: 0 };
    const checkoutFloorReached =
      checkoutCounts.ORIGINAL >= V2_CHECKOUT_ARM_FLOOR &&
      checkoutCounts.MATCHED >= V2_CHECKOUT_ARM_FLOOR;
    const dueToTarget =
      !fixedBaselineDeadline &&
      targetReached &&
      checkoutFloorReached &&
      now >= minimumAt;
    const dueToDeadline = now >= deadlineAt;
    if (!requestedStop && !dueToTarget && !dueToDeadline) {
      return {
        phase: "ENROLLING" as const,
        changed: false,
        targetReached,
        checkoutFloorReached,
        checkoutCounts,
        minimumAt,
        deadlineAt,
        experiment,
      };
    }
    const closedAt = dueToDeadline && !requestedStop ? deadlineAt : now;
    const attributionClosesAt =
      experiment.assignments.length > 0
        ? experiment.assignments.reduce(
            (latest, assignment) =>
              assignment.expiresAt > latest ? assignment.expiresAt : latest,
            experiment.assignments[0]!.expiresAt,
          )
        : closedAt;
    const financialMaturityAt = new Date(
      attributionClosesAt.getTime() +
        experiment.registration.dataMaturityLagDays * DAY_MS,
    );
    const stopReason =
      requestedStop ??
      (dueToDeadline && !targetReached ? "MAX_DURATION_UNDER_TARGET" : null);
    const updated = await tx.experiment.updateMany({
      where: {
        id: experiment.id,
        merchantId: args.merchantId,
        enrollmentClosedAt: null,
      },
      data: {
        enrollmentClosedAt: closedAt,
        attributionClosesAt,
        financialMaturityAt,
        endedAt: closedAt,
        stopReason,
        status: "ENROLLMENT_CLOSED",
      },
    });
    if (updated.count !== 1) {
      const current = await tx.experiment.findFirstOrThrow({
        where: { id: experiment.id, merchantId: args.merchantId },
        include: { registration: true, assignments: true },
      });
      return { phase: "CLOSED" as const, changed: false, experiment: current };
    }
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: requestedStop ? "MERCHANT" : "SYSTEM",
        action: "V2_EXPERIMENT_ENROLLMENT_CLOSED",
        resourceType: "Experiment",
        resourceId: experiment.id,
        detailsJson: JSON.stringify({
          closedAt: closedAt.toISOString(),
          attributionClosesAt: attributionClosesAt.toISOString(),
          financialMaturityAt: financialMaturityAt.toISOString(),
          actualCohortSize: experiment.assignments.length,
          targetSampleSize: experiment.registration.targetSampleSize,
          checkoutCounts,
          checkoutFloor: V2_CHECKOUT_ARM_FLOOR,
          stopReason,
        }),
      },
    });
    const current = await tx.experiment.findFirstOrThrow({
      where: { id: experiment.id, merchantId: args.merchantId },
      include: { registration: true, assignments: true },
    });
    return { phase: "CLOSED" as const, changed: true, experiment: current };
  });
}

export async function financialReconciliationReadinessV2(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
}) {
  const attributions = await args.db.attributionV2.findMany({
    where: { merchantId: args.merchantId, experimentId: args.experimentId },
    include: { orderLine: { include: { order: true } } },
  });
  const live = attributions.filter((item) => !item.orderLine.order.test);
  const reconciled = live.filter(
    (item) =>
      item.status === "ACTIVE" &&
      item.orderLine.order.reconciliationState === "RECONCILED",
  );
  const contradictions = live.filter(
    (item) =>
      item.orderLine.order.reconciliationState.includes("CONFLICT") ||
      item.orderLine.order.reconciliationState === "SOURCE_CONFLICT",
  );
  return {
    linkedEligibleOrders: new Set(live.map((item) => item.orderLine.orderId))
      .size,
    reconciledLinkedOrders: new Set(
      reconciled.map((item) => item.orderLine.orderId),
    ).size,
    contradictoryLinks: contradictions.length,
    complete: live.length === reconciled.length && contradictions.length === 0,
  };
}

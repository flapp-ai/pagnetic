import type { PrismaClient } from "@prisma/client";

import { assessRuntimeSafety } from "./pilot-safety";

function bounded(value: unknown, maximum: number) {
  return String(value ?? "")
    .trim()
    .slice(0, maximum);
}

export async function setMerchantKillSwitch(args: {
  db: PrismaClient;
  merchantId: string;
  active: boolean;
  reason: string;
  actor: string;
}) {
  const reason = bounded(args.reason, 500);
  if (args.active && reason.length < 5)
    throw new Error("Provide a short kill-switch reason.");
  return args.db.$transaction(async (tx) => {
    const control = await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: {
        merchantId: args.merchantId,
        killSwitch: args.active,
        reason: args.active ? reason : null,
        activatedBy: args.active ? args.actor : null,
        activatedAt: args.active ? new Date() : null,
        clearedBy: args.active ? null : args.actor,
        clearedAt: args.active ? null : new Date(),
      },
      update: {
        killSwitch: args.active,
        reason: args.active ? reason : null,
        activatedBy: args.active ? args.actor : undefined,
        activatedAt: args.active ? new Date() : undefined,
        clearedBy: args.active ? null : args.actor,
        clearedAt: args.active ? null : new Date(),
      },
    });
    if (args.active) {
      await tx.experiment.updateMany({
        where: { merchantId: args.merchantId, status: "ACTIVE" },
        data: { status: "PAUSED", endedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: args.active ? "KILL_SWITCH_ACTIVATED" : "KILL_SWITCH_CLEARED",
        resourceType: "RuntimeControl",
        resourceId: control.id,
        detailsJson: JSON.stringify({ reason: args.active ? reason : null }),
      },
    });
    return control;
  });
}

export async function recordIncident(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId?: string | null;
  severity: string;
  category: string;
  summary: string;
  actor: string;
}) {
  const severity = bounded(args.severity, 16).toUpperCase();
  const category = bounded(args.category, 64).toUpperCase();
  const summary = bounded(args.summary, 500);
  if (!new Set(["SEV1", "SEV2", "SEV3"]).has(severity))
    throw new Error("Select a valid incident severity.");
  if (!category || summary.length < 5)
    throw new Error("Incident category and summary are required.");
  if (args.experimentId) {
    const experiment = await args.db.experiment.findFirst({
      where: { id: args.experimentId, merchantId: args.merchantId },
    });
    if (!experiment) throw new Error("Select a valid experiment.");
  }
  return args.db.incident.create({
    data: {
      merchantId: args.merchantId,
      experimentId: args.experimentId || null,
      severity,
      category,
      summary,
      actor: args.actor,
    },
  });
}

export async function resolveIncident(args: {
  db: PrismaClient;
  merchantId: string;
  incidentId: string;
}) {
  return args.db.incident.updateMany({
    where: { id: args.incidentId, merchantId: args.merchantId, status: "OPEN" },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

export async function recordConfounder(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  eventType: string;
  materiality: string;
  summary: string;
  occurredAt: Date;
  actor: string;
}) {
  const materiality = bounded(args.materiality, 32).toUpperCase();
  if (
    !new Set(["IMMATERIAL", "MODEL_ADJUSTABLE", "INVALIDATING"]).has(
      materiality,
    )
  ) {
    throw new Error("Select a valid confounder materiality.");
  }
  const experiment = await args.db.experiment.findFirst({
    where: { id: args.experimentId, merchantId: args.merchantId },
  });
  if (!experiment) throw new Error("Select a valid experiment.");
  const eventType = bounded(args.eventType, 64).toUpperCase();
  const summary = bounded(args.summary, 500);
  if (
    !eventType ||
    summary.length < 5 ||
    Number.isNaN(args.occurredAt.getTime())
  ) {
    throw new Error(
      "Confounder type, summary, and valid occurrence time are required.",
    );
  }
  return args.db.confounder.create({
    data: {
      merchantId: args.merchantId,
      experimentId: experiment.id,
      eventType,
      materiality,
      summary,
      occurredAt: args.occurredAt,
      recordedBy: args.actor,
    },
  });
}

export async function evaluateExperimentSafety(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  actor: string;
}) {
  const [experiment, control, openSeverityOneIncidents] = await Promise.all([
    args.db.experiment.findFirst({
      where: { id: args.experimentId, merchantId: args.merchantId },
      include: {
        registration: true,
        decisions: { include: { renderEvents: true, commerceEvents: true } },
      },
    }),
    args.db.runtimeControl.findUnique({
      where: { merchantId: args.merchantId },
    }),
    args.db.incident.count({
      where: { merchantId: args.merchantId, status: "OPEN", severity: "SEV1" },
    }),
  ]);
  if (!experiment) throw new Error("Select a valid experiment.");
  const treatmentDecisions = experiment.decisions.filter(
    (decision) => decision.policy !== "ORIGINAL",
  );
  const renderEvents = treatmentDecisions.flatMap(
    (decision) => decision.renderEvents,
  );
  const latencies = experiment.decisions.flatMap((decision) =>
    decision.commerceEvents
      .filter(
        (event) =>
          event.eventType === "adaptive_storefront_decision" ||
          event.eventType === "adaptive_storefront:decision",
      )
      .map((event) => {
        try {
          const value = Number(
            (JSON.parse(event.payloadJson) as Record<string, unknown>)
              .decisionTimeMs,
          );
          return Number.isFinite(value) && value >= 0 ? value : null;
        } catch {
          return null;
        }
      })
      .filter((value): value is number => value != null),
  );
  const serverProcessingLatencies = experiment.decisions.flatMap((decision) =>
    decision.commerceEvents
      .filter(
        (event) =>
          event.eventType === "adaptive_storefront_decision" ||
          event.eventType === "adaptive_storefront:decision",
      )
      .map((event) => {
        try {
          const value = Number(
            (JSON.parse(event.payloadJson) as Record<string, unknown>)
              .serverProcessingMs,
          );
          return Number.isFinite(value) && value >= 0 ? value : null;
        } catch {
          return null;
        }
      })
      .filter((value): value is number => value != null),
  );
  let guardrails: Record<string, unknown> = {};
  try {
    guardrails = JSON.parse(
      experiment.registration?.guardrailsJson ?? "{}",
    ) as Record<string, unknown>;
  } catch {
    /* The frozen registration remains authoritative; invalid values use safe defaults. */
  }
  const registeredDecisionMaximum = Number(
    guardrails.decisionP95MillisecondsMaximum,
  );
  const registeredServerMaximum = Number(
    guardrails.serverProcessingP95MillisecondsMaximum,
  );
  const assessment = assessRuntimeSafety({
    killSwitchActive: control?.killSwitch === true,
    openSeverityOneIncidents,
    renderAttempts: renderEvents.length,
    renderFailures: renderEvents.filter((event) => event.status === "FAILED")
      .length,
    decisionLatenciesMs: latencies,
    serverProcessingLatenciesMs: serverProcessingLatencies,
    thresholds: {
      decisionP95MillisecondsMaximum:
        Number.isFinite(registeredDecisionMaximum) &&
        registeredDecisionMaximum > 0
          ? registeredDecisionMaximum
          : 150,
      serverProcessingP95MillisecondsMaximum:
        Number.isFinite(registeredServerMaximum) && registeredServerMaximum > 0
          ? registeredServerMaximum
          : null,
    },
  });

  return args.db.$transaction(async (tx) => {
    let rollbackTriggered = false;
    if (assessment.rollback && experiment.status === "ACTIVE") {
      await tx.experiment.update({
        where: { id: experiment.id },
        data: { status: "PAUSED", endedAt: new Date() },
      });
      rollbackTriggered = true;
      await tx.incident.create({
        data: {
          merchantId: args.merchantId,
          experimentId: experiment.id,
          severity: "SEV1",
          category: "AUTOMATED_ROLLBACK",
          summary:
            assessment.reasons.join(" ").slice(0, 500) ||
            "Automated safety rollback triggered.",
          detailsJson: JSON.stringify(assessment.metrics),
          actor: args.actor,
        },
      });
    }
    const evaluation = await tx.safetyEvaluation.create({
      data: {
        merchantId: args.merchantId,
        experimentId: experiment.id,
        outcome: assessment.outcome,
        rollbackTriggered,
        metricsJson: JSON.stringify(assessment.metrics),
        reasonsJson: JSON.stringify(assessment.reasons),
      },
    });
    return { evaluation, assessment, rollbackTriggered };
  });
}

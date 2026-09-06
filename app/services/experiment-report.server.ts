import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { reconcileBetaEntitlement } from "./beta-entitlement.server";
import { analyzeExperiment } from "./experiment-analysis";
import {
  assessExperimentHealth,
  readinessFromChecks,
} from "./experiment-health";

export async function loadExperimentReport(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const experiment = await args.db.experiment.findFirst({
    where: { id: args.experimentId, merchantId: args.merchantId },
    include: {
      product: true,
      registration: true,
      assignments: true,
      decisions: { include: { commerceEvents: true, renderEvents: true } },
      orderAttributions: { include: { order: true } },
      confounders: { orderBy: { occurredAt: "asc" } },
      incidents: { orderBy: { detectedAt: "asc" } },
    },
  });
  if (!experiment?.registration)
    throw new Error("The experiment does not have a frozen registration.");
  const observedOrders = await args.db.storeOrder.count({
    where: {
      merchantId: args.merchantId,
      occurredAt: { gte: experiment.startedAt, lte: experiment.endedAt ?? now },
    },
  });
  const decisionsWithPixelEvent = experiment.decisions.filter((decision) =>
    decision.commerceEvents.some(
      (event) =>
        event.eventType === "adaptive_storefront_decision" ||
        event.eventType === "adaptive_storefront:decision",
    ),
  ).length;
  const matchedPolicyDecisions = experiment.decisions.filter(
    (decision) => decision.policy !== "ORIGINAL",
  ).length;
  const renderReports = experiment.decisions.reduce(
    (sum, decision) => sum + decision.renderEvents.length,
    0,
  );
  const controlAssignments = experiment.assignments.filter(
    (assignment) => assignment.arm === "ORIGINAL",
  ).length;
  const checks = assessExperimentHealth({
    totalAssignments: experiment.assignments.length,
    controlAssignments,
    controlPercentage: experiment.controlPercentage,
    decisions: experiment.decisions.length,
    decisionsWithPixelEvent,
    matchedPolicyDecisions,
    renderReports,
    orders: observedOrders,
    attributedOrders: experiment.orderAttributions.length,
  });
  const readiness = readinessFromChecks(checks);
  const registration = experiment.registration;
  const analysis = analyzeExperiment({
    testType:
      experiment.controlPolicy === experiment.treatmentPolicy ? "AA" : "AB",
    startedAt: experiment.startedAt,
    endedAt: experiment.endedAt,
    now,
    healthReadiness: readiness,
    registration: {
      hypothesis: registration.hypothesis,
      revenueDefinition:
        registration.revenueDefinition === "GROSS" ? "GROSS" : "NET",
      minimumMeaningfulLift: registration.minimumMeaningfulLift,
      alpha: registration.alpha,
      targetSampleSize: registration.targetSampleSize,
      minimumDurationDays: registration.minimumDurationDays,
      maximumDurationDays: registration.maximumDurationDays,
      dataMaturityLagDays: registration.dataMaturityLagDays,
    },
    assignments: experiment.assignments.map((assignment) => ({
      id: assignment.id,
      arm: assignment.arm === "MATCHED" ? "MATCHED" : "ORIGINAL",
    })),
    decisions: experiment.decisions.map((decision) => ({
      id: decision.id,
      assignmentId: decision.assignmentId,
      sessionId: decision.sessionId,
    })),
    orders: experiment.orderAttributions.map((attribution) => ({
      assignmentId: attribution.assignmentId,
      decisionId: attribution.decisionId,
      grossAmount: Number(attribution.order.grossAmount),
      netAmount: Number(attribution.order.netAmount),
      currencyCode: attribution.order.currencyCode,
      cancelled: Boolean(attribution.order.cancelledAt),
    })),
  });
  return {
    experiment,
    registration,
    checks,
    readiness,
    analysis,
    observedOrders,
  };
}

function money(value: number, currency: string | null) {
  return `${value.toFixed(2)} ${currency ?? "currency units"}`;
}

export function renderExperimentReport(
  data: Awaited<ReturnType<typeof loadExperimentReport>>,
) {
  const { experiment, registration, checks, readiness, analysis } = data;
  const relative =
    analysis.relativeLift == null
      ? "Not estimable"
      : `${(analysis.relativeLift * 100).toFixed(2)}%`;
  const lines = [
    `# Experiment report: ${experiment.key} v${experiment.version}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Registration hash: \`${registration.registrationHash}\``,
    `Analysis version: \`${registration.analysisVersion}\``,
    `Result state: **${analysis.resultState}** (${analysis.maturity.toLowerCase()})`,
    "",
    "## Decision summary",
    "",
    `${experiment.controlPolicy} versus ${experiment.treatmentPolicy}; data quality is ${readiness.toLowerCase()}.`,
    ...analysis.reasons.map((reason) => `- ${reason}`),
    "",
    "## Registered hypothesis and estimand",
    "",
    registration.hypothesis,
    `Primary metric: ${registration.primaryMetric}; revenue definition: ${registration.revenueDefinition}.`,
    "",
    "## Traffic and arm results",
    "",
    "| Arm | Policy | Assignments | Sessions | Orders | Revenue | RPS | Conversion | AOV |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    `| A | ${experiment.controlPolicy} | ${analysis.control.assignments} | ${analysis.control.sessions} | ${analysis.control.orders} | ${money(analysis.control.revenue, analysis.currencyCode)} | ${analysis.control.revenuePerSession.toFixed(4)} | ${(analysis.control.conversionRate * 100).toFixed(2)}% | ${analysis.control.averageOrderValue.toFixed(2)} |`,
    `| B | ${experiment.treatmentPolicy} | ${analysis.treatment.assignments} | ${analysis.treatment.sessions} | ${analysis.treatment.orders} | ${money(analysis.treatment.revenue, analysis.currencyCode)} | ${analysis.treatment.revenuePerSession.toFixed(4)} | ${(analysis.treatment.conversionRate * 100).toFixed(2)}% | ${analysis.treatment.averageOrderValue.toFixed(2)} |`,
    "",
    "## Primary effect and uncertainty",
    "",
    `Absolute RPS difference: ${money(analysis.absoluteLift, analysis.currencyCode)}.`,
    `Relative RPS lift: ${relative}.`,
    `${(analysis.confidenceLevel * 100).toFixed(0)}% normal cluster-robust interval: ${money(analysis.interval.lower, analysis.currencyCode)} to ${money(analysis.interval.upper, analysis.currencyCode)}.`,
    "",
    "## Data quality",
    "",
    ...checks.map(
      (check) =>
        `- **${check.label}: ${check.status}.** ${check.value}. ${check.detail}`,
    ),
    "",
    "## Confounders and incidents",
    "",
    ...(experiment.confounders.length
      ? experiment.confounders.map(
          (item) =>
            `- ${item.occurredAt.toISOString()} — ${item.materiality} ${item.eventType}: ${item.summary}`,
        )
      : ["- No confounders recorded."]),
    ...(experiment.incidents.length
      ? experiment.incidents.map(
          (item) =>
            `- ${item.detectedAt.toISOString()} — ${item.severity} ${item.status}: ${item.summary}`,
        )
      : ["- No incidents recorded."]),
    "",
    "## Interpretation",
    "",
    analysis.maturity === "MATURE"
      ? `Apply the registered ${analysis.resultState.toLowerCase()} decision rule; do not reinterpret exploratory segments as the primary result.`
      : `This report is preliminary. Do not make a revenue claim before ${analysis.dataMaturityAt.toISOString()} and the sample target are reached.`,
    "",
  ];
  return lines.join("\n");
}

export async function snapshotExperimentReport(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  now?: Date;
}) {
  const report = await loadExperimentReport(args);
  const markdown = renderExperimentReport(report);
  const payload = {
    experimentId: report.experiment.id,
    registrationHash: report.registration.registrationHash,
    analysis: report.analysis,
    checks: report.checks,
    readiness: report.readiness,
    observedOrders: report.observedOrders,
  };
  const payloadJson = JSON.stringify(payload);
  const dataHash = createHash("sha256").update(payloadJson).digest("hex");
  const snapshot = await args.db.experimentResultSnapshot.upsert({
    where: {
      experimentId_dataHash: { experimentId: args.experimentId, dataHash },
    },
    create: {
      experimentId: args.experimentId,
      analysisVersion: report.registration.analysisVersion,
      resultState: report.analysis.resultState,
      dataMaturityAt: report.analysis.dataMaturityAt,
      dataHash,
      payloadJson,
      reportMarkdown: markdown,
    },
    update: {},
  });
  await reconcileBetaEntitlement({
    db: args.db,
    merchantId: args.merchantId,
    snapshotId: snapshot.id,
  });
  return snapshot;
}

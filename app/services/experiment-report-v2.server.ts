import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { analyzeV2Experiment } from "./experiment-analysis-v2";
import { financialReconciliationReadinessV2 } from "./experiment-lifecycle-v2.server";
import { loadFinancialAsOfV2 } from "./financial-as-of-v2.server";
import { loadExperimentHealthV2 } from "./experiment-health-v2.server";
import { canonicalQueuePayload } from "./job-outbox.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "./mvp-v2";
import { assertPrivacyAnalysisUsable } from "./privacy-analysis.server";

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function terminal(state: string) {
  return !["COLLECTING", "MATURING"].includes(state);
}

/** Coverage is measured over assigned eligible visitors, not mapping rows. */
export async function loadAdaptiveCoverage(args: { db: PrismaClient; merchantId: string; experimentId: string }) {
  const [assignments, decisions] = await Promise.all([
    args.db.assignment.findMany({ where: { merchantId: args.merchantId, experimentId: args.experimentId }, select: { id: true, arm: true } }),
    args.db.decision.findMany({
      where: { merchantId: args.merchantId, experimentId: args.experimentId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        assignmentId: true,
        mappingVersion: true,
        policy: true,
        reason: true,
        renderEvents: { select: { status: true } },
      },
    }),
  ]);
  const byAssignment = new Map<string, typeof decisions>();
  for (const decision of decisions) {
    if (!decision.assignmentId) continue;
    const current = byAssignment.get(decision.assignmentId) ?? [];
    current.push(decision);
    byAssignment.set(decision.assignmentId, current);
  }
  let mapped = 0;
  let unmatched = 0;
  let renderFailures = 0;
  let renderedTreatmentVisitors = 0;
  let missingRenderOutcomeVisitors = 0;
  let treatmentAssignedVisitors = 0;
  for (const assignment of assignments) {
    const visitorDecisions = byAssignment.get(assignment.id) ?? [];
    if (!visitorDecisions.some((decision) => decision.mappingVersion != null)) unmatched += 1;
    else mapped += 1;
    if (assignment.arm !== "MATCHED") continue;
    treatmentAssignedVisitors += 1;
    const treatmentRenders = visitorDecisions
      .filter((decision) => decision.policy === "MATCHED")
      .flatMap((decision) => decision.renderEvents);
    const rendered = treatmentRenders.some((event) =>
      event.status === "RENDERED" || event.status === "SUCCESS"
    );
    if (rendered) renderedTreatmentVisitors += 1;
    if (treatmentRenders.some((event) =>
      event.status !== "RENDERED" && event.status !== "SUCCESS"
    )) renderFailures += 1;
    if (treatmentRenders.length === 0) missingRenderOutcomeVisitors += 1;
  }
  return {
    assignedEligibleVisitors: assignments.length,
    mappedAssignedVisitors: mapped,
    unmatchedAssignedVisitors: unmatched,
    treatmentAssignedVisitors,
    renderedTreatmentVisitors,
    renderFailureVisitors: renderFailures,
    missingRenderOutcomeVisitors,
    unmatchedContextVisits: decisions.filter((decision) =>
      decision.assignmentId == null &&
      ["UNKNOWN_CAMPAIGN", "AMBIGUOUS_CAMPAIGN", "INVALID_CAMPAIGN", "MAPPING_NOT_ACTIVE", "MAPPING_EXPIRED", "NO_CAMPAIGN_CONTEXT"].includes(decision.reason)
    ).length,
    mappingCoverageRate: assignments.length ? mapped / assignments.length : null,
  };
}

export async function loadV2ExperimentAnalysis(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  healthState: "READY" | "INSUFFICIENT" | "INVALID";
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const experiment = await args.db.experiment.findFirst({
    where: { id: args.experimentId, merchantId: args.merchantId },
    include: {
      product: true,
      registration: true,
      assignments: true,
      visitorOutcomes: true,
      confounders: { orderBy: { occurredAt: "asc" } },
      incidents: { orderBy: { detectedAt: "asc" } },
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
  if (experiment.finalResultSnapshotId) {
    const frozen = await args.db.experimentResultSnapshot.findFirstOrThrow({
      where: {
        id: experiment.finalResultSnapshotId,
        experimentId: experiment.id,
      },
    });
    const saved = JSON.parse(frozen.payloadJson) as {
      analysis: ReturnType<typeof analyzeV2Experiment>;
      financial: Awaited<ReturnType<typeof financialReconciliationReadinessV2>>;
      health?: Awaited<ReturnType<typeof loadExperimentHealthV2>>;
    };
    return {
      experiment,
      financial: saved.financial,
      analysis: saved.analysis,
      health: saved.health ?? null,
      now: frozen.createdAt,
    };
  }
  const asOf = experiment.financialMaturityAt
    ? await loadFinancialAsOfV2({
        ...args,
        cutoff: experiment.financialMaturityAt,
      })
    : null;
  const financial =
    asOf ??
    (await financialReconciliationReadinessV2({
      db: args.db,
      merchantId: args.merchantId,
      experimentId: experiment.id,
    }));
  const currencies = await args.db.orderLedger.findMany({
    where: {
      lines: {
        some: {
          attributions: {
            some: { merchantId: args.merchantId, experimentId: experiment.id },
          },
        },
      },
      test: false,
    },
    select: { shopCurrency: true },
    distinct: ["shopCurrency"],
  });
  const currencyCode =
    asOf?.currencyCode ?? currencies[0]?.shopCurrency ?? "UNKNOWN";
  const currencyConflict = asOf
    ? asOf.reasons.includes("MULTIPLE_SHOP_CURRENCIES")
    : currencies.length > 1;
  const health = await loadExperimentHealthV2({ ...args, financial, now });
  const healthState =
    currencyConflict ||
    (asOf?.contradictoryLinks ?? 0) > 0 ||
    args.healthState === "INVALID" ||
    health.state === "INVALID"
      ? "INVALID"
      : args.healthState === "INSUFFICIENT" || health.state === "INSUFFICIENT"
        ? "INSUFFICIENT"
        : "READY";
  const analysis = analyzeV2Experiment({
    testType:
      experiment.controlPolicy === experiment.treatmentPolicy ? "AA" : "AB",
    now,
    enrollmentStartedAt: experiment.enrollmentStartedAt ?? experiment.startedAt,
    enrollmentClosedAt: experiment.enrollmentClosedAt,
    financialMaturityAt: experiment.financialMaturityAt,
    stopReason: experiment.stopReason,
    healthState,
    financialComplete: financial.complete,
    targetVisitors: experiment.registration.targetSampleSize,
    minimumPaidOrders: 20,
    minimumWorthwhileRelativeEffect:
      experiment.registration.minimumMeaningfulLift,
    alpha: experiment.registration.alpha,
    currencyCode,
    assignments: experiment.assignments.map((assignment) => ({
      id: assignment.id,
      arm: assignment.arm === "MATCHED" ? "MATCHED" : "ORIGINAL",
    })),
    outcomes: (asOf?.outcomes ?? experiment.visitorOutcomes).map((outcome) => ({
      assignmentId: outcome.assignmentId,
      netFocalRevenueMinor: outcome.netFocalRevenueMinor,
      paidOrders: outcome.paidOrders,
    })),
  });
  if (currencyConflict) analysis.reasons.push("MULTIPLE_SHOP_CURRENCIES");
  if (asOf)
    analysis.reasons.push(
      ...asOf.reasons.filter((reason) => !analysis.reasons.includes(reason)),
    );
  analysis.reasons.push(
    ...health.reasons.filter((reason) => !analysis.reasons.includes(reason)),
  );
  return { experiment, financial, analysis, health, now };
}

export function renderV2ExperimentReport(
  data: Awaited<ReturnType<typeof loadV2ExperimentAnalysis>>,
) {
  const { experiment, financial, analysis, now } = data;
  const registration = experiment.registration!;
  let adaptiveProtocol: string | null = null;
  let adaptiveInterpretation: string | null = null;
  try {
    const guardrails = JSON.parse(registration.guardrailsJson) as Record<string, unknown>;
    adaptiveProtocol = typeof guardrails.adaptiveExperimentProtocolVersion === "string"
      ? guardrails.adaptiveExperimentProtocolVersion
      : null;
    adaptiveInterpretation = typeof guardrails.adaptiveQuestionInterpretation === "string"
      ? guardrails.adaptiveQuestionInterpretation
      : null;
  } catch {
    /* historical registrations remain readable without adaptive labels */
  }
  const productName = experiment.product.title;
  const relative =
    analysis.relativeEffect == null
      ? "Not estimable"
      : `${(analysis.relativeEffect * 100).toFixed(2)}%`;
  const isValidation = experiment.controlPolicy === experiment.treatmentPolicy;
  const hasFinalEffect = ["POSITIVE", "NEGATIVE", "INCONCLUSIVE"].includes(
    analysis.resultState,
  );
  const label = isValidation
    ? "Measurement checks"
    : hasFinalEffect
      ? `Estimated additional sales of ${productName} during this test`
      : `${productName} experiment status`;
  return [
    `# ${label}`,
    "",
    `Result: **${analysis.resultState}**`,
    `Generated: ${now.toISOString()}`,
    `Registration: \`${registration.registrationHash}\``,
    `Analysis: \`${registration.analysisVersion}\``,
    `Registered question: ${registration.hypothesis}`,
    ...(adaptiveProtocol ? [`Adaptive protocol: \`${adaptiveProtocol}\``] : []),
    ...(adaptiveInterpretation ? [`Interpretation boundary: ${adaptiveInterpretation}`] : []),
    `Enrollment: ${(
      experiment.enrollmentStartedAt ?? experiment.startedAt
    ).toISOString()} to ${experiment.enrollmentClosedAt?.toISOString() ?? "open"}`,
    `Attribution closes: ${experiment.attributionClosesAt?.toISOString() ?? "not frozen"}`,
    `Financial as-of cutoff: ${experiment.financialMaturityAt?.toISOString() ?? "not frozen"}`,
    "",
    "## Net focal merchandise scope",
    "",
    `Selected product merchandise only, after allocated discounts and recognized merchandise refunds; excludes tax, shipping, duties, tips, unrelated products, gift-card product sales, unpaid and test orders. Currency: ${analysis.currencyCode}.`,
    "The measurement scope is observed, consented eligible visitors. All assigned visitors are included, including zero-order and failed-render visitors.",
    "",
    "## Assigned-visitor results",
    "",
    "| Arm | Assignments | Paid purchasers | Paid orders | Net merchandise | Mean per assigned visitor |",
    "|---|---:|---:|---:|---:|---:|",
    `| ${experiment.controlPolicy} | ${analysis.control.assignments} | ${analysis.control.paidPurchasers} | ${analysis.control.paidOrders} | ${money(Number(analysis.control.netRevenueMinor), analysis.currencyCode)} | ${money(analysis.control.meanMinor, analysis.currencyCode)} |`,
    `| ${experiment.treatmentPolicy} | ${analysis.treatment.assignments} | ${analysis.treatment.paidPurchasers} | ${analysis.treatment.paidOrders} | ${money(Number(analysis.treatment.netRevenueMinor), analysis.currencyCode)} | ${money(analysis.treatment.meanMinor, analysis.currencyCode)} |`,
    "",
    "## Registered effect",
    "",
    `Point difference: ${money(analysis.effectMinor, analysis.currencyCode)} per assigned visitor (${relative}).`,
    `${(analysis.confidenceLevel * 100).toFixed(0)}% Welch interval: ${money(analysis.intervalMinor.lower, analysis.currencyCode)} to ${money(analysis.intervalMinor.upper, analysis.currencyCode)}.`,
    ...(isValidation
      ? ["A/A is an instrumentation check and does not estimate economic lift."]
      : hasFinalEffect
        ? [
            `Estimated in-test additional focal-product sales: ${money(Number(analysis.estimatedAdditionalSalesMinor), analysis.currencyCode)}. This is not total-store profit or lifetime lift.`,
          ]
        : [
            "Estimated additional sales are not reportable before a valid mature effect result.",
          ]),
    "",
    "## Integrity and maturity",
    "",
    `Linked eligible orders reconciled: ${financial.reconciledLinkedOrders}/${financial.linkedEligibleOrders}.`,
    `Contradictory links: ${financial.contradictoryLinks}.`,
    ...(analysis.reasons.length
      ? analysis.reasons.map((reason) => `- ${reason}`)
      : ["- No blocking analysis reason recorded."]),
    "",
    analysis.resultState === "COLLECTING" || analysis.resultState === "MATURING"
      ? "This result is preliminary. Do not make a monetary or winning claim."
      : "Apply only the frozen result rule above; exploratory segments cannot change this decision.",
    "",
  ].join("\n");
}

export async function snapshotV2ExperimentReport(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  healthState: "READY" | "INSUFFICIENT" | "INVALID";
  now?: Date;
}) {
  return args.db.$transaction(async (tx) => {
    // Financial revision writers take this lock before appending their facts.
    // The frozen report must observe one coherent fact set, not a read/write race.
    await tx.experiment.updateMany({
      where: {
        id: args.experimentId,
        merchantId: args.merchantId,
        lifecycleVersion: 2,
      },
      data: { lifecycleVersion: 2 },
    });
    return snapshotV2WithinTransaction({
      ...args,
      db: tx as unknown as PrismaClient,
    });
  });
}

async function snapshotV2WithinTransaction(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  healthState: "READY" | "INSUFFICIENT" | "INVALID";
  now?: Date;
}) {
  const existing = await args.db.experiment.findFirstOrThrow({
    where: { id: args.experimentId, merchantId: args.merchantId },
    select: { finalResultSnapshotId: true, privacyAffectedAt: true },
  });
  assertPrivacyAnalysisUsable(existing);
  if (existing.finalResultSnapshotId)
    return args.db.experimentResultSnapshot.findFirstOrThrow({
      where: {
        id: existing.finalResultSnapshotId,
        experimentId: args.experimentId,
      },
    });
  const data = await loadV2ExperimentAnalysis(args);
  const reportMarkdown = renderV2ExperimentReport(data);
  const payloadJson = canonicalQueuePayload({
    experimentId: data.experiment.id,
    registrationHash: data.experiment.registration!.registrationHash,
    analysis: data.analysis,
    financial: data.financial,
    health: data.health,
    enrollmentClosedAt:
      data.experiment.enrollmentClosedAt?.toISOString() ?? null,
    attributionClosesAt:
      data.experiment.attributionClosesAt?.toISOString() ?? null,
    financialMaturityAt:
      data.experiment.financialMaturityAt?.toISOString() ?? null,
  });
  const dataHash = createHash("sha256").update(payloadJson).digest("hex");
  const snapshot = await args.db.experimentResultSnapshot.upsert({
    where: {
      experimentId_dataHash: {
        experimentId: data.experiment.id,
        dataHash,
      },
    },
    create: {
      experimentId: data.experiment.id,
      analysisVersion: data.experiment.registration!.analysisVersion,
      resultState: data.analysis.resultState,
      dataMaturityAt: data.experiment.financialMaturityAt ?? data.now,
      dataHash,
      payloadJson,
      reportMarkdown,
    },
    update: {},
  });
  const finalizable =
    terminal(data.analysis.resultState) &&
    data.experiment.enrollmentClosedAt != null &&
    data.experiment.financialMaturityAt != null &&
    data.now >= data.experiment.financialMaturityAt &&
    data.financial.complete;
  if (finalizable && !data.experiment.finalizedAt) {
    const tx = args.db;
    const updated = await tx.experiment.updateMany({
      where: {
        id: data.experiment.id,
        merchantId: args.merchantId,
        finalizedAt: null,
        finalResultSnapshotId: null,
        privacyAffectedAt: null,
      },
      data: {
        finalizedAt: data.now,
        finalResultSnapshotId: snapshot.id,
        status: "COMPLETED",
      },
    });
    if (updated.count === 1) {
      await tx.auditLog.create({
        data: {
          merchantId: args.merchantId,
          actor: "SYSTEM",
          action: "V2_EXPERIMENT_FINALIZED",
          resourceType: "ExperimentResultSnapshot",
          resourceId: snapshot.id,
          detailsJson: JSON.stringify({
            resultState: data.analysis.resultState,
            dataHash,
            financialMaturityAt:
              data.experiment.financialMaturityAt!.toISOString(),
          }),
        },
      });
    }
  }
  const finalized = await args.db.experiment.findFirstOrThrow({
    where: { id: args.experimentId, merchantId: args.merchantId },
    select: { finalResultSnapshotId: true },
  });
  if (finalized.finalResultSnapshotId)
    return args.db.experimentResultSnapshot.findFirstOrThrow({
      where: {
        id: finalized.finalResultSnapshotId,
        experimentId: args.experimentId,
      },
    });
  return snapshot;
}

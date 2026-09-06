import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { loadExperimentHealthV2 } from "./experiment-health-v2.server";
import { loadFinancialAsOfV2 } from "./financial-as-of-v2.server";
import { canonicalQueuePayload } from "./job-outbox.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "./mvp-v2";
import type { QualificationV2Input } from "./qualification-v2";
import { snapshotQualificationV2 } from "./qualification-v2.server";

const DAY_MS = 86_400_000;
export const ORIGINAL_BASELINE_SOURCE_V2 = "ORIGINAL_ASSIGNED_VISITOR_IMMUTABLE_FINANCIAL_V2";

type BaselineArgs = {
  db: PrismaClient; merchantId: string; productId: string; experimentId: string;
  observationStart: Date; observationEnd: Date; targetEffect: number; now?: Date;
};

async function assemble(args: BaselineArgs) {
  const now = args.now ?? new Date();
  const days = (args.observationEnd.getTime()-args.observationStart.getTime()) / DAY_MS;
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(days) || days < 1 || days > 42 ||
    !Number.isFinite(args.targetEffect) || args.targetEffect <= 0)
    throw new Error("V2_BASELINE_INPUT_INVALID");
  const experiment = await args.db.experiment.findFirstOrThrow({
    where: { id: args.experimentId, merchantId: args.merchantId, productId: args.productId, lifecycleVersion: 2 },
    include: { registration: true, product: true,
      confounders: { where: { materiality: "MATERIAL" } },
      incidents: { where: { status: "OPEN", severity: { in: ["SEV1", "SEV2"] } } } },
  });
  const registration = experiment.registration;
  if (!registration || registration.protocolVersion !== MVP_V2_PROTOCOL_VERSION ||
    registration.primaryMetric !== MVP_V2_PRIMARY_METRIC || experiment.controlPolicy !== "ORIGINAL" ||
    experiment.treatmentPolicy !== "ORIGINAL" || experiment.attributionWindowDays !== 7)
    throw new Error("V2_BASELINE_ORIGINAL_PROTOCOL_REQUIRED");
  if (args.observationStart < (experiment.enrollmentStartedAt ?? experiment.startedAt) ||
    (experiment.enrollmentClosedAt && args.observationEnd > experiment.enrollmentClosedAt))
    throw new Error("V2_BASELINE_OBSERVATION_SCOPE_INVALID");
  const restrictions = ["Original-only registered cohort", "Analytics and preferences consent required",
    "First-eligible visitors, not sessions", "Verified signed focal-product financial links only",
    "Wholly unobserved loss is not inferable; real controlled checkout validation remains required"];
  function unavailable(reason: string, state: "BASELINE_REQUIRED" | "PREVIEW_ONLY" = "BASELINE_REQUIRED") {
    return { state, input: null as QualificationV2Input | null, reasons: [reason],
      evidence: { dataSource: ORIGINAL_BASELINE_SOURCE_V2, observedDays: days, sourceEvidenceHash: null as string | null } };
  }
  if (experiment.product.status !== "ACTIVE") return unavailable("BASELINE_PRODUCT_UNAVAILABLE", "PREVIEW_ONLY");
  if (experiment.stopReason || ["INVALIDATED", "STOPPED", "REPAIR_REQUIRED"].includes(experiment.status))
    return unavailable("BASELINE_PROTOCOL_INTERRUPTED", "PREVIEW_ONLY");
  if (experiment.confounders.length || experiment.incidents.length)
    return unavailable("BASELINE_INTEGRITY_REVIEW_REQUIRED", "PREVIEW_ONLY");
  if (!experiment.enrollmentClosedAt || !experiment.financialMaturityAt || now < experiment.financialMaturityAt ||
    experiment.financialMaturityAt.getTime() < args.observationEnd.getTime()+7*DAY_MS)
    return unavailable("BASELINE_OUTCOME_MATURITY_UNVERIFIED");
  const assignments = await args.db.assignment.findMany({
    where: { merchantId: args.merchantId, experimentId: experiment.id,
      assignedAt: { gte: args.observationStart, lt: args.observationEnd } },
    include: { decisions: true }, orderBy: [{ assignedAt: "asc" }, { id: "asc" }],
  });
  if (assignments.some((assignment) => assignment.randomizationUnitType !== "CONSENTED_PERSISTENT_VISITOR" ||
    assignment.consentState !== "ANALYTICS_AND_PREFERENCES_ALLOWED" ||
    assignment.expiresAt.getTime() !== assignment.assignedAt.getTime()+7*DAY_MS ||
    assignment.decisions.some((decision) => decision.policy !== "ORIGINAL" || decision.productId !== args.productId)))
    return unavailable("BASELINE_COHORT_AUTHORITY_INVALID", "PREVIEW_ONLY");
  const financial = await loadFinancialAsOfV2({ ...args, cutoff: experiment.financialMaturityAt });
  if (!financial.complete) return unavailable("BASELINE_FINANCIAL_RECONCILIATION_INCOMPLETE");
  if (!["USD", "EUR", "GBP", "TRY", "ILS"].includes(financial.currencyCode))
    return unavailable("BASELINE_PAID_FINANCIAL_CURRENCY_UNAVAILABLE");
  const health = await loadExperimentHealthV2({ ...args, now, financial });
  if (health.state === "INVALID") return unavailable("BASELINE_CAPTURE_INVALID", "PREVIEW_ONLY");
  const dailyEligibleVisitors = Array<number>(days).fill(0);
  const dailyObservableCheckoutVisitors = Array<number>(days).fill(0);
  const outcomes = new Map(financial.outcomes.map((outcome) => [outcome.assignmentId, outcome]));
  const sessions = new Set<string>();
  const visitorRevenueMinor: string[] = [];
  let paidPurchasers = 0;
  for (const assignment of assignments) {
    const day = Math.floor((assignment.assignedAt.getTime()-args.observationStart.getTime())/DAY_MS);
    dailyEligibleVisitors[day]! += 1;
    const outcome = outcomes.get(assignment.id);
    visitorRevenueMinor.push(outcome?.netFocalRevenueMinor ?? "0");
    if (outcome && outcome.paidOrders > 0) {
      paidPurchasers += 1;
      // Conservative: a verified non-test paid order establishes a checkout.
      // Unknown/test-only browser claims cannot increase forecast throughput.
      dailyObservableCheckoutVisitors[day]! += 1;
    }
    const decisions = assignment.decisions.filter((decision) => decision.occurredAt >= assignment.assignedAt &&
      decision.occurredAt < assignment.expiresAt && decision.consentState === "ANALYTICS_AND_PREFERENCES_ALLOWED");
    if (decisions.length === 0) return unavailable("BASELINE_VISITOR_SESSION_AUTHORITY_MISSING");
    for (const decision of decisions) if (decision.sessionId) sessions.add(`${assignment.id}:${decision.sessionId}`);
  }
  if (sessions.size < assignments.length) return unavailable("BASELINE_VISITOR_SESSION_AUTHORITY_MISSING");
  const sourceEvidenceHash = createHash("sha256").update(canonicalQueuePayload({
    source: ORIGINAL_BASELINE_SOURCE_V2, merchantId: args.merchantId, productId: args.productId,
    experimentId: experiment.id, registrationHash: registration.registrationHash,
    observationStart: args.observationStart.toISOString(), observationEnd: args.observationEnd.toISOString(),
    financialCutoff: experiment.financialMaturityAt.toISOString(), revisionIds: financial.revisionIds,
    assignments: assignments.map((item) => ({ id: item.id, assignedAt: item.assignedAt.toISOString() })),
    health,
  })).digest("hex");
  const input: QualificationV2Input = {
    observationStart: args.observationStart, observationEnd: args.observationEnd,
    outcomesObservedThrough: experiment.financialMaturityAt, dataSource: ORIGINAL_BASELINE_SOURCE_V2,
    eligibleVisitors: assignments.length, eligibleSessions: sessions.size, paidPurchasers,
    visitorRevenueMinor, dailyEligibleVisitors, dailyObservableCheckoutVisitors,
    currencyCode: financial.currencyCode, coverage: Math.min(health.bridge.coverage ?? 0, health.checkouts.coverage ?? 0),
    targetEffect: args.targetEffect,
    restrictionsApplied: [...restrictions, `source-evidence-sha256:${sourceEvidenceHash}`],
  };
  return { state: "AVAILABLE" as const, input, reasons: [] as string[],
    evidence: { dataSource: ORIGINAL_BASELINE_SOURCE_V2, observedDays: days, sourceEvidenceHash } };
}

/** Internal-only: do not expose private visitor money arrays through a route. */
export async function snapshotOriginalBaselineV2(args: BaselineArgs) {
  return args.db.$transaction(async (tx) => {
    // Same experiment lock as financial append and enrollment, so a snapshot
    // cannot splice a new financial revision into an older cohort read.
    await tx.experiment.updateMany({ where: { id: args.experimentId, merchantId: args.merchantId,
      productId: args.productId, lifecycleVersion: 2 }, data: { lifecycleVersion: 2 } });
    const result = await assemble({ ...args, db: tx as unknown as PrismaClient });
    if (!result.input) return { ...result, snapshot: null };
    const snapshot = await snapshotQualificationV2({ db: tx as unknown as PrismaClient,
      merchantId: args.merchantId, productId: args.productId, input: result.input });
    // No raw outcome array or assignment list escapes this service boundary.
    return { state: snapshot.status, input: null, reasons: JSON.parse(snapshot.canonicalPayload).reasons as string[],
      evidence: result.evidence, snapshot };
  }, { timeout: 60_000 });
}

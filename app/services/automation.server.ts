import type { PrismaClient } from "@prisma/client";

import {
  AUTOPILOT_PREPARATION_JOB,
  runAutopilotPreparationJobs,
} from "./autopilot-preparation-worker.server";
import { advanceAutopilotPlan } from "./autopilot-orchestrator.server";
import { deliverOperationalAlerts } from "./alert-delivery.server";
import { mvpV2Config } from "./mvp-v2";
import { enqueueV2LifecycleJobs, runV2LifecycleJobs } from "./lifecycle-worker-v2.server";
import { fetchShopifyFinancialOrderV2 } from "./shopify-financial-v2.server";
import { runFinancialReconciliationJobsV2 } from "./webhook-inbox-v2.server";

import {
  loadExperimentReport,
  snapshotExperimentReport,
} from "./experiment-report.server";
import {
  recoverRecentOrders,
  type AdminGraphql,
} from "./measurement-reliability.server";
import { evaluateExperimentSafety } from "./pilot-operations.server";

async function setAlert(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId?: string | null;
  fingerprint: string;
  active: boolean;
  severity: string;
  kind: string;
  summary: string;
  details?: unknown;
}) {
  const existing = await args.db.operationalAlert.findUnique({
    where: {
      merchantId_fingerprint: {
        merchantId: args.merchantId,
        fingerprint: args.fingerprint,
      },
    },
  });
  if (!args.active) {
    if (existing?.status === "OPEN") {
      return args.db.operationalAlert.update({
        where: { id: existing.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
    }
    return existing;
  }
  return args.db.operationalAlert.upsert({
    where: {
      merchantId_fingerprint: {
        merchantId: args.merchantId,
        fingerprint: args.fingerprint,
      },
    },
    create: {
      merchantId: args.merchantId,
      experimentId: args.experimentId ?? null,
      fingerprint: args.fingerprint,
      severity: args.severity,
      kind: args.kind,
      summary: args.summary.slice(0, 500),
      detailsJson: JSON.stringify(args.details ?? {}),
    },
    update: {
      experimentId: args.experimentId ?? null,
      severity: args.severity,
      kind: args.kind,
      status: "OPEN",
      summary: args.summary.slice(0, 500),
      detailsJson: JSON.stringify(args.details ?? {}),
      openedAt: existing?.status === "OPEN" ? existing.openedAt : new Date(),
      resolvedAt: null,
    },
  });
}

export async function enforceRetention(args: {
  db: PrismaClient;
  merchantId: string;
  now?: Date;
}) {
  const settings = await args.db.pilotSettings.findUnique({
    where: { merchantId: args.merchantId },
  });
  const now = args.now ?? new Date();
  const rawCutoff = new Date(
    now.getTime() - (settings?.rawEventRetentionDays ?? 90) * 86_400_000,
  );
  const [commerceEvents, renderEvents] = await args.db.$transaction([
    args.db.commerceEvent.deleteMany({
      where: { merchantId: args.merchantId, occurredAt: { lt: rawCutoff } },
    }),
    args.db.renderEvent.deleteMany({
      where: { merchantId: args.merchantId, occurredAt: { lt: rawCutoff } },
    }),
  ]);
  return {
    rawCutoff,
    commerceEvents: commerceEvents.count,
    renderEvents: renderEvents.count,
  };
}

export async function enforcePublicFunnelRetention(args: {
  db: PrismaClient;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const days = Math.min(
    365,
    Math.max(30, Number(process.env.PUBLIC_FUNNEL_RETENTION_DAYS ?? 90) || 90),
  );
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const deleted = await args.db.publicFunnelEvent.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });
  return { cutoff, deleted: deleted.count };
}

export async function runMerchantAutomation(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  graphql: AdminGraphql;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const run = await args.db.automationRun.create({
    data: {
      merchantId: args.merchantId,
      jobType: "PILOT_MAINTENANCE",
      status: "RUNNING",
    },
  });
  try {
    const v2 = mvpV2Config();
    const preparationJobs = await runAutopilotPreparationJobs({
      db: args.db,
      merchantId: args.merchantId,
      shop: args.shop,
      graphql: args.graphql,
      workerId: `automation:${run.id}:preparation`,
      now: args.now,
    });
    let financialJobs: Awaited<ReturnType<typeof runFinancialReconciliationJobsV2>> = [];
    let lifecycleJobs: Awaited<ReturnType<typeof runV2LifecycleJobs>> = [];
    let financialWorkerConfigurationError: string | null = null;
    if (v2.enabled) {
      const assignmentSecret = process.env.ASSIGNMENT_SECRET?.trim() ?? "";
      if (assignmentSecret.length < 32) {
        financialWorkerConfigurationError =
          "V2_FINANCIAL_ASSIGNMENT_SECRET_UNAVAILABLE";
      } else {
        financialJobs = await runFinancialReconciliationJobsV2({
          db: args.db,
          merchantId: args.merchantId,
          workerId: `automation:${run.id}`,
          assignmentSecret,
          fetchOrder: (orderId) =>
            fetchShopifyFinancialOrderV2({
              merchantId: args.merchantId,
              orderId,
              graphql: args.graphql,
            }),
          now: args.now,
        });
      }
      await enqueueV2LifecycleJobs({
        db: args.db,
        merchantId: args.merchantId,
        now,
      });
      lifecycleJobs = await runV2LifecycleJobs({
        db: args.db,
        merchantId: args.merchantId,
        workerId: `automation:${run.id}:lifecycle`,
        now,
      });
    }
    const recovery = await recoverRecentOrders({ ...args, now });
    const experiments = await args.db.experiment.findMany({
      where: {
        merchantId: args.merchantId,
        lifecycleVersion: 1,
        status: "ACTIVE",
        registration: { isNot: null },
      },
      select: { id: true, key: true },
    });
    const evaluations: Array<{
      experimentId: string;
      outcome: string;
      rollback: boolean;
      resultSnapshot?: string;
    }> = [];
    for (const experiment of experiments) {
      const latest = await args.db.safetyEvaluation.findFirst({
        where: { experimentId: experiment.id },
        orderBy: { evaluatedAt: "desc" },
      });
      if (
        !latest ||
        now.getTime() - latest.evaluatedAt.getTime() >= 5 * 60 * 1000
      ) {
        const result = await evaluateExperimentSafety({
          db: args.db,
          merchantId: args.merchantId,
          experimentId: experiment.id,
          actor: "SCHEDULED_GUARDRAIL",
        });
        evaluations.push({
          experimentId: experiment.id,
          outcome: result.assessment.outcome,
          rollback: result.rollbackTriggered,
        });
        await setAlert({
          db: args.db,
          merchantId: args.merchantId,
          experimentId: experiment.id,
          fingerprint: `safety:${experiment.id}`,
          active: result.assessment.rollback,
          severity: "SEV1",
          kind: "AUTOMATED_ROLLBACK",
          summary:
            result.assessment.reasons.join(" ") || "Runtime guardrail failure.",
          details: result.assessment.metrics,
        });
      }
      const report = await loadExperimentReport({
        db: args.db,
        merchantId: args.merchantId,
        experimentId: experiment.id,
        now,
      });
      const matureResult =
        report.analysis.maturity === "MATURE" &&
        [
          "VALIDATED",
          "FAILED_VALIDATION",
          "POSITIVE",
          "NEGATIVE",
          "INCONCLUSIVE",
          "INVALID",
        ].includes(report.analysis.resultState);
      const resultSnapshot = matureResult
        ? await snapshotExperimentReport({
            db: args.db,
            merchantId: args.merchantId,
            experimentId: experiment.id,
            now,
          })
        : null;
      if (resultSnapshot) {
        const evaluation = evaluations.find(
          (item) => item.experimentId === experiment.id,
        );
        if (evaluation) evaluation.resultSnapshot = resultSnapshot.id;
        else
          evaluations.push({
            experimentId: experiment.id,
            outcome: "NOT_DUE",
            rollback: false,
            resultSnapshot: resultSnapshot.id,
          });
      }
      await setAlert({
        db: args.db,
        merchantId: args.merchantId,
        experimentId: experiment.id,
        fingerprint: `measurement:${experiment.id}`,
        active:
          report.readiness === "HOLD" &&
          report.experiment.assignments.length >= 10,
        severity: "SEV2",
        kind: "MEASUREMENT_HEALTH",
        summary: `${experiment.key} has a material measurement-health warning.`,
        details: report.checks,
      });
    }
    const plans = await args.db.autopilotPlan.findMany({
      where: {
        merchantId: args.merchantId,
        state: {
          in: ["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING"],
        },
      },
      select: { id: true },
    });
    const autopilot = [];
    for (const plan of plans) {
      autopilot.push(
        await advanceAutopilotPlan({
          db: args.db,
          merchantId: args.merchantId,
          planId: plan.id,
          now,
        }),
      );
    }
    const retention = await enforceRetention({
      db: args.db,
      merchantId: args.merchantId,
      now,
    });
    const pendingPreparationFailures = await args.db.job.count({
      where: {
        merchantId: args.merchantId,
        type: AUTOPILOT_PREPARATION_JOB,
        status: { in: ["RETRY", "DEAD_LETTER"] },
      },
    });
    await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "autopilot-preparation-worker",
      active: pendingPreparationFailures > 0,
      severity: "SEV2",
      kind: "AUTOPILOT_PREPARATION",
      summary: pendingPreparationFailures
        ? "Pagnetic onboarding preparation needs a retry or operator review."
        : "Pagnetic onboarding preparation is healthy.",
      details: {
        processed: preparationJobs.length,
        failures: preparationJobs.filter((item) => !item.ok).map((item) => ({
          jobId: item.jobId,
          errorCode: item.errorCode,
        })),
      },
    });
    await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "order-recovery",
      active: recovery.status === "ERROR" || recovery.status === "PARTIAL",
      severity: "SEV2",
      kind: "ORDER_RECOVERY",
      summary:
        recovery.lastError ?? `Order recovery status is ${recovery.status}.`,
      details: { status: recovery.status, lastCursor: recovery.lastCursor },
    });
    const failedFinancialJobs = financialJobs.filter((item) => !item.ok);
    await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "v2-financial-reconciliation-worker",
      active:
        failedFinancialJobs.length > 0 ||
        financialWorkerConfigurationError !== null,
      severity: "SEV2",
      kind: "FINANCIAL_RECONCILIATION",
      summary: financialWorkerConfigurationError
        ? "V2 financial reconciliation is not configured; no financial job was claimed."
        : failedFinancialJobs.length
          ? `${failedFinancialJobs.length} financial reconciliation job(s) need retry or operator review.`
        : "Financial reconciliation worker is healthy.",
      details: {
        processed: financialJobs.length,
        configurationError: financialWorkerConfigurationError,
        failures: failedFinancialJobs.map((item) => ({
          jobId: item.jobId,
          errorCode: item.errorCode,
        })),
      },
    });
    const failedLifecycleJobs = lifecycleJobs.filter((item) => !item.ok);
    await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "v2-lifecycle-worker",
      active: failedLifecycleJobs.length > 0,
      severity: "SEV2",
      kind: "V2_LIFECYCLE_WORKER",
      summary: failedLifecycleJobs.length
        ? `${failedLifecycleJobs.length} lifecycle job(s) need retry or operator review.`
        : "V2 lifecycle worker is healthy.",
      details: {
        processed: lifecycleJobs.length,
        failures: failedLifecycleJobs.map((item) => ({
          jobId: item.jobId,
          type: item.type,
          errorCode: "errorCode" in item ? item.errorCode : null,
        })),
      },
    });
    const postFinalizationRevisions = await args.db.auditLog.findMany({
      where: {
        merchantId: args.merchantId,
        action: "V2_FINANCIAL_REVISION_AFTER_FINALIZATION",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { createdAt: true, detailsJson: true },
    });
    await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "v2-post-finalization-financial-review",
      active: postFinalizationRevisions.length > 0,
      severity: "SEV2",
      kind: "FINANCIAL_RESULT_REVIEW",
      summary: postFinalizationRevisions.length
        ? "A financial revision arrived after a result was finalized; the frozen report was preserved and needs review."
        : "No post-finalization financial revision needs review.",
      details: {
        reviewCount: postFinalizationRevisions.length,
        latestDetectedAt: postFinalizationRevisions[0]?.createdAt.toISOString() ?? null,
      },
    });
    await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "automation-failure",
      active: false,
      severity: "SEV2",
      kind: "AUTOMATION_FAILURE",
      summary: "Maintenance recovered.",
    });
    const alerts = await args.db.operationalAlert.findMany({
      where: { merchantId: args.merchantId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
      take: 100,
    });
    const alertDelivery = await deliverOperationalAlerts({
      db: args.db,
      merchantId: args.merchantId,
      alerts,
    });
    const details = {
      recovered: recovery.recoveredOrderCount,
      preparationJobs,
      financialJobs,
      lifecycleJobs,
      financialWorkerConfigurationError,
      evaluations,
      autopilot,
      retention,
      openAlerts: alerts.length,
      alertDelivery,
    };
    await args.db.automationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        detailsJson: JSON.stringify(details),
      },
    });
    return details;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown automation error";
    await args.db.automationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: message.slice(0, 500),
      },
    });
    const failureAlert = await setAlert({
      db: args.db,
      merchantId: args.merchantId,
      fingerprint: "automation-failure",
      active: true,
      severity: "SEV2",
      kind: "AUTOMATION_FAILURE",
      summary: message,
    });
    // Alert delivery must not depend on the failing recovery/report step becoming healthy.
    if (failureAlert) {
      try {
        await deliverOperationalAlerts({
          db: args.db,
          merchantId: args.merchantId,
          alerts: [failureAlert],
        });
      } catch {
        // Preserve the maintenance failure; the durable notification remains retryable.
      }
    }
    throw error;
  }
}

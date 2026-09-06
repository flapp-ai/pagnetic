import type { PrismaClient } from "@prisma/client";

import { reconcileBetaEntitlement } from "./beta-entitlement.server";
import { loadExperimentHealthV2 } from "./experiment-health-v2.server";
import { closeV2EnrollmentIfDue } from "./experiment-lifecycle-v2.server";
import { snapshotV2ExperimentReport } from "./experiment-report-v2.server";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
} from "./job-outbox.server";

const HOUR_MS = 60 * 60_000;
const SIX_HOURS_MS = 6 * HOUR_MS;
const LIFECYCLE_JOB_TYPES = ["CLOSE_ENROLLMENT", "FINALIZE_RESULT"];

function errorCode(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/[^A-Z0-9_]+/gi, "_").slice(0, 120)
    : "V2_LIFECYCLE_JOB_FAILED";
}

async function enqueueClose(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  nextRunAt: Date;
  idempotencyKey?: string;
}) {
  return enqueueJob({
    db: args.db,
    merchantId: args.merchantId,
    type: "CLOSE_ENROLLMENT",
    idempotencyKey: args.idempotencyKey ?? `v2-close:${args.experimentId}:root`,
    payloadSchemaVersion: 2,
    payload: { experimentId: args.experimentId },
    nextRunAt: args.nextRunAt,
  });
}

async function enqueueFinalize(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  financialMaturityAt: Date;
}) {
  return enqueueJob({
    db: args.db,
    merchantId: args.merchantId,
    type: "FINALIZE_RESULT",
    idempotencyKey: `v2-finalize:${args.experimentId}`,
    payloadSchemaVersion: 2,
    payload: { experimentId: args.experimentId },
    nextRunAt: args.financialMaturityAt,
  });
}

export async function enqueueV2LifecycleJobs(args: {
  db: PrismaClient;
  merchantId: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const experiments = await args.db.experiment.findMany({
    where: {
      merchantId: args.merchantId,
      lifecycleVersion: 2,
      finalizedAt: null,
      privacyAffectedAt: null,
      status: { in: ["ACTIVE", "PAUSED", "ENROLLMENT_CLOSED"] },
    },
    include: { registration: true },
  });
  const queued = [];
  for (const experiment of experiments) {
    if (!experiment.registration) continue;
    if (!experiment.enrollmentClosedAt) {
      const existingClose = await args.db.job.findFirst({
        where: {
          merchantId: args.merchantId,
          type: "CLOSE_ENROLLMENT",
          idempotencyKey: { startsWith: `v2-close:${experiment.id}:` },
        },
        select: { id: true },
      });
      // A dead-lettered chain requires an explicit operator retry. Maintenance
      // must never mint a fresh attempt budget or race another enqueuer.
      if (existingClose) continue;
      const minimumAt = new Date(
        (experiment.enrollmentStartedAt ?? experiment.startedAt).getTime() +
          experiment.registration.minimumDurationDays * 86_400_000,
      );
      queued.push(
        await enqueueClose({
          db: args.db,
          merchantId: args.merchantId,
          experimentId: experiment.id,
          nextRunAt: minimumAt > now ? minimumAt : now,
        }),
      );
    } else if (experiment.financialMaturityAt) {
      queued.push(
        await enqueueFinalize({
          db: args.db,
          merchantId: args.merchantId,
          experimentId: experiment.id,
          financialMaturityAt: experiment.financialMaturityAt,
        }),
      );
    }
  }
  return queued;
}

async function openLifecycleIncident(args: {
  db: PrismaClient;
  merchantId: string;
  experimentId: string;
  summary: string;
}) {
  const existing = await args.db.incident.findFirst({
    where: {
      merchantId: args.merchantId,
      experimentId: args.experimentId,
      category: "V2_LIFECYCLE_JOB_DEAD_LETTER",
      status: "OPEN",
    },
  });
  if (existing) return existing;
  return args.db.incident.create({
    data: {
      merchantId: args.merchantId,
      experimentId: args.experimentId,
      severity: "SEV2",
      category: "V2_LIFECYCLE_JOB_DEAD_LETTER",
      summary: args.summary.slice(0, 500),
      actor: "SYSTEM",
    },
  });
}

export async function runV2LifecycleJobs(args: {
  db: PrismaClient;
  merchantId: string;
  workerId: string;
  now?: Date;
  limit?: number;
}) {
  const now = args.now ?? new Date();
  const jobs = await claimJobs({
    db: args.db,
    merchantId: args.merchantId,
    workerId: args.workerId,
    types: LIFECYCLE_JOB_TYPES,
    now,
    limit: args.limit ?? 20,
    leaseMs: 5 * 60_000,
    maxAttempts: 48,
  });
  const outcomes = [];
  for (const job of jobs) {
    let experimentId = "";
    try {
      const payload = JSON.parse(job.payloadJson) as Record<string, unknown>;
      if (
        job.payloadSchemaVersion !== 2 ||
        Object.keys(payload).some((key) => key !== "experimentId") ||
        typeof payload.experimentId !== "string" ||
        payload.experimentId.length > 160
      )
        throw new Error("V2_LIFECYCLE_JOB_PAYLOAD_INVALID");
      experimentId = payload.experimentId;
      const authority = await args.db.experiment.findFirst({
        where: {
          id: experimentId,
          merchantId: args.merchantId,
          lifecycleVersion: 2,
        },
        select: {
          status: true,
          enrollmentClosedAt: true,
          finalizedAt: true,
          privacyAffectedAt: true,
        },
      });
      const control = await args.db.runtimeControl.findUnique({
        where: { merchantId: args.merchantId },
        select: { killSwitch: true, reason: true },
      });
      if (authority?.privacyAffectedAt) {
        await completeJob({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          leaseToken: job.leaseToken!,
          resultRef: "SKIPPED_PRIVACY_ANALYSIS_REVIEW",
          now,
        });
        outcomes.push({
          jobId: job.id,
          type: job.type,
          ok: true,
          resultRef: "SKIPPED_PRIVACY_ANALYSIS_REVIEW",
        });
        continue;
      }
      const authorized =
        job.type === "CLOSE_ENROLLMENT"
          ? ["ACTIVE", "PAUSED"].includes(authority?.status ?? "") &&
            !authority?.enrollmentClosedAt
          : authority?.status === "ENROLLMENT_CLOSED" &&
            Boolean(authority.enrollmentClosedAt) &&
            !authority.finalizedAt;
      if (!authorized) {
        await completeJob({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          leaseToken: job.leaseToken!,
          resultRef: "SKIPPED_INACTIVE",
          now,
        });
        outcomes.push({
          jobId: job.id,
          type: job.type,
          ok: true,
          resultRef: "SKIPPED_INACTIVE",
        });
        continue;
      }
      if (job.type === "CLOSE_ENROLLMENT") {
        const pausedStopReason =
          authority?.status === "PAUSED"
            ? /uninstall/i.test(control?.reason ?? "")
              ? "OWNER_STOP"
              : "MERCHANT_PAUSE"
            : control?.killSwitch
              ? "SAFETY_STOP"
              : null;
        const result = await closeV2EnrollmentIfDue({
          db: args.db,
          merchantId: args.merchantId,
          experimentId,
          now,
          stopReason: pausedStopReason,
        });
        if (result.phase === "ENROLLING") {
          const nextRunAt = new Date(
            Math.min(now.getTime() + SIX_HOURS_MS, result.deadlineAt.getTime()),
          );
          await enqueueClose({
            db: args.db,
            merchantId: args.merchantId,
            experimentId,
            nextRunAt,
            idempotencyKey: `v2-close:${experimentId}:after:${job.id}`,
          });
        } else if (result.experiment.financialMaturityAt) {
          await enqueueFinalize({
            db: args.db,
            merchantId: args.merchantId,
            experimentId,
            financialMaturityAt: result.experiment.financialMaturityAt,
          });
        }
        await completeJob({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          leaseToken: job.leaseToken!,
          resultRef: result.phase,
          now,
        });
        outcomes.push({
          jobId: job.id,
          type: job.type,
          ok: true,
          resultRef: result.phase,
        });
        continue;
      }
      const health = await loadExperimentHealthV2({
        db: args.db,
        merchantId: args.merchantId,
        experimentId,
        now,
      });
      const snapshot = await snapshotV2ExperimentReport({
        db: args.db,
        merchantId: args.merchantId,
        experimentId,
        healthState: health.state,
        now,
      });
      const finalized = await args.db.experiment.findFirstOrThrow({
        where: { id: experimentId, merchantId: args.merchantId },
        select: { finalResultSnapshotId: true },
      });
      if (finalized.finalResultSnapshotId !== snapshot.id)
        throw new Error("V2_FINALIZATION_NOT_READY");
      await reconcileBetaEntitlement({
        db: args.db,
        merchantId: args.merchantId,
        snapshotId: snapshot.id,
        actor: "system:v2-lifecycle-worker",
      });
      await completeJob({
        db: args.db,
        merchantId: args.merchantId,
        jobId: job.id,
        leaseToken: job.leaseToken!,
        resultRef: snapshot.id,
        now,
      });
      outcomes.push({
        jobId: job.id,
        type: job.type,
        ok: true,
        resultRef: snapshot.id,
      });
    } catch (error) {
      const code = errorCode(error);
      try {
        const failed = await failJob({
          db: args.db,
          merchantId: args.merchantId,
          jobId: job.id,
          leaseToken: job.leaseToken!,
          errorCode: code,
          now,
          maxAttempts: 48,
        });
        if (failed.status === "DEAD_LETTER" && experimentId) {
          await openLifecycleIncident({
            db: args.db,
            merchantId: args.merchantId,
            experimentId,
            summary: `${job.type} exhausted its bounded retries (${code}).`,
          });
        }
      } catch {
        // A replacement worker owns the lease; it alone may change this job.
      }
      outcomes.push({
        jobId: job.id,
        type: job.type,
        ok: false,
        errorCode: code,
      });
    }
  }
  return outcomes;
}

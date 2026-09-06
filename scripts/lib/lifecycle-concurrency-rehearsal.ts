import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";

import { closeV2EnrollmentIfDue } from "../../app/services/experiment-lifecycle-v2.server";
import { MVP_V2_PRIMARY_METRIC, MVP_V2_PROTOCOL_VERSION } from "../../app/services/mvp-v2";

export async function rehearseLifecycleConcurrency(db: PrismaClient, other: PrismaClient) {
  const merchantId = "merchant-a";
  const experiment = await db.experiment.create({ data: {
    merchantId, productId: "product-a", key: "close-race", salt: "synthetic-close-race",
    lifecycleVersion: 2, startedAt: new Date("2026-09-01Z"),
    enrollmentStartedAt: new Date("2026-09-01Z"),
    registration: { create: {
      protocolVersion: MVP_V2_PROTOCOL_VERSION, hypothesis: "Synthetic close concurrency",
      primaryMetric: MVP_V2_PRIMARY_METRIC, revenueDefinition: "NET_FOCAL_MERCHANDISE",
      minimumMeaningfulLift: .2, alpha: .05, power: .8, targetSampleSize: 1,
      minimumDurationDays: 14, maximumDurationDays: 14,
      randomizationUnit: "CONSENTED_PERSISTENT_VISITOR", eligibilityJson: "{}",
      exclusionsJson: "[]", covariatesJson: "[]", stoppingRule: "FIXED_COHORT_V2",
      analysisVersion: "welch-assigned-visitor-v2.1", contentVersionsJson: "[]",
      mappingVersionsJson: "[]", guardrailsJson: "{}", dataMaturityLagDays: 7,
      registrationHash: "synthetic-close-race-registration",
    } },
  } });
  const createAssignment = (client: Prisma.TransactionClient, visitor: string, assignedAt: Date) =>
    client.assignment.create({ data: {
      merchantId, experimentId: experiment.id, randomizationUnitId: visitor,
      randomizationUnitType: "CONSENTED_PERSISTENT_VISITOR", visitorHash: visitor,
      arm: "ORIGINAL", bucket: 1, saltVersion: 1,
      consentState: "ANALYTICS_AND_PREFERENCES_ALLOWED", assignedAt,
      expiresAt: new Date(assignedAt.getTime() + 7 * 86_400_000),
    } });
  await db.$transaction(async (tx) => createAssignment(tx, "old-close-visitor", new Date("2026-09-01Z")));
  let signalLock!: () => void;
  let releaseLock!: () => void;
  const lockReached = new Promise<void>((resolve) => { signalLock = resolve; });
  const released = new Promise<void>((resolve) => { releaseLock = resolve; });
  let intercepted = false;
  const delayed = db.$extends({ query: { experiment: {
    async updateMany({ args, query }) {
      if (!intercepted) {
        intercepted = true;
        signalLock();
        await released;
      }
      return query(args);
    },
  } } }) as unknown as PrismaClient;
  const closing = closeV2EnrollmentIfDue({
    db: delayed, merchantId, experimentId: experiment.id, now: new Date("2026-09-15Z"),
  });
  const observed = closing.then((value) => ({ value, error: null }), (error) => ({ value: null, error }));
  try {
    await lockReached;
    await other.$transaction(async (tx) => {
      const lock = await tx.experiment.updateMany({
        where: { id: experiment.id, merchantId, enrollmentClosedAt: null },
        data: { lifecycleVersion: 2 },
      });
      assert.equal(lock.count, 1);
      await createAssignment(tx, "late-close-visitor", new Date("2026-09-14T23:59:59Z"));
    });
  } finally { releaseLock(); }
  const outcome = await observed;
  if (outcome.error) throw outcome.error;
  assert.equal(outcome.value!.changed, true);
  assert.equal(outcome.value!.experiment.attributionClosesAt?.toISOString(), "2026-09-21T23:59:59.000Z");
  assert.equal(outcome.value!.experiment.financialMaturityAt?.toISOString(), "2026-09-28T23:59:59.000Z");
  const audit = await db.auditLog.findFirstOrThrow({ where: { resourceId: experiment.id, action: "V2_EXPERIMENT_ENROLLMENT_CLOSED" } });
  assert.equal(JSON.parse(audit.detailsJson!).actualCohortSize, 2);
  return { concurrentAssignmentIncluded: true, frozenCohortSize: 2, closePath: "HARD_DEADLINE_WITHOUT_CHECKOUT_FLOOR",
    attributionClosesAt: outcome.value!.experiment.attributionClosesAt!.toISOString() };
}

import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  canonicalQueuePayload,
  QueueIdempotencyConflictError,
} from "./job-outbox.server";
import { createDiagnosisDraftV2 } from "./message-diagnosis-v2.server";
import { assertPrivacyAnalysisUsable } from "./privacy-analysis.server";
import { subscriptionAllowsApprovedServingV2 } from "./subscription-v2.server";
import {
  installV2Deployment,
  StaleDeploymentRevisionError,
} from "./v2-deployment.server";

function inputHash(value: unknown) {
  return createHash("sha256")
    .update(canonicalQueuePayload(value))
    .digest("hex");
}

function validActionKey(value: string) {
  if (!/^[A-Za-z0-9_:.~-]{8,140}$/.test(value))
    throw new Error("ACTION_IDEMPOTENCY_KEY_INVALID");
  return value;
}

async function finalResultContext(args: {
  db: PrismaClient;
  merchantId: string;
  resultSnapshotId: string;
}) {
  const snapshot = await args.db.experimentResultSnapshot.findFirst({
    where: {
      id: args.resultSnapshotId,
      experiment: { merchantId: args.merchantId, lifecycleVersion: 2 },
    },
    include: {
      experiment: {
        include: { product: true, registration: true },
      },
    },
  });
  if (!snapshot) throw new Error("RESULT_SNAPSHOT_UNAVAILABLE");
  if (snapshot.experiment.finalResultSnapshotId !== snapshot.id)
    throw new Error("RESULT_SNAPSHOT_NOT_FINAL");
  if (!snapshot.experiment.finalizedAt) throw new Error("RESULT_NOT_FINALIZED");
  assertPrivacyAnalysisUsable(snapshot.experiment);
  return snapshot;
}

export async function keepV2Message(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  resultSnapshotId: string;
  contentVersionId: string;
  expectedRevision: number;
  idempotencyKey: string;
  now?: Date;
}) {
  const key = validActionKey(args.idempotencyKey);
  const now = args.now ?? new Date();
  const snapshot = await finalResultContext(args);
  if (snapshot.resultState !== "POSITIVE")
    throw new Error("RESULT_NOT_ELIGIBLE_TO_KEEP");
  if (snapshot.experiment.controlPolicy === snapshot.experiment.treatmentPolicy)
    throw new Error("VALIDATION_RESULT_CANNOT_BE_KEPT");
  if (
    !new Set(["UNIVERSAL", "MATCHED"]).has(snapshot.experiment.treatmentPolicy)
  )
    throw new Error("RESULT_TREATMENT_POLICY_UNSUPPORTED");
  const [experience, subscription] = await Promise.all([
    args.db.experienceVersion.findFirst({
      where: {
        id: args.contentVersionId,
        merchantId: args.merchantId,
        productId: snapshot.experiment.productId,
        status: "APPROVED_ACTIVE",
        staleAt: null,
      },
      include: { approval: true },
    }),
    args.db.subscriptionState.findUnique({
      where: { merchantId: args.merchantId },
    }),
  ]);
  if (!experience?.approval) throw new Error("APPROVED_CONTENT_UNAVAILABLE");
  let registeredContent: Array<{ id?: unknown; contentHash?: unknown }> = [];
  try {
    registeredContent = JSON.parse(
      snapshot.experiment.registration?.contentVersionsJson ?? "[]",
    ) as typeof registeredContent;
  } catch {
    /* fail closed below */
  }
  if (
    !registeredContent.some(
      (item) =>
        item.id === experience.id &&
        item.contentHash === experience.contentHash,
    )
  )
    throw new Error("RESULT_TREATMENT_CONTENT_NOT_REGISTERED");
  if (
    !subscription ||
    !subscriptionAllowsApprovedServingV2({
      status: subscription.authoritativeStatus,
      periodEnd: subscription.periodEnd,
      now,
    })
  )
    throw new Error("SUBSCRIPTION_AUTHORITY_REQUIRED");
  const authorityHash = inputHash({
    action: "KEEP_V2_MESSAGE",
    resultSnapshotId: snapshot.id,
    resultDataHash: snapshot.dataHash,
    contentVersionId: experience.id,
    contentHash: experience.contentHash,
    approvalId: experience.approval.id,
    approvalContentHash: experience.approval.contentHash,
    subscriptionId: subscription.id,
    subscriptionState: subscription.authoritativeStatus,
    providerPayloadHash: subscription.providerPayloadHash,
  });
  return installV2Deployment({
    db: args.db,
    merchantId: args.merchantId,
    productId: snapshot.experiment.productId,
    experimentId: null,
    contentVersionId: experience.id,
    policy: snapshot.experiment.treatmentPolicy as "UNIVERSAL" | "MATCHED",
    state: "ACTIVE",
    approvedAuthorityHash: authorityHash,
    expectedRevision: args.expectedRevision,
    idempotencyKey: `keep:${key}`,
    actor: args.actor,
    receiptAction: "KEEP_V2_MESSAGE",
    afterInstall: async ({ tx }) => {
      // installV2Deployment holds the runtime lock used by privacy
      // invalidation. Re-read the exact frozen-result authority inside that
      // transaction so a stale preflight cannot reinstall a withheld winner.
      const authority = await tx.experiment.findFirst({
        where: {
          id: snapshot.experiment.id,
          merchantId: args.merchantId,
          finalResultSnapshotId: snapshot.id,
        },
        select: { privacyAffectedAt: true },
      });
      if (!authority) throw new Error("RESULT_SNAPSHOT_NOT_FINAL");
      assertPrivacyAnalysisUsable(authority);
    },
  });
}

export async function stopV2Serving(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  deploymentId: string;
  expectedRevision: number;
  idempotencyKey: string;
}) {
  const key = validActionKey(args.idempotencyKey);
  const sourceDeployment = await args.db.deploymentVersion.findFirst({
    where: {
      id: args.deploymentId,
      merchantId: args.merchantId,
      revision: args.expectedRevision,
    },
  });
  if (!sourceDeployment) throw new StaleDeploymentRevisionError();
  const authorityHash = inputHash({
    action: "STOP_V2_SERVING",
    deploymentId: sourceDeployment.id,
    expectedRevision: sourceDeployment.revision,
    priorAuthorityHash: sourceDeployment.approvedAuthorityHash,
  });
  return installV2Deployment({
    db: args.db,
    merchantId: args.merchantId,
    productId: sourceDeployment.productId,
    planId: sourceDeployment.planId,
    policy: "ORIGINAL",
    state: "STOPPED",
    approvedAuthorityHash: authorityHash,
    expectedRevision: sourceDeployment.revision,
    idempotencyKey: `stop:${key}`,
    actor: args.actor,
    receiptAction: "STOP_V2_SERVING",
  });
}

export async function reviseV2Result(args: {
  db: PrismaClient;
  merchantId: string;
  actor: string;
  resultSnapshotId: string;
  reason: string;
  idempotencyKey: string;
}) {
  const key = validActionKey(args.idempotencyKey);
  const reason = args.reason.replace(/\s+/g, " ").trim().slice(0, 500);
  if (reason.length < 10) throw new Error("REVISION_REASON_REQUIRED");
  const snapshot = await finalResultContext(args);
  if (snapshot.experiment.controlPolicy === snapshot.experiment.treatmentPolicy)
    throw new Error("VALIDATION_RESULT_REQUIRES_REPAIR");
  const receiptKey = `result-revise:${key}`;
  const materialHash = inputHash({
    resultSnapshotId: snapshot.id,
    resultDataHash: snapshot.dataHash,
    productId: snapshot.experiment.productId,
    reason,
  });
  const prior = await args.db.actionReceipt.findUnique({
    where: {
      merchantId_idempotencyKey: {
        merchantId: args.merchantId,
        idempotencyKey: receiptKey,
      },
    },
  });
  if (prior) {
    if (prior.inputHash !== materialHash)
      throw new QueueIdempotencyConflictError();
    return {
      experience: await args.db.experienceVersion.findFirstOrThrow({
        where: { id: prior.responseRef, merchantId: args.merchantId },
      }),
      replayed: true,
    };
  }
  const drafted = await createDiagnosisDraftV2({
    db: args.db,
    merchantId: args.merchantId,
    productId: snapshot.experiment.productId,
    candidate: "alternative",
    actor: args.actor,
    assertActive: async (db) => {
      // Keep draft persistence ordered behind the same runtime authority as
      // privacy invalidation. External/local diagnosis preparation happens
      // before this short database transaction and cannot approve or serve a
      // result by itself.
      await db.runtimeControl.upsert({
        where: { merchantId: args.merchantId },
        create: { merchantId: args.merchantId },
        update: { merchantId: args.merchantId },
      });
      const authority = await db.experiment.findFirst({
        where: {
          id: snapshot.experiment.id,
          merchantId: args.merchantId,
          finalResultSnapshotId: snapshot.id,
        },
        select: { privacyAffectedAt: true },
      });
      if (!authority) throw new Error("RESULT_SNAPSHOT_NOT_FINAL");
      assertPrivacyAnalysisUsable(authority);
    },
  });
  if (!drafted.experience) throw new Error("NO_SUPPORTED_REVISION_OPPORTUNITY");
  await args.db.$transaction(async (tx) => {
    await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      update: { merchantId: args.merchantId },
    });
    const authority = await tx.experiment.findFirst({
      where: {
        id: snapshot.experiment.id,
        merchantId: args.merchantId,
        finalResultSnapshotId: snapshot.id,
      },
      select: { privacyAffectedAt: true },
    });
    if (!authority) throw new Error("RESULT_SNAPSHOT_NOT_FINAL");
    assertPrivacyAnalysisUsable(authority);
    await tx.actionReceipt.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "REVISE_V2_RESULT",
        idempotencyKey: receiptKey,
        inputHash: materialHash,
        responseRef: drafted.experience.id,
      },
    });
    await tx.auditLog.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor,
        action: "V2_RESULT_REVISION_REQUESTED",
        resourceType: "EXPERIENCE_VERSION",
        resourceId: drafted.experience.id,
        detailsJson: canonicalQueuePayload({
          resultSnapshotId: snapshot.id,
          reason,
        }),
      },
    });
  });
  return { experience: drafted.experience, replayed: false };
}

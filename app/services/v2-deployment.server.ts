import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  canonicalQueuePayload,
  enqueueOutboxEvent,
  QueueIdempotencyConflictError,
} from "./job-outbox.server";
import { authorizeV2ExperimentServing } from "./evaluation-entitlement-v2.server";
import { MVP_V2_PROTOCOL_VERSION } from "./mvp-v2";
import { validateRuntimeExperience } from "./runtime.server";
import { createMappingSnapshot } from "./adaptive-contracts";
import type { AdaptiveMappingSnapshot } from "./adaptive-contracts";

export type V2ServingPolicy = "ORIGINAL" | "UNIVERSAL" | "MATCHED";
export type V2DeploymentState = "ACTIVE" | "PAUSED" | "STOPPED";
export type AdaptiveBundleSet = {
  snapshot: AdaptiveMappingSnapshot;
  bundleIds: Record<string, string>;
  bundleHashes: Record<string, string>;
  bundleAuthorityHashes: Record<string, string>;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class StaleDeploymentRevisionError extends Error {
  code = "STALE_REVISION" as const;

  constructor() {
    super("The product deployment changed. Refresh before retrying this action.");
  }
}

export async function installV2Deployment(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  planId?: string | null;
  experimentId?: string | null;
  contentVersionId?: string | null;
  adaptiveBundleSet?: AdaptiveBundleSet | null;
  policy: V2ServingPolicy;
  state?: V2DeploymentState;
  approvedAuthorityHash: string;
  expectedRevision: number;
  idempotencyKey: string;
  actor?: string;
  receiptAction?: string;
  now?: Date;
  afterInstall?: (args: {
    tx: Prisma.TransactionClient;
    deployment: { id: string; revision: number };
    pointer: { deploymentVersionId: string; revision: number };
  }) => Promise<void>;
}) {
  if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0)
    throw new Error("Deployment revision must be a non-negative integer.");
  if (!args.idempotencyKey || args.idempotencyKey.length > 160)
    throw new Error("Invalid deployment idempotency key.");
  if (!/^[a-f0-9]{32,128}$/i.test(args.approvedAuthorityHash))
    throw new Error("Approved deployment authority is invalid.");

  const product = await args.db.product.findFirst({
    where: { id: args.productId, merchantId: args.merchantId, status: "ACTIVE" },
  });
  if (!product) throw new Error("The product is unavailable for this store.");

  const experience = args.contentVersionId
    ? await args.db.experienceVersion.findFirst({
        where: {
          id: args.contentVersionId,
          merchantId: args.merchantId,
          productId: args.productId,
        },
        include: {
          product: true,
          approval: true,
          claims: { include: { evidenceLinks: { include: { evidence: true } } } },
        },
      })
    : null;
  if (args.policy !== "ORIGINAL") {
    if (!experience) throw new Error("Approved deployment content is missing.");
    const failure = validateRuntimeExperience(experience);
    if (failure) throw new Error(`Approved deployment content failed: ${failure}.`);
  }
  if (args.policy === "ORIGINAL" && args.contentVersionId)
    throw new Error("Original deployments cannot carry treatment content.");
  if (args.adaptiveBundleSet) {
    if (args.policy === "ORIGINAL") throw new Error("Original deployments cannot carry adaptive bundles.");
    const bundleIds = Object.values(args.adaptiveBundleSet.bundleIds);
    const uniqueBundleIds = [...new Set(bundleIds)];
    const snapshotBundleIds = [...new Set(args.adaptiveBundleSet.snapshot.mappings.map((mapping) => mapping.bundleId))].sort();
    let snapshotTrusted = false;
    try {
      const rebuilt = createMappingSnapshot(
        args.adaptiveBundleSet.snapshot.mappings,
        args.adaptiveBundleSet.snapshot.version,
      );
      snapshotTrusted = rebuilt.hash === args.adaptiveBundleSet.snapshot.hash;
    } catch {
      snapshotTrusted = false;
    }
    if (
      !bundleIds.length ||
      bundleIds.some((id) => typeof id !== "string" || !id) ||
      uniqueBundleIds.length !== bundleIds.length ||
      canonicalQueuePayload(Object.keys(args.adaptiveBundleSet.bundleIds).sort()) !== canonicalQueuePayload(uniqueBundleIds.sort()) ||
      canonicalQueuePayload(snapshotBundleIds) !== canonicalQueuePayload(uniqueBundleIds.sort()) ||
      !snapshotTrusted
    ) {
      throw new Error("Adaptive bundle set is invalid.");
    }
    const bundles = await args.db.experienceVersion.findMany({
      where: { id: { in: bundleIds }, merchantId: args.merchantId, productId: args.productId },
      include: { product: true, approval: true, claims: { include: { evidenceLinks: { include: { evidence: true } } } } },
    });
    if (
      bundles.length !== uniqueBundleIds.length ||
      bundles.some(
        (bundle) =>
          validateRuntimeExperience(bundle) ||
          args.adaptiveBundleSet!.bundleHashes[bundle.id] !== bundle.contentHash,
      ) ||
      Object.keys(args.adaptiveBundleSet.bundleHashes).length !== uniqueBundleIds.length ||
      Object.keys(args.adaptiveBundleSet.bundleAuthorityHashes).length !== uniqueBundleIds.length ||
      Object.values(args.adaptiveBundleSet.bundleAuthorityHashes).some(
        (value) => !/^[a-f0-9]{64}$/.test(value),
      )
    ) {
      throw new Error("Adaptive bundle approval is missing or invalid.");
    }
  }

  const experiment = args.experimentId
    ? await args.db.experiment.findFirst({
        where: {
          id: args.experimentId,
          merchantId: args.merchantId,
          productId: args.productId,
        },
        include: { registration: true },
      })
    : null;
  if (args.experimentId && !experiment)
    throw new Error("The experiment is unavailable for this store and product.");
  if (
    experiment &&
    experiment.registration?.protocolVersion !== MVP_V2_PROTOCOL_VERSION
  )
    throw new Error("Only a registered Pagnetic v2 experiment can be deployed.");
  if (experiment) {
    const frozenPolicies = [experiment.controlPolicy, experiment.treatmentPolicy];
    if (
      frozenPolicies.some(
        (policy) => !["ORIGINAL", "UNIVERSAL", "MATCHED"].includes(policy),
      )
    )
      throw new Error("The experiment contains an unsupported serving policy.");
    if (args.policy !== experiment.treatmentPolicy)
      throw new Error("The deployment must use the experiment's frozen treatment policy.");
    if (frozenPolicies.some((policy) => policy !== "ORIGINAL")) {
      if (!experience)
        throw new Error("The experiment's approved content is missing.");
      const failure = validateRuntimeExperience(experience);
      if (failure)
        throw new Error(`Approved experiment content failed: ${failure}.`);
      let frozenContent: Array<{ id?: unknown; contentHash?: unknown }> = [];
      try {
        frozenContent = JSON.parse(
          experiment.registration!.contentVersionsJson,
        ) as typeof frozenContent;
      } catch {
        /* fail closed below */
      }
      if (
        !frozenContent.some(
          (item) =>
            item.id === experience.id &&
            item.contentHash === experience.contentHash,
        )
      ) {
        throw new Error("The deployment content is not frozen in the experiment registration.");
      }
      if (args.adaptiveBundleSet) {
        for (const bundleId of Object.values(args.adaptiveBundleSet.bundleIds)) {
          if (!frozenContent.some((item) => item.id === bundleId)) {
            throw new Error("An adaptive bundle is not frozen in the experiment registration.");
          }
        }
      }
    }
  }

  const receiptKey = `deployment:${args.idempotencyKey}`;
  const material = {
    schemaVersion: 2,
    merchantId: args.merchantId,
    productId: args.productId,
    planId: args.planId ?? null,
    experimentId: args.experimentId ?? null,
    contentVersionId: args.contentVersionId ?? null,
    adaptiveBundleSet: args.adaptiveBundleSet ?? null,
    policy: args.policy,
    state: args.state ?? "ACTIVE",
    approvedAuthorityHash: args.approvedAuthorityHash,
    expectedRevision: args.expectedRevision,
    receiptAction: args.receiptAction ?? "INSTALL_V2_DEPLOYMENT",
  };
  const canonicalPayload = canonicalQueuePayload(material);
  const inputHash = hash(canonicalPayload);

  return args.db.$transaction(async (tx) => {
    // Every v2 deployment has a concrete runtime-control row. The decision
    // service locks this row together with the product pointer so a global
    // kill-switch change and a serving decision have a deterministic order.
    await tx.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: { merchantId: args.merchantId },
      // A nonempty update is intentional: PostgreSQL must acquire this row's
      // write lock before reading action receipts or the product revision.
      // Prisma can optimize an empty update into a read-only upsert, allowing
      // two writers to read the same revision and leak a P2002 conflict.
      // Lock order matches decisions: runtime control, then product/pointer.
      update: { merchantId: args.merchantId },
    });
    const prior = await tx.actionReceipt.findUnique({
      where: {
        merchantId_idempotencyKey: {
          merchantId: args.merchantId,
          idempotencyKey: receiptKey,
        },
      },
    });
    if (prior) {
      if (prior.inputHash !== inputHash) throw new QueueIdempotencyConflictError();
      const deployment = await tx.deploymentVersion.findFirst({
        where: { id: prior.responseRef, merchantId: args.merchantId },
      });
      if (!deployment) throw new Error("Deployment receipt target is unavailable.");
      const pointer = await tx.activeDeployment.findUniqueOrThrow({
        where: { productId: args.productId },
      });
      return { deployment, pointer, replayed: true };
    }

    const current = await tx.activeDeployment.findUnique({
      where: { productId: args.productId },
    });
    if (current && current.merchantId !== args.merchantId)
      throw new Error("The active product deployment belongs to another store.");
    if ((current?.revision ?? 0) !== args.expectedRevision)
      throw new StaleDeploymentRevisionError();
    if (experiment) {
      await authorizeV2ExperimentServing({
        db: tx,
        merchantId: args.merchantId,
        experiment,
        now: args.now ?? new Date(),
      });
    }

    const revision = args.expectedRevision + 1;
    const deployment = await tx.deploymentVersion.create({
      data: {
        merchantId: args.merchantId,
        productId: args.productId,
        planId: args.planId ?? null,
        revision,
        protocolVersion: MVP_V2_PROTOCOL_VERSION,
        policy: args.policy,
        contentSetHash: args.adaptiveBundleSet
          ? hash(canonicalQueuePayload({
              snapshotHash: args.adaptiveBundleSet.snapshot.hash,
              bundleIds: args.adaptiveBundleSet.bundleIds,
              bundleHashes: args.adaptiveBundleSet.bundleHashes,
              bundleAuthorityHashes: args.adaptiveBundleSet.bundleAuthorityHashes,
            }))
          : experience?.contentHash ?? hash("ORIGINAL"),
        experimentId: experiment?.id ?? null,
        state: args.state ?? "ACTIVE",
        approvedAuthorityHash: args.approvedAuthorityHash,
        canonicalPayload,
      },
    });
    const pointer = await tx.activeDeployment.upsert({
      where: { productId: args.productId },
      create: {
        merchantId: args.merchantId,
        productId: args.productId,
        deploymentVersionId: deployment.id,
        revision,
      },
      update: { deploymentVersionId: deployment.id, revision },
    });
    if (args.afterInstall) {
      await args.afterInstall({ tx, deployment, pointer });
    }
    await enqueueOutboxEvent({
      db: tx,
      merchantId: args.merchantId,
      type: "DEPLOYMENT_ADVANCED",
      aggregateType: "DEPLOYMENT",
      aggregateId: deployment.id,
      idempotencyKey: `deployment:${deployment.id}:revision:${revision}`,
      payload: {
        deploymentId: deployment.id,
        productId: args.productId,
        revision,
        policy: args.policy,
        state: args.state ?? "ACTIVE",
      },
    });
    await tx.actionReceipt.create({
      data: {
        merchantId: args.merchantId,
        actor: args.actor ?? "SYSTEM",
        action: args.receiptAction ?? "INSTALL_V2_DEPLOYMENT",
        idempotencyKey: receiptKey,
        inputHash,
        responseRef: deployment.id,
      },
    });
    return { deployment, pointer, replayed: false };
  });
}

export function pauseV2Deployment(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  expectedRevision: number;
  approvedAuthorityHash: string;
  idempotencyKey: string;
}) {
  return installV2Deployment({
    ...args,
    policy: "ORIGINAL",
    state: "PAUSED",
  });
}

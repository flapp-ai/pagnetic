import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { installV2Deployment, StaleDeploymentRevisionError } from "../../app/services/v2-deployment.server";

/** Two actual database clients; no mocked writes or weakened deployment authority. */
export async function rehearseDeploymentConcurrency(db: PrismaClient, other: PrismaClient) {
  const merchantId = "merchant-a";
  const productId = "product-deployment-race";
  const source = await db.product.findUniqueOrThrow({ where: { id: "product-a" } });
  await db.product.create({ data: {
    id: productId, merchantId, shopifyProductId: "gid://shopify/Product/999001",
    title: "Synthetic deployment race", handle: "synthetic-deployment-race", status: "ACTIVE",
    sourceVersion: source.sourceVersion, sourceHash: source.sourceHash, sourceSnapshot: source.sourceSnapshot,
  } });
  const base = { merchantId, productId, policy: "ORIGINAL" as const, approvedAuthorityHash: "a".repeat(64) };
  const initialRevision = (await db.activeDeployment.findUnique({ where: { productId } }))?.revision ?? 0;
  let revision = initialRevision;
  for (let round = 0; round < 6; round += 1) {
    const results = await Promise.allSettled([
      installV2Deployment({ ...base, db, expectedRevision: revision, idempotencyKey: `pg-race:${round}:a` }),
      installV2Deployment({ ...base, db: other, expectedRevision: revision, idempotencyKey: `pg-race:${round}:b` }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(loser.reason instanceof StaleDeploymentRevisionError,
      `Concurrent stale action must return STALE_REVISION, got ${loser.reason?.code ?? loser.reason?.message}`);
    revision += 1;
    assert.equal((await db.activeDeployment.findUniqueOrThrow({ where: { productId } })).revision, revision);
  }
  const replayKey = "pg-race:simultaneous-identical";
  const repeated = await Promise.all([
    installV2Deployment({ ...base, db, expectedRevision: revision, idempotencyKey: replayKey }),
    installV2Deployment({ ...base, db: other, expectedRevision: revision, idempotencyKey: replayKey }),
  ]);
  assert.equal(repeated[0].deployment.id, repeated[1].deployment.id);
  assert.equal(repeated.filter((result) => result.replayed).length, 1);
  assert.equal(await db.deploymentVersion.count({ where: { productId, revision: { gt: initialRevision } } }), 7);
  assert.equal(await db.actionReceipt.count({ where: { merchantId, idempotencyKey: { startsWith: "deployment:pg-race:" } } }), 7);
  const versions = await db.deploymentVersion.findMany({ where: { productId, revision: { gt: initialRevision } }, select: { id: true } });
  assert.equal(await db.outboxEvent.count({ where: { merchantId, aggregateId: { in: versions.map((item) => item.id) } } }), 7);
  return { clients: 2, contestedRevisions: 6, staleLosers: 6, identicalActionReplayed: true,
    committedDeployments: 7, receipts: 7, outboxEvents: 7, oneProductPointer: true };
}

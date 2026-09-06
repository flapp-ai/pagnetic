import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import type { CanonicalFinancialOrderV2 } from "./financial-v2";
import {
  financialSourceIsCompleteV2,
  netLineMerchandiseV2,
} from "./financial-v2";
import { verifyV2MeasurementReference } from "./v2-decision.server";
import { canonicalQueuePayload } from "./job-outbox.server";
import { assertOrderNotSuppressed } from "./order-privacy-guard.server";

type TransactionDb = Prisma.TransactionClient;

function referenceHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function referenceString(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? (value[key] as string) : null;
}

async function resolveReference(args: {
  db: TransactionDb;
  merchantId: string;
  line: CanonicalFinancialOrderV2["lines"][number];
  orderCreatedAt: Date;
  assignmentSecret: string;
}) {
  const signed = args.line.signedAssignmentReference;
  if (!signed) return null;
  const payload = verifyV2MeasurementReference(signed, args.assignmentSecret);
  if (!payload) return null;
  const productId = referenceString(payload, "productId");
  const assignmentId = referenceString(payload, "assignmentId");
  const experimentId = referenceString(payload, "experimentId");
  const decisionId = referenceString(payload, "decisionId");
  const deploymentId = referenceString(payload, "deploymentId");
  const merchantId = referenceString(payload, "merchantId");
  const expiresAtValue = referenceString(payload, "expiresAt");
  const issuedAtValue = referenceString(payload, "issuedAt");
  if (
    !productId ||
    !assignmentId ||
    !experimentId ||
    !decisionId ||
    !deploymentId ||
    merchantId !== args.merchantId ||
    !expiresAtValue ||
    !issuedAtValue
  )
    return null;
  const expiresAt = new Date(expiresAtValue);
  const issuedAt = new Date(issuedAtValue);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    !Number.isFinite(issuedAt.getTime())
  )
    return null;
  const [product, assignment, decision] = await Promise.all([
    args.db.product.findFirst({
      where: { id: productId, merchantId: args.merchantId },
      select: { id: true, shopifyProductId: true },
    }),
    args.db.assignment.findFirst({
      where: { id: assignmentId, merchantId: args.merchantId, experimentId },
    }),
    args.db.decision.findFirst({
      where: {
        id: decisionId,
        merchantId: args.merchantId,
        assignmentId,
        experimentId,
        productId,
        deploymentVersionId: deploymentId,
      },
    }),
  ]);
  if (
    !product ||
    !assignment ||
    !decision ||
    product.shopifyProductId !== args.line.productId ||
    assignment.expiresAt.getTime() !== expiresAt.getTime() ||
    decision.occurredAt.getTime() !== issuedAt.getTime() ||
    issuedAt < assignment.assignedAt ||
    issuedAt > args.orderCreatedAt ||
    args.orderCreatedAt < assignment.assignedAt ||
    args.orderCreatedAt >= assignment.expiresAt
  )
    return null;
  return { assignment, decision, signedRefHash: referenceHash(signed) };
}

async function refreshVisitorOutcome(
  db: TransactionDb,
  merchantId: string,
  assignmentId: string,
) {
  const assignment = await db.assignment.findFirstOrThrow({
    where: { id: assignmentId, merchantId },
  });
  // Different orders for one visitor must serialize projection refreshes too.
  // Lock before reading contributions so the second worker sees the first commit.
  await db.assignment.updateMany({
    where: { id: assignment.id, merchantId },
    data: { consentState: assignment.consentState },
  });
  const attributions = await db.attributionV2.findMany({
    where: { merchantId, assignmentId, status: "ACTIVE" },
    include: {
      orderLine: { include: { order: { include: { refunds: true } } } },
    },
  });
  let net = 0n;
  const paidOrders = new Set<string>();
  let watermark: Date | null = null;
  for (const attribution of attributions) {
    const line = attribution.orderLine;
    if (
      line.order.test ||
      line.order.reconciliationState !== "RECONCILED" ||
      line.giftCardProduct ||
      line.merchandiseAfterDiscountMinor == null
    )
      continue;
    let lineNet = BigInt(line.merchandiseAfterDiscountMinor);
    for (const refund of line.order.refunds) {
      if (
        refund.shopifyLineItemId === line.shopifyLineItemId &&
        refund.allocationState === "SETTLED"
      )
        lineNet -= BigInt(refund.amountMinor);
    }
    net += lineNet;
    paidOrders.add(line.orderId);
    if (!watermark || line.order.sourceUpdatedAt > watermark)
      watermark = line.order.sourceUpdatedAt;
  }
  return db.visitorOutcome.upsert({
    where: { assignmentId },
    create: {
      merchantId,
      experimentId: assignment.experimentId,
      assignmentId,
      netFocalRevenueMinor: net.toString(),
      paidOrders: paidOrders.size,
      sourceWatermark: watermark?.toISOString() ?? null,
      projectionVersion: "pagnetic-visitor-outcome-v2.1",
    },
    update: {
      netFocalRevenueMinor: net.toString(),
      paidOrders: paidOrders.size,
      sourceWatermark: watermark?.toISOString() ?? null,
      projectionVersion: "pagnetic-visitor-outcome-v2.1",
    },
  });
}

export async function reconcileCanonicalFinancialOrderV2(args: {
  db: PrismaClient;
  merchantId: string;
  order: CanonicalFinancialOrderV2;
  assignmentSecret: string;
  assertAuthority?: (tx: TransactionDb) => Promise<void>;
}) {
  if (args.order.merchantId !== args.merchantId)
    throw new Error(
      "Canonical order tenant does not match reconciliation tenant.",
    );
  if (args.assignmentSecret.trim().length < 32)
    throw new Error("Assignment verification is unavailable.");
  return args.db.$transaction(async (tx) => {
    await assertOrderNotSuppressed({
      tx,
      merchantId: args.merchantId,
      orderId: args.order.orderId,
    });
    await args.assertAuthority?.(tx);
    try {
      // Retain sanitized, immutable received facts even when a late revision is
      // stale for the operational projection. Such facts may be needed as-of a
      // previously frozen cutoff. Arrival time never selects financial authority.
      const immutableLinks = [];
      for (const line of args.order.lines) {
        if (line.giftCardProduct || line.sellingPlan) continue;
        const reference = await resolveReference({
          db: tx,
          merchantId: args.merchantId,
          line,
          orderCreatedAt: new Date(args.order.createdAt),
          assignmentSecret: args.assignmentSecret,
        });
        if (reference)
          immutableLinks.push({
            merchantId: args.merchantId,
            experimentId: reference.assignment.experimentId,
            assignmentId: reference.assignment.id,
            shopifyLineId: line.lineId,
            signedRefHash: reference.signedRefHash,
          });
      }
      const canonicalPayload = canonicalQueuePayload({
        ...args.order,
        observedAt: undefined,
        lines: [...args.order.lines].sort((a, b) =>
          a.lineId.localeCompare(b.lineId),
        ),
        transactions: [...args.order.transactions].sort((a, b) =>
          a.transactionId.localeCompare(b.transactionId),
        ),
        refunds: [...args.order.refunds]
          .map((refund) => ({
            ...refund,
            transactionIds: [...refund.transactionIds].sort(),
            lines: [...refund.lines].sort((a, b) =>
              a.refundLineKey.localeCompare(b.refundLineKey),
            ),
          }))
          .sort((a, b) => a.refundId.localeCompare(b.refundId)),
      });
      const revisionHash = referenceHash(
        canonicalQueuePayload({
          canonicalPayload,
          links: immutableLinks.sort((a, b) =>
            a.shopifyLineId.localeCompare(b.shopifyLineId),
          ),
        }),
      );
      const historicalLinks = await tx.financialRevisionLink.findMany({
        where: {
          merchantId: args.merchantId,
          revision: { shopifyOrderId: args.order.orderId },
        },
        select: { experimentId: true },
        distinct: ["experimentId"],
      });
      const experimentIds = [
        ...new Set(
          [...immutableLinks, ...historicalLinks].map(
            (link) => link.experimentId,
          ),
        ),
      ].sort();
      for (const experimentId of experimentIds)
        await tx.experiment.updateMany({
          where: {
            id: experimentId,
            merchantId: args.merchantId,
            lifecycleVersion: 2,
          },
          data: { lifecycleVersion: 2 },
        });
      const priorRevision = await tx.financialOrderRevision.findUnique({
        where: {
          merchantId_shopifyOrderId_revisionHash: {
            merchantId: args.merchantId,
            shopifyOrderId: args.order.orderId,
            revisionHash,
          },
        },
        select: { id: true },
      });
      const savedRevision = await tx.financialOrderRevision.upsert({
        where: {
          merchantId_shopifyOrderId_revisionHash: {
            merchantId: args.merchantId,
            shopifyOrderId: args.order.orderId,
            revisionHash,
          },
        },
        create: {
          merchantId: args.merchantId,
          shopifyOrderId: args.order.orderId,
          sourceUpdatedAt: new Date(args.order.sourceUpdatedAt),
          firstObservedAt: new Date(args.order.observedAt),
          sourceHash: args.order.sourceHash,
          revisionHash,
          canonicalPayload,
          links: { create: immutableLinks },
        },
        update: {},
      });
      if (!priorRevision && experimentIds.length) {
        const finalized = await tx.experiment.findMany({
          where: {
            id: { in: experimentIds },
            merchantId: args.merchantId,
            finalResultSnapshotId: { not: null },
          },
          select: { id: true, finalResultSnapshotId: true },
        });
        for (const experiment of finalized)
          await tx.auditLog.create({
            data: {
              merchantId: args.merchantId,
              actor: "SYSTEM",
              action: "V2_FINANCIAL_REVISION_AFTER_FINALIZATION",
              resourceType: "FinancialOrderRevision",
              resourceId: savedRevision.id,
              detailsJson: JSON.stringify({
                experimentId: experiment.id,
                finalResultSnapshotId: experiment.finalResultSnapshotId,
                sourceUpdatedAt: args.order.sourceUpdatedAt,
                revisionHash,
                reviewRequired: true,
              }),
            },
          });
      }
      const existing = await tx.orderLedger.findUnique({
        where: {
          merchantId_shopifyOrderId: {
            merchantId: args.merchantId,
            shopifyOrderId: args.order.orderId,
          },
        },
      });
      const incomingUpdatedAt = new Date(args.order.sourceUpdatedAt);
      if (existing) {
        const lease = await tx.orderLedger.updateMany({
          where: {
            id: existing.id,
            merchantId: args.merchantId,
            sourceUpdatedAt: existing.sourceUpdatedAt,
            sourceHash: existing.sourceHash,
            reconciliationState: existing.reconciliationState,
            updatedAt: existing.updatedAt,
          },
          data: { updatedAt: existing.updatedAt },
        });
        if (lease.count !== 1) throw new Error("STALE_FINANCIAL_SOURCE_RETRY");
      }
      if (existing && existing.sourceUpdatedAt > incomingUpdatedAt)
        return {
          order: existing,
          replayed: false,
          stale: true,
          conflicts: [] as string[],
        };
      const sameWatermark =
        existing?.sourceUpdatedAt.getTime() === incomingUpdatedAt.getTime();
      let existingComplete = false;
      try {
        existingComplete = Boolean(
          existing &&
          financialSourceIsCompleteV2(JSON.parse(existing.completenessJson)),
        );
      } catch {
        existingComplete = false;
      }
      const incomingComplete = financialSourceIsCompleteV2(
        args.order.completeness,
      );
      if (existing && sameWatermark && existingComplete && !incomingComplete) {
        // An incomplete retry is not contrary authoritative evidence. Preserve the
        // verified snapshot, while the inbox worker must still retry this fetch.
        return {
          order: existing,
          replayed: false,
          stale: true,
          conflicts: ["INCOMPLETE_SOURCE_IGNORED"],
        };
      }
      if (
        existing &&
        existing.sourceUpdatedAt.getTime() === incomingUpdatedAt.getTime() &&
        existing.sourceHash === args.order.sourceHash &&
        existingComplete === incomingComplete &&
        (existing.reconciliationState === args.order.reconciliationState ||
          ["SOURCE_CONFLICT", "ATTRIBUTION_CONFLICT"].includes(
            existing.reconciliationState,
          ))
      )
        return {
          order: existing,
          replayed: true,
          stale: false,
          conflicts: [] as string[],
        };
      if (
        existing &&
        existing.sourceUpdatedAt.getTime() === incomingUpdatedAt.getTime() &&
        existing.sourceHash !== args.order.sourceHash &&
        existingComplete &&
        incomingComplete
      ) {
        const order = await tx.orderLedger.update({
          where: { id: existing.id },
          data: { reconciliationState: "SOURCE_CONFLICT" },
        });
        const linkedAssignments = await tx.attributionV2.findMany({
          where: { orderLine: { orderId: existing.id } },
          select: { assignmentId: true },
          distinct: ["assignmentId"],
        });
        for (const attribution of linkedAssignments)
          await refreshVisitorOutcome(
            tx,
            args.merchantId,
            attribution.assignmentId,
          );
        return {
          order,
          replayed: false,
          stale: false,
          conflicts: ["EQUAL_WATERMARK_CONFLICT"],
        };
      }

      const orderData = {
        sourceUpdatedAt: incomingUpdatedAt,
        shopCurrency: args.order.currency,
        originalObligationMinor: args.order.originalObligation.minor,
        paymentState: args.order.paymentState,
        test: args.order.test,
        cancelledAt: args.order.cancelledAt
          ? new Date(args.order.cancelledAt)
          : null,
        reconciliationState: args.order.reconciliationState,
        sourceWatermark: args.order.sourceUpdatedAt,
        sourceHash: args.order.sourceHash,
        completenessJson: JSON.stringify(args.order.completeness),
      };
      // Creation must not use upsert: a concurrent newer creator would otherwise
      // be overwritten after this transaction observed no existing row.
      const order = existing
        ? await tx.orderLedger.update({
            where: { id: existing.id },
            data: orderData,
          })
        : await tx.orderLedger.create({
            data: {
              merchantId: args.merchantId,
              shopifyOrderId: args.order.orderId,
              shopifyCreatedAt: new Date(args.order.createdAt),
              ...orderData,
            },
          });

      const touchedAssignments = new Set(
        (
          await tx.attributionV2.findMany({
            where: { orderLine: { orderId: order.id } },
            select: { assignmentId: true },
            distinct: ["assignmentId"],
          })
        ).map((attribution) => attribution.assignmentId),
      );
      const ledgerLines = new Map<
        string,
        Awaited<ReturnType<typeof tx.orderLedgerLine.upsert>>
      >();
      for (const line of args.order.lines) {
        const ledgerLine = await tx.orderLedgerLine.upsert({
          where: {
            orderId_shopifyLineItemId: {
              orderId: order.id,
              shopifyLineItemId: line.lineId,
            },
          },
          create: {
            orderId: order.id,
            shopifyLineItemId: line.lineId,
            shopifyProductId: line.productId,
            shopifyVariantId: line.variantId,
            merchandiseAfterDiscountMinor:
              line.merchandiseBeforeRefunds?.minor ?? null,
            currencyCode: args.order.currency,
            giftCardProduct: line.giftCardProduct,
            allocationState: line.merchandiseBeforeRefunds
              ? "RESOLVED"
              : "UNRESOLVED",
          },
          update: {
            shopifyProductId: line.productId,
            shopifyVariantId: line.variantId,
            merchandiseAfterDiscountMinor:
              line.merchandiseBeforeRefunds?.minor ?? null,
            currencyCode: args.order.currency,
            giftCardProduct: line.giftCardProduct,
            allocationState: line.merchandiseBeforeRefunds
              ? "RESOLVED"
              : "UNRESOLVED",
          },
        });
        ledgerLines.set(line.lineId, ledgerLine);
      }
      await tx.orderLedgerLine.updateMany({
        where: {
          orderId: order.id,
          ...(args.order.lines.length > 0
            ? {
                shopifyLineItemId: {
                  notIn: args.order.lines.map((line) => line.lineId),
                },
              }
            : {}),
        },
        data: {
          merchandiseAfterDiscountMinor: null,
          allocationState: "SUPERSEDED",
        },
      });

      const currentRefundKeys: string[] = [];
      for (const refund of args.order.refunds) {
        for (const line of refund.lines) {
          const ledgerLine = ledgerLines.get(line.lineId);
          const sourceKey = `${refund.refundId}:${line.refundLineKey}`;
          currentRefundKeys.push(sourceKey);
          await tx.refundLedger.upsert({
            where: {
              merchantId_sourceKey: { merchantId: args.merchantId, sourceKey },
            },
            create: {
              merchantId: args.merchantId,
              orderId: ledgerLine ? order.id : null,
              shopifyOrderId: args.order.orderId,
              shopifyRefundId: refund.refundId,
              shopifyTransactionId: refund.transactionIds[0] ?? null,
              shopifyLineItemId: line.lineId,
              sourceKey,
              amountMinor: line.merchandise?.minor ?? "0",
              currencyCode: args.order.currency,
              sourceOccurredAt: new Date(refund.sourceUpdatedAt),
              allocationState: ledgerLine
                ? line.settlementState
                : "PENDING_PARENT",
            },
            update: {
              orderId: ledgerLine ? order.id : null,
              shopifyTransactionId: refund.transactionIds[0] ?? null,
              amountMinor: line.merchandise?.minor ?? "0",
              sourceOccurredAt: new Date(refund.sourceUpdatedAt),
              allocationState: ledgerLine
                ? line.settlementState
                : "PENDING_PARENT",
            },
          });
        }
      }
      await tx.refundLedger.updateMany({
        where: {
          merchantId: args.merchantId,
          shopifyOrderId: args.order.orderId,
          ...(currentRefundKeys.length > 0
            ? { sourceKey: { notIn: currentRefundKeys } }
            : {}),
        },
        data: { allocationState: "SUPERSEDED" },
      });

      const conflicts: string[] = [];
      for (const line of args.order.lines) {
        const ledgerLine = ledgerLines.get(line.lineId)!;
        const prior = await tx.attributionV2.findFirst({
          where: { orderLineId: ledgerLine.id },
        });
        const reference = await resolveReference({
          db: tx,
          merchantId: args.merchantId,
          line,
          orderCreatedAt: new Date(args.order.createdAt),
          assignmentSecret: args.assignmentSecret,
        });
        if (
          prior &&
          (!reference || ledgerLine.giftCardProduct || line.sellingPlan)
        ) {
          await tx.attributionV2.update({
            where: { id: prior.id },
            data: {
              status: "SUPERSEDED",
              reason: reference
                ? "LINE_INELIGIBLE"
                : "REFERENCE_AUTHORITY_UNAVAILABLE",
              correctedAt: incomingUpdatedAt,
            },
          });
          touchedAssignments.add(prior.assignmentId);
          if (!reference && !line.signedAssignmentReference)
            conflicts.push(`MISSING_PREVIOUS_REFERENCE:${line.lineId}`);
        }
        if (line.signedAssignmentReference && !reference) {
          conflicts.push(`INVALID_REFERENCE:${line.lineId}`);
          continue;
        }
        if (!reference || ledgerLine.giftCardProduct || line.sellingPlan)
          continue;
        if (
          prior &&
          (prior.assignmentId !== reference.assignment.id ||
            prior.experimentId !== reference.assignment.experimentId)
        ) {
          conflicts.push(`CONTRADICTORY_REFERENCE:${line.lineId}`);
          continue;
        }
        const status = args.order.test
          ? "TEST_ONLY"
          : args.order.reconciliationState === "RECONCILED"
            ? "ACTIVE"
            : "FINANCIAL_PENDING";
        await tx.attributionV2.upsert({
          where: {
            orderLineId_experimentId: {
              orderLineId: ledgerLine.id,
              experimentId: reference.assignment.experimentId,
            },
          },
          create: {
            merchantId: args.merchantId,
            orderLineId: ledgerLine.id,
            assignmentId: reference.assignment.id,
            experimentId: reference.assignment.experimentId,
            joinMethod: "SIGNED_LINE_REFERENCE_V2",
            signedRefHash: reference.signedRefHash,
            validAt: new Date(args.order.createdAt),
            reason: status === "ACTIVE" ? "VERIFIED_IN_WINDOW" : status,
            status,
          },
          update: {
            signedRefHash: reference.signedRefHash,
            reason: status === "ACTIVE" ? "VERIFIED_IN_WINDOW" : status,
            status,
          },
        });
        touchedAssignments.add(reference.assignment.id);
      }
      if (conflicts.length > 0) {
        await tx.orderLedger.update({
          where: { id: order.id },
          data: { reconciliationState: "ATTRIBUTION_CONFLICT" },
        });
        await tx.auditLog.create({
          data: {
            merchantId: args.merchantId,
            actor: "SYSTEM",
            action: "V2_ATTRIBUTION_CONFLICT",
            resourceType: "OrderLedger",
            resourceId: order.id,
            detailsJson: JSON.stringify({ conflicts }),
          },
        });
      }
      for (const assignmentId of [...touchedAssignments].sort())
        await refreshVisitorOutcome(tx, args.merchantId, assignmentId);
      const current = await tx.orderLedger.findUniqueOrThrow({
        where: { id: order.id },
      });
      return { order: current, replayed: false, stale: false, conflicts };
    } finally {
      // The first check locks the exact authority row for this transaction. The
      // final check also prevents a transaction that outlives its lease from
      // committing any canonical facts or derived projections.
      await args.assertAuthority?.(tx);
    }
  });
}

export function canonicalLineNetForTest(
  order: CanonicalFinancialOrderV2,
  lineId: string,
) {
  return netLineMerchandiseV2(order, lineId);
}

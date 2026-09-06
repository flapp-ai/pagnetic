import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { canonicalQueuePayload } from "./job-outbox.server";
import {
  evaluateQualificationV2,
  QUALIFICATION_V2_VERSION,
  type QualificationV2Input,
} from "./qualification-v2";

export async function snapshotQualificationV2(args: {
  db: PrismaClient;
  merchantId: string;
  productId: string;
  input: QualificationV2Input;
}) {
  const product = await args.db.product.findFirst({
    where: {
      id: args.productId,
      merchantId: args.merchantId,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!product) throw new Error("QUALIFICATION_PRODUCT_UNAVAILABLE");
  const result = evaluateQualificationV2(args.input);
  const snapshotHash = createHash("sha256").update(canonicalQueuePayload({
    merchantId: args.merchantId,
    productId: product.id,
    evidence: result.canonicalPayload,
  })).digest("hex");
  return args.db.qualificationSnapshot.upsert({
    where: { snapshotHash },
    create: {
      merchantId: args.merchantId,
      productId: product.id,
      observationStart: args.input.observationStart,
      observationEnd: args.input.observationEnd,
      dataSource: args.input.dataSource,
      eligibleVisitors: args.input.eligibleVisitors,
      eligibleSessions: args.input.eligibleSessions,
      paidPurchasers: args.input.paidPurchasers,
      revenueMeanMinor: result.revenueMeanMinor,
      revenueVariance: result.revenueVariance,
      currencyCode: args.input.currencyCode,
      coverage: args.input.coverage,
      targetEffect: args.input.targetEffect,
      targetVisitors: result.targetVisitors,
      forecastLowDays: result.forecastLowDays,
      forecastHighDays: result.forecastHighDays,
      status: result.status,
      version: QUALIFICATION_V2_VERSION,
      canonicalPayload: result.canonicalPayload,
      snapshotHash,
    },
    update: {},
  });
}

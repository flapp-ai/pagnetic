import type { PrismaClient } from "@prisma/client";

export async function disableMerchantAfterUninstall(args: {
  db: PrismaClient;
  merchantId: string;
  shop: string;
  shopHash: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  await args.db.$transaction([
    args.db.runtimeControl.upsert({
      where: { merchantId: args.merchantId },
      create: {
        merchantId: args.merchantId,
        killSwitch: true,
        reason: "App uninstalled",
        activatedBy: "SHOPIFY_WEBHOOK",
        activatedAt: now,
      },
      update: {
        killSwitch: true,
        reason: "App uninstalled",
        activatedBy: "SHOPIFY_WEBHOOK",
        activatedAt: now,
      },
    }),
    args.db.experiment.updateMany({
      where: { merchantId: args.merchantId, status: "ACTIVE" },
      data: { status: "PAUSED", endedAt: now },
    }),
    args.db.autopilotPlan.updateMany({
      where: {
        merchantId: args.merchantId,
        state: { notIn: ["RESULT_READY", "INVALIDATED"] },
      },
      data: {
        state: "INVALIDATED",
        lockToken: null,
        lockExpiresAt: null,
      },
    }),
    args.db.pixelCredential.updateMany({
      where: { merchantId: args.merchantId },
      data: { status: "INACTIVE" },
    }),
    args.db.job.updateMany({
      where: {
        merchantId: args.merchantId,
        type: { in: ["AUTOPILOT_PREPARATION", "CLOSE_ENROLLMENT"] },
        status: { in: ["PENDING", "RETRY", "RUNNING"] },
      },
      data: {
        status: "CANCELLED",
        leaseToken: null,
        leaseUntil: null,
        lastErrorCode: "APP_UNINSTALLED",
      },
    }),
    args.db.privacyRequest.create({
      data: {
        shopHash: args.shopHash,
        requestType: "APP_UNINSTALLED",
        status: "PENDING_SHOP_REDACT",
        detailsJson: JSON.stringify({ runtimeDisabled: true }),
      },
    }),
    args.db.session.deleteMany({ where: { shop: args.shop } }),
  ]);
}

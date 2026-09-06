import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { receiveCustomerPrivacyRequest } from "./customer-privacy-scope.server";
import { privacyLookupKeyId, privacyLookupKeys } from "./privacy-lookup-keys.server";

export function privacyHash(secret: string, value: unknown) {
  return createHash("sha256")
    .update(`${secret}:${String(value ?? "unknown")}`)
    .digest("hex");
}

export function privacySecret(environment = process.env) {
  return privacyLookupKeys(environment).active;
}

export async function processPrivacyWebhook(args: {
  db: PrismaClient;
  shop: string;
  type: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT";
  payload: Record<string, unknown>;
  secret: string;
  scopeSecret?: string;
  now?: Date;
  lookupSecrets?: string[];
  webhookId?: string;
  eventId?: string;
  triggeredAt?: string;
}) {
  const customer =
    args.payload.customer && typeof args.payload.customer === "object"
      ? (args.payload.customer as Record<string, unknown>)
      : null;
  const subject = customer?.id ?? args.payload.customer_id ?? null;
  const shopHash = privacyHash(args.secret, args.shop);
  const subjectHash =
    subject == null ? null : privacyHash(args.secret, subject);
  if (args.type !== "SHOP_REDACT")
    return receiveCustomerPrivacyRequest({
      ...args,
      type: args.type,
      shopHash,
      subjectHash,
    });
  const now = args.now ?? new Date();
  return args.db.$transaction(async (tx) => {
    const details = {
      directCustomerProfileDataStored: false,
      pseudonymousTelemetryStored: true,
      customerIdentityJoinAvailable: false,
      telemetryUsesOpaqueVisitorIdentifiers: true,
      merchantDeleted: true,
      activeMerchantDataDeleted: true,
      retainedPrivacyWorkflowRecords: true,
      backupErasureVerified: false,
      financialOrderRevisionsDeleted: 0,
      financialRevisionLinksDeleted: 0,
      evaluationConsumptionsDeleted: 0,
    };

    const [
      financialOrderRevisionsDeleted,
      financialRevisionLinksDeleted,
      evaluationConsumptionsDeleted,
    ] = await Promise.all([
      tx.financialOrderRevision.count({
        where: { merchant: { shop: args.shop } },
      }),
      tx.financialRevisionLink.count({
        where: { revision: { merchant: { shop: args.shop } } },
      }),
      tx.evaluationConsumption.count({
        where: { merchant: { shop: args.shop } },
      }),
    ]);
    details.financialOrderRevisionsDeleted = financialOrderRevisionsDeleted;
    details.financialRevisionLinksDeleted = financialRevisionLinksDeleted;
    details.evaluationConsumptionsDeleted = evaluationConsumptionsDeleted;
    await tx.merchant.deleteMany({ where: { shop: args.shop } });
    await tx.session.deleteMany({ where: { shop: args.shop } });
    return tx.privacyRequest.create({
      data: {
        shopHash,
        requestType: args.type,
        subjectHash,
        lookupKeyId: privacyLookupKeyId(args.secret),
        status: "ACTIVE_DATA_DELETED_BACKUP_REVIEW",
        detailsJson: JSON.stringify(details),
        requestedAt: now,
        dueAt: new Date(now.getTime() + 30 * 86_400_000),
      },
    });
  });
}

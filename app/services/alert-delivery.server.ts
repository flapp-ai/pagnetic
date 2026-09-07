import type { PrismaClient } from "@prisma/client";

import {
  claimOutboxEvents,
  enqueueOutboxEvent,
  failOutboxEvent,
  markOutboxDelivered,
  skipOutboxEvent,
} from "./job-outbox.server";
type Alert = { id: string; severity: string; kind: string; summary: string };

const REMOTE_SEVERITIES = new Set(["SEV1"]);
const REMOTE_FAILURE_KINDS = new Set(["AUTOMATION_FAILURE"]);

function isRemoteActionable(alert: Alert) {
  return (
    REMOTE_SEVERITIES.has(alert.severity) ||
    REMOTE_FAILURE_KINDS.has(alert.kind)
  );
}

function configuredEndpoint(environment: NodeJS.ProcessEnv) {
  if (!environment.ALERT_WEBHOOK_URL) return null;
  const url = new URL(environment.ALERT_WEBHOOK_URL);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("INVALID_ALERT_ENDPOINT");
  return url.toString();
}

async function postAlerts(
  endpoint: string,
  alerts: Alert[],
  fetchImpl: typeof fetch,
  deliveryId?: string,
) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(deliveryId ? { "Idempotency-Key": deliveryId } : {}),
    },
    body: JSON.stringify({ source: "pagnetic", deliveryId, alerts }),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`ALERT_HTTP_${response.status}`);
}

/** Local notice existence and remote delivery are separate facts. */
export async function deliverOperationalAlerts(args: {
  db: PrismaClient;
  merchantId: string;
  alerts: Alert[];
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
}) {
  const environment = args.environment ?? process.env;
  const endpoint = configuredEndpoint(environment);
  const fetchImpl = args.fetchImpl ?? fetch;
  const currentTime = () => args.now ?? new Date();
  if (!endpoint)
    return { status: "NOT_CONFIGURED", delivered: 0, failed: 0, skipped: 0 };
  // Retry payload is the immutable snapshot from this incident's first enqueue.
  // Repeated observations or changed summary text do not create another delivery.
  // Lower-severity notices remain visible in-app without consuming remote-alert
  // operations. This behavior is independent of the storefront V2 rollout.
  for (const alert of args.alerts
    .filter(isRemoteActionable)
    .slice(0, 100)) {
    await args.db.$transaction(async (tx) => {
      const current = await tx.operationalAlert.findFirst({
        where: { id: alert.id, merchantId: args.merchantId, status: "OPEN" },
      });
      if (!current) return;
      const idempotencyKey = `alert:${current.id}:${current.openedAt.toISOString()}`;
      if (
        await tx.outboxEvent.findUnique({
          where: {
            merchantId_idempotencyKey: {
              merchantId: args.merchantId,
              idempotencyKey,
            },
          },
        })
      )
        return;
      await enqueueOutboxEvent({
        db: tx,
        merchantId: args.merchantId,
        type: "NOTIFY_ALERT",
        aggregateType: "OperationalAlert",
        aggregateId: current.id,
        idempotencyKey,
        payload: {
          incidentOpenedAt: current.openedAt.toISOString(),
          alert: {
            id: current.id,
            severity: current.severity,
            kind: current.kind,
            summary: current.summary.slice(0, 500),
          },
        },
        nextRunAt: currentTime(),
      });
    });
  }
  const events = await claimOutboxEvents({
    db: args.db,
    workerId: "alert-delivery",
    merchantId: args.merchantId,
    types: ["NOTIFY_ALERT"],
    now: currentTime(),
    limit: 5,
  });
  const outcomes = await Promise.all(
    events.map(async (event) => {
      try {
        const payload = JSON.parse(event.payloadJson) as {
          incidentOpenedAt: string;
          alert: Alert;
        };
        const current = await args.db.operationalAlert.findFirst({
          where: {
            id: event.aggregateId,
            merchantId: args.merchantId,
            status: "OPEN",
          },
        });
        if (
          !current ||
          current.openedAt.toISOString() !== payload.incidentOpenedAt
        ) {
          await skipOutboxEvent({
            db: args.db,
            merchantId: args.merchantId,
            eventId: event.id,
            leaseToken: event.leaseToken!,
            reason: "INCIDENT_NO_LONGER_OPEN",
            now: currentTime(),
          });
          return "skipped";
        }
        if (payload.alert.id !== current.id)
          throw new Error("INVALID_ALERT_PAYLOAD");
        if (!event.leaseUntil || event.leaseUntil <= currentTime())
          throw new Error("STALE_OUTBOX_LEASE");
        await postAlerts(endpoint, [payload.alert], fetchImpl, event.id);
        await markOutboxDelivered({
          db: args.db,
          merchantId: args.merchantId,
          eventId: event.id,
          leaseToken: event.leaseToken!,
          deliveredAt: currentTime(),
        });
        return "delivered";
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = /^ALERT_HTTP_\d{3}$/.test(message)
          ? message
          : "ALERT_DELIVERY_FAILED";
        await failOutboxEvent({
          db: args.db,
          merchantId: args.merchantId,
          eventId: event.id,
          leaseToken: event.leaseToken!,
          errorCode: code,
          now: currentTime(),
        });
        return "failed";
      }
    }),
  );
  const count = (status: string) =>
    outcomes.filter((value) => value === status).length;
  return {
    status: count("failed")
      ? "RETRY_PENDING"
      : events.length
        ? "PROCESSED"
        : "IDLE",
    delivered: count("delivered"),
    failed: count("failed"),
    skipped: count("skipped"),
  };
}

import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { automationAuthorized } from "../services/automation-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!automationAuthorized(request))
    return Response.json({ ok: false }, { status: 401 });
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [events, installations, activations, results] = await Promise.all([
    prisma.publicFunnelEvent.findMany({
      where: { occurredAt: { gte: since } },
      select: { eventType: true, anonymousIdHash: true },
    }),
    prisma.merchant.count({ where: { installedAt: { gte: since } } }),
    prisma.betaEntitlement.count({
      where: {
        heroProductId: { not: null },
        activationStartedAt: { gte: since },
      },
    }),
    prisma.betaEntitlement.count({
      where: { firstValidResultAt: { gte: since } },
    }),
  ]);
  const count = (eventType: string) =>
    events.filter((event) => event.eventType === eventType).length;
  const unique = (eventType: string) =>
    new Set(
      events
        .filter((event) => event.eventType === eventType)
        .map((event) => event.anonymousIdHash),
    ).size;
  const successfulScans = count("SCAN_SUCCEEDED");
  const failedScans = count("SCAN_FAILED");
  return Response.json(
    {
      ok: true,
      windowDays: 30,
      publicPreview: {
        successfulScans,
        failedScans,
        uniqueSuccessfulVisitors: unique("SCAN_SUCCEEDED"),
        successRate:
          successfulScans + failedScans
            ? successfulScans / (successfulScans + failedScans)
            : null,
      },
      productFunnel: {
        installations,
        heroProductActivations: activations,
        validResults: results,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
};

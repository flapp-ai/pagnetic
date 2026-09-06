import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { automationAuthorized } from "../services/automation-auth.server";
import {
  enforcePublicFunnelRetention,
  runMerchantAutomation,
} from "../services/automation.server";
import { unauthenticated } from "../shopify.server";

export const loader = async () => Response.json({ ok: false }, { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!automationAuthorized(request))
    return Response.json({ ok: false }, { status: 401 });
  const merchants = await prisma.merchant.findMany({
    select: { id: true, shop: true },
  });
  const results: Array<{
    shop: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }> = [];
  const queue = [...merchants];
  const worker = async () => {
    for (;;) {
      const merchant = queue.shift();
      if (!merchant) return;
      try {
        const { admin } = await unauthenticated.admin(merchant.shop);
        const result = await runMerchantAutomation({
          db: prisma,
          merchantId: merchant.id,
          shop: merchant.shop,
          graphql: (query, options) => admin.graphql(query, options),
        });
        results.push({ shop: merchant.shop, ok: true, result });
      } catch (error) {
        results.push({
          shop: merchant.shop,
          ok: false,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, merchants.length) }, () => worker()),
  );
  const publicFunnelRetention = await enforcePublicFunnelRetention({
    db: prisma,
  });
  const ok = results.every((result) => result.ok);
  return Response.json(
    { ok, results, publicFunnelRetention },
    { status: ok ? 200 : 207 },
  );
};

import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { readBoundedRequestText } from "../services/bounded-request.server";
import { resolveTest1Demo, type DemoResponseV1 } from "../services/test1-demo.server";
import { authenticate } from "../shopify.server";

const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };
const original = (reason: DemoResponseV1["reason"], status = 200) =>
  Response.json({ schemaVersion: 1, serving: "ORIGINAL", reason, demo: null, content: null } satisfies DemoResponseV1, { status, headers });

export const loader = async () => original("DEMO_CONTEXT_INVALID", 405);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return original("DEMO_CONTEXT_INVALID", 405);
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session) return original("DEMO_CONTEXT_INVALID", 401);
    const value = JSON.parse(await readBoundedRequestText(request, { maxBytes: 4096 })) as Record<string, unknown>;
    const consent = value.consent as Record<string, unknown> | undefined;
    if (value.schemaVersion !== 1 || typeof value.context !== "string" || value.context.length > 1000 ||
      !consent || typeof consent.analytics !== "boolean" || typeof consent.preferences !== "boolean")
      return original("DEMO_CONTEXT_INVALID", 400);
    return Response.json(await resolveTest1Demo({ db: prisma, shop: session.shop, context: value.context, consent: { analytics: consent.analytics, preferences: consent.preferences } }), { headers });
  } catch {
    return original("DEMO_INTERNAL_FAILURE", 500);
  }
};

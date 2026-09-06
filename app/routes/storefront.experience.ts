import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { resolveMeasuredExperiment } from "../services/measurement.server";
import {
  originalRuntimeResponse,
  resolveStorefrontExperience,
} from "../services/runtime.server";
import { consumeRateLimit } from "../services/rate-limit.server";
import { authenticate } from "../shopify.server";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json(originalRuntimeResponse("session_unavailable"), {
      headers: responseHeaders,
    });
  }
  const rate = consumeRateLimit({
    key: `decision:${session.shop}`,
    limit: 600,
    windowMilliseconds: 60_000,
  });
  if (!rate.allowed) {
    return Response.json(originalRuntimeResponse("rate_limited"), {
      status: 429,
      headers: {
        ...responseHeaders,
        "Retry-After": String(rate.retryAfterSeconds),
      },
    });
  }

  const url = new URL(request.url);
  try {
    const policy = url.searchParams.get("policy");
    const common = {
      db: prisma,
      shop: session.shop,
      productId: url.searchParams.get("product"),
      explicitAngle: url.searchParams.get("angle"),
      utmSource: url.searchParams.get("utm_source"),
      utmCampaign: url.searchParams.get("utm_campaign"),
      utmContent: url.searchParams.get("utm_content"),
    };
    const response =
      policy === "experiment"
        ? await resolveMeasuredExperiment({
            ...common,
            experimentKey: url.searchParams.get("experiment"),
            visitorId: url.searchParams.get("visitor"),
            sessionId: url.searchParams.get("session_id"),
            persistence: url.searchParams.get("persistence"),
            consentState: url.searchParams.get("consent"),
          })
        : await resolveStorefrontExperience({ ...common, policy });

    return Response.json(response, { headers: responseHeaders });
  } catch {
    return Response.json(originalRuntimeResponse("runtime_internal_failure"), {
      headers: responseHeaders,
    });
  }
};

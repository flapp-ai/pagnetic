import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { BoundedRequestError, readBoundedRequestText } from "../services/bounded-request.server";
import { QueueIdempotencyConflictError } from "../services/job-outbox.server";
import { consumeRateLimit } from "../services/rate-limit.server";
import {
  originalDecisionV2,
  parseDecisionRequestV2,
  resolveV2Decision,
  V2DecisionRequestError,
} from "../services/v2-decision.server";
import { authenticate } from "../shopify.server";

const MAX_BODY_BYTES = 8 * 1024;
const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST")
    return Response.json(originalDecisionV2("METHOD_NOT_ALLOWED"), { status: 405, headers: responseHeaders });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return Response.json(originalDecisionV2("REQUEST_TOO_LARGE"), {
      status: 413,
      headers: responseHeaders,
    });
  }
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json(originalDecisionV2("SESSION_UNAVAILABLE"), {
      status: 401,
      headers: responseHeaders,
    });
  }
  const rate = consumeRateLimit({
    key: `decision-v2:${session.shop}`,
    limit: 600,
    windowMilliseconds: 60_000,
  });
  if (!rate.allowed) {
    return Response.json(originalDecisionV2("RATE_LIMITED"), {
      status: 429,
      headers: {
        ...responseHeaders,
        "Retry-After": String(rate.retryAfterSeconds),
      },
    });
  }
  try {
    const text = await readBoundedRequestText(request, { maxBytes: MAX_BODY_BYTES });
    const requestV2 = parseDecisionRequestV2(JSON.parse(text));
    return Response.json(
      await resolveV2Decision({
        db: prisma,
        shop: session.shop,
        request: requestV2,
      }),
      { headers: responseHeaders },
    );
  } catch (error) {
    if (error instanceof BoundedRequestError)
      return Response.json(originalDecisionV2(error.code), { status: error.status, headers: responseHeaders });
    if (error instanceof SyntaxError) {
      return Response.json(originalDecisionV2("INVALID_JSON"), {
        status: 400,
        headers: responseHeaders,
      });
    }
    if (error instanceof V2DecisionRequestError) {
      return Response.json(originalDecisionV2(error.code), {
        status: error.status,
        headers: responseHeaders,
      });
    }
    if (error instanceof QueueIdempotencyConflictError) {
      return Response.json(originalDecisionV2(error.code), {
        status: 409,
        headers: responseHeaders,
      });
    }
    return Response.json(originalDecisionV2("RUNTIME_INTERNAL_FAILURE"), {
      status: 500,
      headers: responseHeaders,
    });
  }
};

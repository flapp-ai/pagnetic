import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { BoundedRequestError, readBoundedRequestText } from "../services/bounded-request.server";
import {
  ingestPixelEvent,
  pixelEventTypeForTelemetry,
} from "../services/measurement.server";
import {
  consumeRateLimit,
  requestAddress,
} from "../services/rate-limit.server";

const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const SAFE_REJECTION_REASONS = new Set([
  "invalid_or_pii_payload",
  "invalid_envelope",
  "unsupported_event",
  "unsupported_envelope_field",
  "authentication_failed",
  "invalid_timestamp",
  "consent_not_allowed",
  "decision_authority_unavailable",
  "decision_scope_or_window_invalid",
  "unsupported_event_data",
  "event_outside_receipt_window",
  "v2_configuration_unavailable",
  "privacy_scope_suppressed",
  "contradictory_final_render",
]);

function storefrontEventRejectionObservation(
  payload: unknown,
  reason: string | undefined,
) {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  return {
    reason:
      typeof reason === "string" && SAFE_REJECTION_REASONS.has(reason)
        ? reason
        : "unclassified_rejection",
    eventType: pixelEventTypeForTelemetry(record.eventType),
  };
}

export const loader = async () =>
  Response.json({ ok: false }, { status: 405, headers: corsHeaders });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST")
    return Response.json({ accepted: false, reason: "method_not_allowed" }, { status: 405, headers: corsHeaders });
  const rate = consumeRateLimit({
    key: `events:${requestAddress(request)}`,
    limit: 240,
    windowMilliseconds: 60_000,
  });
  if (!rate.allowed) {
    return Response.json(
      { accepted: false, reason: "rate_limited" },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": String(rate.retryAfterSeconds),
        },
      },
    );
  }
  let payload: unknown;
  try {
    const raw = await readBoundedRequestText(request, { maxBytes: 32_768 });
    payload = JSON.parse(raw);
  } catch (error) {
    if (error instanceof BoundedRequestError)
      return Response.json({ accepted: false, reason: error.code === "REQUEST_TOO_LARGE" ? "payload_too_large" : error.code.toLowerCase() },
        { status: error.status, headers: corsHeaders });
    return Response.json(
      { accepted: false, reason: "invalid_json" },
      { status: 400, headers: corsHeaders },
    );
  }
  const result = await ingestPixelEvent({ db: prisma, payload });
  if (!result.accepted)
    console.warn(
      "storefront_event_rejected",
      storefrontEventRejectionObservation(payload, result.reason),
    );
  return Response.json(result, {
    status: result.accepted
      ? 202
      : result.reason === "authentication_failed"
        ? 401
        : result.reason === "v2_configuration_unavailable"
          ? 503
        : 400,
    headers: corsHeaders,
  });
};

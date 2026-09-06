import type { LoaderFunctionArgs } from "react-router";

import { databaseReady } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET")
    return Response.json({ ok: false }, { status: 405 });
  try {
    await databaseReady();
    return Response.json(
      { ok: true, service: "adaptive-storefront" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, service: "adaptive-storefront" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
};

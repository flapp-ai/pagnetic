import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { automationAuthorized } from "../services/automation-auth.server";
import { runCustomerPrivacyExportWorker } from "../services/customer-privacy-worker.server";

export const loader = async () => Response.json({ ok: false }, { status: 405 });

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!automationAuthorized(request)) return Response.json({ ok: false }, { status: 401 });
  try {
    const result = await runCustomerPrivacyExportWorker({ db: prisma });
    return Response.json(result, { status: result.ok ? 200 : 207,
      headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ ok: false, error: "PRIVACY_WORKER_FAILED" }, { status: 503 });
  }
};

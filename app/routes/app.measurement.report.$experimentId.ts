import type { LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import {
  loadExperimentReport,
  renderExperimentReport,
} from "../services/experiment-report.server";
import { ensureMerchant } from "../services/governance.server";
import { authenticateAdmin } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const report = await loadExperimentReport({
    db: prisma,
    merchantId: merchant.id,
    experimentId: String(params.experimentId ?? ""),
  });
  const markdown = renderExperimentReport(report);
  const filename = `${report.experiment.key}-v${report.experiment.version}-report.md`;
  return new Response(markdown, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

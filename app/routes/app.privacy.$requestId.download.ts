import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { actorKey } from "../services/access.server";
import { accessCustomerPrivacyArtifact } from "../services/customer-privacy-access.server";
import { authenticateAdmin } from "../shopify.server";
import { verifyShopifyAccountOwner } from "../services/shopify-owner-authority.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const part = new URL(request.url).searchParams.get("part") ?? "";
  if (!/^\d{1,4}$/.test(part)) return new Response("Unavailable", { status: 404 });
  try {
    const ownerAuthority = await verifyShopifyAccountOwner({ request, shop: session.shop,
      subject: sessionToken.sub, tokenExpiresAt: sessionToken.exp });
    const copy = await accessCustomerPrivacyArtifact({ db: prisma, shop: session.shop,
      actor: actorKey(session.shop, sessionToken.sub), requestId: params.requestId ?? "", ordinal: Number(part), ownerAuthority });
    return new Response(JSON.stringify(copy, null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pagnetic-customer-data-part-${Number(part) + 1}.json"`,
      "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    } });
  } catch {
    return new Response("Data copy unavailable. Check owner access, expiry and privacy processing status.",
      { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
};

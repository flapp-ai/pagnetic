import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { privacyHash, privacySecret } from "../services/privacy.server";
import { disableMerchantAfterUninstall } from "../services/uninstall.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, shop } = await authenticate.webhook(request);
  const merchant = await db.merchant.findUnique({ where: { shop } });
  if (merchant) {
    await disableMerchantAfterUninstall({
      db,
      merchantId: merchant.id,
      shop,
      shopHash: privacyHash(privacySecret(), shop),
    });
  } else if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 204 });
};

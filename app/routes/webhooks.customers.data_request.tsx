import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import {
  privacySecret,
} from "../services/privacy.server";
import { processJournaledPrivacyWebhook } from "../services/privacy-receipt.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, webhookId, eventId, triggeredAt } = await authenticate.webhook(request);
  await processJournaledPrivacyWebhook({
    db,
    shop,
    type: "CUSTOMERS_DATA_REQUEST",
    payload,
    secret: privacySecret(),
    webhookId, eventId, triggeredAt,
  });
  return new Response(null, { status: 204 });
};

import type { ActionFunctionArgs } from "react-router";

import prisma from "../db.server";
import { ingestOrderWebhook } from "../services/measurement.server";
import { mvpV2EnabledForShop } from "../services/mvp-v2";
import { acceptFinancialWebhookV2 } from "../services/webhook-inbox-v2.server";
import { authenticate } from "../shopify.server";
import { PrivacyOrderSuppressedError } from "../services/order-privacy-guard.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, webhookId } =
    await authenticate.webhook(request);
  if (mvpV2EnabledForShop(shop)) {
    try { await acceptFinancialWebhookV2({
      db: prisma,
      shop,
      topic: String(topic),
      shopifyEventId: webhookId,
      payload,
    }); } catch (error) {
      if (error instanceof PrivacyOrderSuppressedError) return new Response(null, { status: 204 });
      throw error;
    }
    // Preserve legacy reports during the v2 shadow period. Durable v2
    // acceptance is already complete, so a legacy projection defect must not
    // ask Shopify to retry a safely queued event.
    try {
      await ingestOrderWebhook({
        db: prisma,
        shop,
        topic: String(topic),
        webhookId,
        payload,
      });
    } catch {
      /* The v2 reconciliation job remains authoritative and retryable. */
    }
    return new Response(null, { status: 204 });
  }
  await ingestOrderWebhook({
    db: prisma,
    shop,
    topic: String(topic),
    webhookId,
    payload,
  });
  return new Response(null, { status: 204 });
};

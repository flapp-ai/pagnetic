import { WebhookValidationErrorReason, WebhookType } from "@shopify/shopify-api";

type WebhookCheck = Awaited<ReturnType<import("@shopify/shopify-api").Shopify["webhooks"]["validate"]>>;

export async function validateWebhookWithoutAdmin(
  request: Request,
  validate: (input: { rawBody: string; rawRequest: Request }) => Promise<WebhookCheck>,
) {
  if (request.method !== "POST") {
    throw new Response(undefined, { status: 405, statusText: "Method not allowed" });
  }
  const rawBody = await request.text();
  const check = await validate({ rawBody, rawRequest: request });
  if (!check.valid) {
    const unauthorized = check.reason === WebhookValidationErrorReason.InvalidHmac;
    throw new Response(undefined, {
      status: unauthorized ? 401 : 400,
      statusText: unauthorized ? "Unauthorized" : "Bad Request",
    });
  }
  return {
    apiVersion: check.apiVersion,
    shop: check.domain,
    topic: check.topic,
    webhookId: check.webhookId,
    payload: JSON.parse(rawBody) as Record<string, unknown>,
    webhookType: check.webhookType,
    name: check.webhookType === WebhookType.Webhooks ? check.name : undefined,
    triggeredAt: check.triggeredAt,
    eventId: check.eventId,
  };
}

export function expiredRefreshableSession(
  session: { expires?: Date | null; refreshToken?: string | null; accessToken?: string } | undefined,
  now = Date.now(),
): session is { expires: Date; refreshToken: string; accessToken?: string } {
  return Boolean(
    session?.expires &&
      session.refreshToken &&
      session.expires.getTime() <= now,
  );
}

type StoredOfflineSession = {
  expires?: Date | null;
  refreshToken?: string | null;
  accessToken?: string;
};

export async function authenticateAdminWithStaleRecovery<T>(
  request: Request,
  dependencies: {
    authenticate: (request: Request) => Promise<T>;
    decodeShop: (token: string) => Promise<string>;
    offlineId: (shop: string) => string;
    load: (id: string) => Promise<StoredOfflineSession | undefined>;
    deleteMatching: (input: {
      id: string;
      expires: Date;
      accessToken: string;
      refreshToken: string;
    }) => Promise<boolean>;
  },
): Promise<T> {
  try {
    return await dependencies.authenticate(request);
  } catch (error) {
    if (!(error instanceof Response) || error.status !== 500) throw error;
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : new URL(request.url).searchParams.get("id_token");
    if (!token) throw error;

    let shop: string;
    try {
      shop = await dependencies.decodeShop(token);
    } catch {
      throw error;
    }

    const id = dependencies.offlineId(shop);
    const stale = await dependencies.load(id);
    if (!expiredRefreshableSession(stale) || !stale.accessToken) throw error;
    await dependencies.deleteMatching({
      id,
      expires: stale.expires,
      accessToken: stale.accessToken,
      refreshToken: stale.refreshToken,
    });
    return dependencies.authenticate(request);
  }
}

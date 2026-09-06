import { readBoundedRequestText } from "./bounded-request.server";

export type ShopifyOwnerAuthority = { shop: string; userId: string; expiresAt: Date };

// Call only after authenticate.admin has verified the request/session-token JWT.
// Exchange that same token for online user information; an app-local OWNER role
// (which may be bootstrapped by a staff member) is not Shopify owner authority.
export async function verifyShopifyAccountOwner(args: {
  request: Request; shop: string; subject: string; tokenExpiresAt: number;
  environment?: Record<string, string | undefined>; fetcher?: typeof fetch; now?: Date;
}): Promise<ShopifyOwnerAuthority> {
  const environment = args.environment ?? process.env;
  const now = args.now ?? new Date();
  const token = args.request.headers.get("authorization")?.replace(/^Bearer\s+/, "") ??
    new URL(args.request.url).searchParams.get("id_token");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(args.shop) || !/^\d{1,30}$/.test(args.subject) ||
    !token || token.length > 8192 || !Number.isSafeInteger(args.tokenExpiresAt) ||
    args.tokenExpiresAt * 1000 <= now.getTime() ||
    !environment.SHOPIFY_API_KEY || !environment.SHOPIFY_API_SECRET)
    throw new Error("SHOPIFY_ACCOUNT_OWNER_REQUIRED");
  const signal = AbortSignal.any([args.request.signal, AbortSignal.timeout(5_000)]);
  try {
    // Protocol matches the installed official Shopify token-exchange client.
    const response = await (args.fetcher ?? fetch)(`https://${args.shop}/admin/oauth/access_token`, {
      method: "POST", redirect: "error", signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: environment.SHOPIFY_API_KEY,
        client_secret: environment.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", subject_token: token,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token" }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("SHOPIFY_ACCOUNT_OWNER_REQUIRED");
    }
    const body = JSON.parse(await readBoundedRequestText({ body: response.body,
      headers: new Headers(), signal }, { maxBytes: 32_768, timeoutMs: 5_000 }));
    const user = body?.associated_user;
    if (!user || !Number.isSafeInteger(user.id) || String(user.id) !== args.subject ||
      user.account_owner !== true || user.collaborator !== false || typeof body.access_token !== "string")
      throw new Error("SHOPIFY_ACCOUNT_OWNER_REQUIRED");
    const checkedAt = args.now ?? new Date();
    if (args.tokenExpiresAt * 1000 <= checkedAt.getTime()) throw new Error("SHOPIFY_ACCOUNT_OWNER_REQUIRED");
    // Discard returned token, email/name and all other associated-user data.
    return { shop: args.shop, userId: args.subject,
      expiresAt: new Date(Math.min(args.tokenExpiresAt * 1000, checkedAt.getTime() + 60_000)) };
  } catch { throw new Error("SHOPIFY_ACCOUNT_OWNER_REQUIRED"); }
}

import "@shopify/shopify-app-react-router/adapters/node";
import "@shopify/shopify-api/adapters/web-api";

import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { shopifyApi } from "@shopify/shopify-api";

import prisma from "./db.server";
import {
  authenticateAdminWithStaleRecovery,
  validateWebhookWithoutAdmin,
} from "./services/shopify-auth-resilience.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(",") || [
    "read_products",
    "read_customer_events",
    "read_orders",
    "write_app_proxy",
    "write_pixels",
  ],
  appUrl: process.env.SHOPIFY_APP_URL || "http://localhost:3000",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

const appUrl = new URL(process.env.SHOPIFY_APP_URL || "http://localhost:3000");
const shopifyApiClient = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  hostName: appUrl.host,
  hostScheme: appUrl.protocol === "http:" ? "http" : "https",
  isEmbeddedApp: true,
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
type AdminContext = Awaited<ReturnType<typeof shopify.authenticate.admin>>;

/**
 * Recover a stale expiring offline session only after Shopify has verified the
 * current embedded session token. This works around the SDK returning a bare
 * HTTP 500 when its refresh token has been revoked after uninstall/reinstall.
 */
export async function authenticateAdmin(request: Request): Promise<AdminContext> {
  return authenticateAdminWithStaleRecovery(request, {
    authenticate: (input) => shopify.authenticate.admin(input),
    decodeShop: async (token) => {
      const payload = await shopifyApiClient.session.decodeSessionToken(token);
      return new URL(payload.dest).hostname;
    },
    offlineId: (shop) => shopifyApiClient.session.getOfflineId(shop),
    load: (id) => shopify.sessionStorage.loadSession(id),
    deleteMatching: async ({ id, expires, accessToken, refreshToken }) => {
      const removed = await prisma.session.deleteMany({
        where: { id, expires, accessToken, refreshToken },
      });
      if (removed.count > 0) {
        console.warn("shopify_auth_stale_offline_session_removed", { id });
      }
      return removed.count > 0;
    },
  });
}

/** Validate webhook authenticity without refreshing an offline Admin token. */
export async function authenticateWebhookWithoutAdmin(request: Request) {
  return validateWebhookWithoutAdmin(request, (input) =>
    shopifyApiClient.webhooks.validate(input),
  );
}
export const authenticate = shopify.authenticate;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export const unauthenticated = shopify.unauthenticated;

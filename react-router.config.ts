import type { Config } from "@react-router/dev/config";

const appHost = process.env.SHOPIFY_APP_URL
  ? new URL(process.env.SHOPIFY_APP_URL).host
  : null;

const productionActionOrigins = [
  "pagnetic.fly.dev",
  "pagnetic.com",
  "www.pagnetic.com",
];

export default {
  // Shopify Admin is the embedding parent and therefore the browser origin for
  // legitimate form submissions from the app iframe. During `shopify app dev`,
  // React Router sees the local proxy as the request host, so the exact active
  // tunnel host must also be trusted.
  allowedActionOrigins: [
    "admin.shopify.com",
    ...productionActionOrigins,
    ...(appHost ? [appHost] : []),
  ],
} satisfies Config;

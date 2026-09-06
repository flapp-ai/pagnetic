function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The public app URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("The public app URL must not contain credentials.");
  }
  return url.origin;
}

function isLocalHostname(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/**
 * Resolve the browser-reachable application origin behind Shopify's proxy.
 * Production and Shopify CLI environments should supply SHOPIFY_APP_URL. The
 * forwarded-header fallback keeps ordinary reverse-proxy deployments working,
 * and non-local HTTP origins are upgraded because Web Pixels require HTTPS.
 */
export function publicAppOrigin(
  request: Request,
  configuredUrl = process.env.SHOPIFY_APP_URL,
) {
  if (configuredUrl?.trim()) return normalizeOrigin(configuredUrl.trim());

  const requestUrl = new URL(request.url);
  const forwardedHost = firstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const host = forwardedHost ?? requestUrl.host;
  let protocol = forwardedProtocol ?? requestUrl.protocol.replace(":", "");
  if (protocol !== "http" && protocol !== "https")
    protocol = requestUrl.protocol.replace(":", "");
  if (protocol === "http" && !isLocalHostname(requestUrl.hostname))
    protocol = "https";

  return normalizeOrigin(`${protocol}://${host}`);
}

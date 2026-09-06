import { lookup } from "node:dns";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

import { buildPublicPreviews, normalizePreviewText } from "./public-preview";

const MAX_RESPONSE_BYTES = 750_000;
const REQUEST_TIMEOUT_MS = 6_000;

type StructuredProduct = {
  "@type"?: string | string[];
  name?: unknown;
  description?: unknown;
  brand?: unknown;
  category?: unknown;
};

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !privateIpv4(address);
  if (family === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) {
      return isPublicAddress(value.slice("::ffff:".length));
    }
    return (
      value !== "::" &&
      value !== "::1" &&
      !value.startsWith("fc") &&
      !value.startsWith("fd") &&
      !value.startsWith("fe8") &&
      !value.startsWith("fe9") &&
      !value.startsWith("fea") &&
      !value.startsWith("feb") &&
      !value.startsWith("2001:db8")
    );
  }
  return false;
}

export function normalizePublicProductUrl(raw: string) {
  if (!raw || raw.length > 2_048)
    throw new Error("Enter a valid Shopify product URL.");
  let url: URL;
  try {
    url = new URL(
      raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`,
    );
  } catch {
    throw new Error("Enter a valid Shopify product URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Use a public HTTPS Shopify product URL.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    isIP(hostname)
  ) {
    throw new Error(
      "Use a public Shopify product URL, not a local or IP address.",
    );
  }
  const productMarker = url.pathname.toLowerCase().indexOf("/products/");
  if (productMarker < 0)
    throw new Error(
      "The URL must point to a Shopify product page containing /products/.",
    );
  url.hostname = hostname;
  url.hash = "";
  url.search = "";
  return url;
}

function safeLookup(
  hostname: string,
  options: unknown,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) {
  void options;
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error, "", 4);
    const address = addresses.find((candidate) =>
      isPublicAddress(candidate.address),
    );
    if (
      !address ||
      addresses.some((candidate) => !isPublicAddress(candidate.address))
    ) {
      const blocked = Object.assign(
        new Error("The product host does not resolve to a public address."),
        { code: "EHOSTBLOCKED" },
      );
      return callback(blocked, "", 4);
    }
    callback(null, address.address, address.family);
  });
}

async function fetchHtml(
  url: URL,
  redirects = 0,
): Promise<{ html: string; finalUrl: URL }> {
  if (redirects > 2)
    throw new Error("The product page redirected too many times.");
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
          "user-agent": "AdaptiveStorefrontPreview/1.0",
        },
        lookup: safeLookup,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          try {
            const next = normalizePublicProductUrl(
              new URL(response.headers.location, url).toString(),
            );
            void fetchHtml(next, redirects + 1).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(
            new Error(
              status === 401 || status === 403
                ? "This storefront is password-protected or blocks previews."
                : `The product page returned HTTP ${status}.`,
            ),
          );
          return;
        }
        const contentType = response.headers["content-type"] ?? "";
        if (
          !contentType.includes("text/html") &&
          !contentType.includes("application/xhtml+xml")
        ) {
          response.resume();
          reject(new Error("The URL did not return a product page."));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            request.destroy(
              new Error("The product page is too large to preview safely."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            html: Buffer.concat(chunks).toString("utf8"),
            finalUrl: url,
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(new Error("The product page took too long to respond.")),
    );
    request.on("error", reject);
    request.end();
  });
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(value: string) {
  return normalizePreviewText(decodeEntities(value.replace(/<[^>]*>/g, " ")));
}

function metaContent(html: string, key: string) {
  const tags = html.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag
      .match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]
      ?.toLowerCase();
    if (property !== key.toLowerCase()) continue;
    return plainText(tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "");
  }
  return "";
}

function productNodes(value: unknown): StructuredProduct[] {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const nested = productNodes(record["@graph"]);
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => String(item).toLowerCase() === "product")
    ? [record as StructuredProduct, ...nested]
    : nested;
}

function structuredProduct(html: string) {
  const scripts =
    html.match(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    ) ?? [];
  for (const script of scripts) {
    const raw = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    try {
      const product = productNodes(JSON.parse(raw))[0];
      if (product) return product;
    } catch {
      // Invalid third-party JSON-LD is ignored in favor of social metadata.
    }
  }
  return null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return plainText(value);
  if (value && typeof value === "object" && "name" in value)
    return plainText(String((value as { name: unknown }).name ?? ""));
  return "";
}

export function parsePublicProductHtml(html: string) {
  const structured = structuredProduct(html);
  const title =
    stringValue(structured?.name) ||
    metaContent(html, "og:title") ||
    plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description =
    stringValue(structured?.description) ||
    metaContent(html, "og:description") ||
    metaContent(html, "description");
  if (!title || !description)
    throw new Error(
      "We could not find enough public product information. Try an unlocked Shopify product page.",
    );
  const locale = html
    .match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim();
  const source = {
    title: title.slice(0, 160),
    description: description.slice(0, 4_000),
    vendor: stringValue(structured?.brand) || null,
    productType: stringValue(structured?.category) || null,
    ...(locale ? { locale } : {}),
  };
  return source;
}

export async function scanPublicProduct(
  rawUrl: string,
  campaignAdText?: string | null,
) {
  const requestedUrl = normalizePublicProductUrl(rawUrl);
  const { html, finalUrl } = await fetchHtml(requestedUrl);
  const source = parsePublicProductHtml(html);
  return {
    host: finalUrl.hostname,
    source,
    preview: buildPublicPreviews(source, campaignAdText),
  };
}

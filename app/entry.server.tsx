import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { type EntryContext, ServerRouter } from "react-router";

import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  }
  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || reactRouterContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1_000,
    );
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [readyOption]: () => {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");

          pipe(body);
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError: reject,
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}

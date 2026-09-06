import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import landingStyles from "./routes/_index/styles.module.css?inline";
import governanceStyles from "./styles/governance.module.css?inline";
import publicDocumentStyles from "./styles/public-document.module.css?inline";

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <style
          dangerouslySetInnerHTML={{
            __html: `${landingStyles}\n${governanceStyles}\n${publicDocumentStyles}`,
          }}
        />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { NavLink, Outlet, useLoaderData, useRouteError } from "react-router";

import { authenticate } from "../shopify.server";
import styles from "../styles/governance.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <nav className={styles.merchantNav} aria-label="Pagnetic">
        <NavLink end to="/app">
          Overview
        </NavLink>
        <NavLink to="/app/messages">Messages</NavLink>
        <NavLink to="/app/results">Results</NavLink>
        <NavLink to="/app/settings">Settings</NavLink>
      </nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

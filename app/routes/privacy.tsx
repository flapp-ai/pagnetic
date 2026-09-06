import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { publicProductConfig } from "../services/public-config.server";
import styles from "../styles/public-document.module.css";

export const meta: MetaFunction = () => [
  { title: "Privacy — Pagnetic" },
];
export const loader = async () => publicProductConfig();

export default function Privacy() {
  const config = useLoaderData<typeof loader>();
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link to="/">{config.appName}</Link>
        <div>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Support</Link>
        </div>
      </nav>
      {!config.complete ? (
        <div className={styles.notice}>
          Pre-launch draft. Operator identity, hosting provider, contact
          details, and effective date must be configured before public
          submission.
        </div>
      ) : null}
      <p className={styles.meta}>
        Effective {config.termsEffectiveDate || "before public launch"}
      </p>
      <h1>Privacy policy</h1>
      <p>
        {config.companyName || "The Pagnetic operator"} provides{" "}
        {config.appName}, a Shopify application that helps merchants test
        approved product-page messages.
      </p>
      <h2>Information we process</h2>
      <ul>
        <li>
          Shop identity, installation credentials, staff authorization
          identifiers, and app configuration.
        </li>
        <li>
          Merchant product titles, descriptions, variants, campaign labels, and
          merchant-approved content.
        </li>
        <li>
          Pseudonymous assignment, decision, render, cart, checkout, order, and
          refund measurements needed to calculate experiment results.
        </li>
        <li>
          Order identifiers, currency, gross and net amounts, financial status,
          and timestamps needed for attribution.
        </li>
        <li>
          Support and incident contact information supplied by the merchant.
        </li>
      </ul>
      <p>
        We intentionally do not request or retain buyer names, postal addresses,
        email addresses, or phone numbers. Public preview scans are processed
        transiently; we store an anonymous outcome event and one-way host hash,
        not the submitted URL or product copy.
      </p>
      <h2>Why we process it</h2>
      <p>
        We use this information to operate the app, generate source-grounded
        previews, prevent unsupported content from being served, run
        merchant-authorized experiments, attribute aggregate revenue, secure the
        service, and provide support.
      </p>
      <h2>Sharing and subprocessors</h2>
      <p>
        Information is processed through Shopify and{" "}
        {config.hostingProvider ||
          "the production hosting provider to be named before launch"}
        . We do not sell buyer or merchant data or use it for unrelated
        advertising.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        Raw experiment events default to 90 days and aggregate experiment
        records default to 730 days, subject to the merchant’s configured policy
        and legal requirements. Shopify privacy webhooks are supported.
        Store-scoped operational data is deleted following a verified
        shop-redaction request; security and request audit records retain only
        one-way identifiers.
      </p>
      <h2>Security</h2>
      <p>
        We use scoped access, encryption for sensitive operational contacts,
        signed Shopify requests, allow-listed telemetry, rate limits, immutable
        approvals, backups, audit logs, and an original-storefront kill switch.
      </p>
      <h2>Your choices</h2>
      <p>
        Shopper event collection follows the store’s Shopify Customer Privacy
        consent state. Merchants control content approval, test activation,
        pause, deletion, and uninstall.
      </p>
      <h2>Contact</h2>
      <p>
        Privacy questions and requests:{" "}
        <strong>
          {config.privacyEmail || "privacy contact required before launch"}
        </strong>
        .
      </p>
    </main>
  );
}

import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { publicProductConfig } from "../services/public-config.server";
import styles from "../styles/public-document.module.css";

export const meta: MetaFunction = () => [
  { title: "Terms — Pagnetic" },
];
export const loader = async () => publicProductConfig();

export default function Terms() {
  const config = useLoaderData<typeof loader>();
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link to="/">{config.appName}</Link>
        <div>
          <Link to="/privacy">Privacy</Link>
          <Link to="/support">Support</Link>
        </div>
      </nav>
      {!config.complete ? (
        <div className={styles.notice}>
          Pre-launch commercial draft. It requires owner details and legal
          review before merchants accept it.
        </div>
      ) : null}
      <p className={styles.meta}>
        Effective {config.termsEffectiveDate || "before public launch"}
      </p>
      <h1>Founding-beta terms</h1>
      <p>
        These terms govern access to {config.appName}, operated by{" "}
        {config.companyName ||
          "the company identity to be supplied before launch"}
        .
      </p>
      <h2>Beta service</h2>
      <p>
        The service generates merchant-reviewable product-message drafts and
        measures merchant-authorized storefront experiments. It is experimental,
        may change, and does not guarantee conversion or revenue improvement.
      </p>
      <h2>Merchant responsibilities</h2>
      <p>
        The merchant remains responsible for its products, prices, inventory,
        claims, advertising, privacy notices, consent configuration, and legal
        compliance. The merchant must review and approve content before
        activation and must not submit unlawful, misleading, or
        third-party-confidential material.
      </p>
      <h2>Founding-beta offer</h2>
      <p>
        No payment is requested before the first mature
        Original-versus-Universal experiment produces a positive, negative, or
        inconclusive result. A/A validation does not end free access. Continued
        paid use, if offered, requires the merchant to affirmatively accept the
        then-disclosed Shopify plan and price.
      </p>
      <h2>Experiments</h2>
      <p>
        Results are statistical estimates, not guarantees. The merchant agrees
        to record material campaign, pricing, promotion, inventory, theme, and
        checkout changes and may pause the app at any time. The original
        storefront remains the failure state.
      </p>
      <h2>Availability and suspension</h2>
      <p>
        We may suspend adaptive delivery to protect shoppers, merchants, data
        integrity, or the platform. Uninstalling the app ends new processing,
        subject to deletion and legally required retention procedures.
      </p>
      <h2>Disclaimers and liability</h2>
      <p>
        To the extent permitted by applicable law, the beta is provided as
        available without warranties of uninterrupted operation or business
        outcome. Final warranty, liability limitation, governing-law, and
        dispute language must be approved by the operator’s counsel before
        public launch.
      </p>
      <h2>Contact</h2>
      <p>
        Questions:{" "}
        <strong>
          {config.supportEmail || "support contact required before launch"}
        </strong>
        .
      </p>
    </main>
  );
}

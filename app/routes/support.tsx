import type { MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";

import { publicProductConfig } from "../services/public-config.server";
import styles from "../styles/public-document.module.css";

export const meta: MetaFunction = () => [
  { title: "Support — Pagnetic" },
];
export const loader = async () => publicProductConfig();

export default function Support() {
  const config = useLoaderData<typeof loader>();
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link to="/">{config.appName}</Link>
        <div>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </div>
      </nav>
      {!config.complete ? (
        <div className={styles.notice}>
          The production support identity and response hours must be confirmed
          before public launch.
        </div>
      ) : null}
      <h1>Support</h1>
      <p>
        We help merchants install the theme block, understand readiness gates,
        validate measurement, interpret experiment reports, pause adaptive
        delivery, and process privacy requests.
      </p>
      <div className={styles.card}>
        <h2>Contact support</h2>
        <p>
          Email{" "}
          <strong>
            {config.supportEmail || "support email required before launch"}
          </strong>
          . Include your <code>.myshopify.com</code> domain, but never send
          passwords, access tokens, customer information, or payment details.
        </p>
        {config.supportEmail ? (
          <a className={styles.button} href={`mailto:${config.supportEmail}`}>
            Email support
          </a>
        ) : null}
      </div>
      <div className={styles.card}>
        <h2>Urgent storefront issue</h2>
        <ol>
          <li>
            Open <strong>Pilot operations</strong> in the app.
          </li>
          <li>
            Activate the kill switch to restore the original storefront
            immediately.
          </li>
          <li>Contact support with the time and affected product.</li>
        </ol>
      </div>
      <div className={styles.card}>
        <h2>Service status</h2>
        <p>
          The deployment health check is available at{" "}
          <Link to="/healthz">/healthz</Link>. It reports service and database
          availability without exposing merchant data.
        </p>
      </div>
    </main>
  );
}

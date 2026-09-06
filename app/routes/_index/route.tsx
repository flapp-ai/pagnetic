import { randomUUID } from "node:crypto";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import prisma from "../../db.server";
import {
  hashPublicHost,
  publicFunnelIdentity,
  recordPublicFunnelEvent,
} from "../../services/public-funnel.server";
import { buildPublicPreviews } from "../../services/public-preview";
import { scanPublicProduct } from "../../services/public-preview.server";
import {
  consumeRateLimit,
  requestAddress,
} from "../../services/rate-limit.server";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

const DEMO_SOURCE = {
  title: "Everyday Trail Runner",
  description:
    "Soft recycled knit keeps the shoe comfortable from the first step. A responsive foam midsole supports steady movement on city streets and light trails. Durable rubber grip is tested for wet and dry surfaces. One versatile pair is included with removable insoles and easy-care materials.",
  vendor: "Demo Outfitters",
  productType: "Shoes",
};

export const meta: MetaFunction = () => [
  { title: "Pagnetic — Preview your product message" },
  {
    name: "description",
    content:
      "Find one source-backed gap between a Shopify campaign promise and its product page, then preview a useful message change.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  if (shop) {
    const identity = publicFunnelIdentity(request);
    try {
      await recordPublicFunnelEvent({
        db: prisma,
        anonymousIdHash: identity.anonymousIdHash,
        eventType: "INSTALL_STARTED",
        productHostHash: hashPublicHost(shop),
      });
    } catch {
      // Installation must not depend on product analytics availability.
    }
    return redirect("/app?" + url.searchParams.toString(), {
      headers: identity.setCookie
        ? { "Set-Cookie": identity.setCookie }
        : undefined,
    });
  }
  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const identity = publicFunnelIdentity(request);
  const headers = identity.setCookie
    ? { "Set-Cookie": identity.setCookie }
    : undefined;
  const rate = consumeRateLimit({
    key: `public-preview:${requestAddress(request)}`,
    limit: 5,
    windowMilliseconds: 10 * 60 * 1000,
  });
  if (!rate.allowed) {
    return data(
      {
        ok: false as const,
        message: "Too many preview requests. Try again in a few minutes.",
        submitted: { productUrl: "", campaignAdText: "" },
      },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10_000)
    return data(
      {
        ok: false as const,
        message: "The request is too large.",
        submitted: { productUrl: "", campaignAdText: "" },
      },
      { status: 413, headers },
    );
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "scan");
  const productUrl = String(formData.get("productUrl") ?? "").trim();
  const campaignAdText = String(formData.get("campaignAdText") ?? "").trim();
  const submitted = { productUrl, campaignAdText };
  if (campaignAdText.length > 2_000) {
    return data(
      {
        ok: false as const,
        message: "Campaign or ad text must be 2,000 characters or fewer.",
        submitted,
      },
      { status: 400, headers },
    );
  }
  const requestId = randomUUID();
  try {
    const result =
      intent === "demo"
        ? {
            host: "demo",
            source: DEMO_SOURCE,
            preview: buildPublicPreviews(DEMO_SOURCE, campaignAdText),
          }
        : await scanPublicProduct(productUrl, campaignAdText);
    await recordPublicFunnelEvent({
      db: prisma,
      requestId,
      anonymousIdHash: identity.anonymousIdHash,
      eventType: "SCAN_SUCCEEDED",
      productHostHash: hashPublicHost(result.host),
      metadata: {
        readiness: result.preview.readiness,
        mode: result.preview.diagnosis.mode,
        gapType: result.preview.diagnosis.gapType,
        opportunity: result.preview.diagnosis.status === "PROPOSED",
        demo: intent === "demo",
      },
    });
    return data({ ok: true as const, result, submitted }, { headers });
  } catch (error) {
    try {
      await recordPublicFunnelEvent({
        db: prisma,
        requestId,
        anonymousIdHash: identity.anonymousIdHash,
        eventType: "SCAN_FAILED",
        metadata: { reason: "SCAN_REJECTED" },
      });
    } catch {
      // A telemetry failure must not replace the visitor-safe scanner error.
    }
    return data(
      {
        ok: false as const,
        message:
          error instanceof Error
            ? error.message
            : "The preview could not be generated.",
        submitted,
      },
      { status: 400, headers },
    );
  }
};

export default function Index() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const scanning = navigation.state !== "idle";
  const result = actionData?.ok ? actionData.result : null;

  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="Primary navigation">
        <a className={styles.wordmark} href="#top">
          Pagnetic
        </a>
        <a href="#how">How it works</a>
      </nav>

      <section className={styles.hero} id="top">
        <div>
          <p className={styles.eyebrow}>A safer adaptive PDP experiment</p>
          <h1>Show each campaign the product message it came for.</h1>
          <p className={styles.intro}>
            Paste one public Shopify product URL and, if relevant, the exact ad
            message sending traffic there. See one evidence-grounded opportunity
            before installing—without invented claims or promised lift.
          </p>
          <Form className={styles.scanForm} method="post">
            <label htmlFor="productUrl">Shopify product URL</label>
            <div>
              <input
                id="productUrl"
                name="productUrl"
                placeholder="https://your-store.com/products/your-product"
                required
                type="url"
                defaultValue={actionData?.submitted.productUrl}
              />
              <button disabled={scanning} type="submit">
                {scanning ? "Reading product…" : "Create my free preview"}
              </button>
            </div>
            <label htmlFor="campaignAdText">
              Campaign or ad text <span>(optional)</span>
            </label>
            <textarea
              defaultValue={actionData?.submitted.campaignAdText}
              id="campaignAdText"
              maxLength={2000}
              name="campaignAdText"
              placeholder="Paste the exact promise or body from the ad. Leave blank for a product-page clarity review."
              rows={4}
            />
            <button
              className={styles.demoButton}
              disabled={scanning}
              formNoValidate
              name="intent"
              type="submit"
              value="demo"
            >
              No public product yet? View a sample
            </button>
            <small>
              Public, unlocked product pages only. We store an anonymous scan
              event—not the page URL, product copy, or pasted ad text.
            </small>
          </Form>
          {actionData && !actionData.ok ? (
            <p className={styles.error} role="alert">
              {actionData.message}
            </p>
          ) : null}
        </div>
        <aside className={styles.promiseCard}>
          <span>Founding beta</span>
          <strong>Free until your first valid experiment result.</strong>
          <p>
            A/A validation does not end the beta. No result means no payment
            request.
          </p>
        </aside>
      </section>

      {result ? (
        <section className={styles.results} aria-live="polite">
          <div className={styles.resultHeading}>
            <div>
              <p className={styles.eyebrow}>Instant opportunity preview</p>
              <h2>{result.source.title}</h2>
              <p>
                {result.preview.diagnosis.mode === "CAMPAIGN_MESSAGE_REVIEW"
                  ? "Campaign-message review"
                  : "Product-page clarity review"}
              </p>
            </div>
            <div className={styles.diagnosisTag}>
              <strong>
                {result.preview.diagnosis.gapType.replaceAll("_", " ").toLowerCase()}
              </strong>
              <span>{result.preview.diagnosis.status === "PROPOSED" ? "reviewable change" : "honest abstention"}</span>
            </div>
          </div>

          <div className={styles.findings}>
            {result.preview.findings.map((finding) => (
              <article data-passed={finding.passed} key={finding.label}>
                <span>{finding.passed ? "Ready" : "Improve"}</span>
                <strong>{finding.label}</strong>
                <p>{finding.detail}</p>
              </article>
            ))}
          </div>

          <div className={styles.previewGrid}>
            {result.preview.cards.map((card) => (
              <article
                className={styles.previewCard}
                data-angle={card.key}
                key={card.key}
              >
                <div>
                  <span>{card.label}</span>
                  <small>{card.audience}</small>
                </div>
                <h3>{card.headline}</h3>
                {card.supportingLine ? <p>{card.supportingLine}</p> : null}
                {card.benefits.length ? (
                  <ul>
                    {card.benefits.map((benefit) => (
                      <li key={benefit}>{benefit}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>

          {result.preview.diagnosis.requestedSource ? (
            <div className={styles.sourceRequest} role="status">
              <strong>No unsupported message was generated.</strong>
              <p>{result.preview.diagnosis.requestedSource}</p>
            </div>
          ) : null}

          <div className={styles.evidenceNote}>
            <strong>
              This is a source-grounded preview, not a performance prediction.
            </strong>
            <p>
              The live app requires merchant approval, verifies measurement with
              A/A, and keeps the original storefront as the permanent fallback.
            </p>
          </div>

          {showForm ? (
            <div className={styles.installCard}>
              <div>
                <p className={styles.eyebrow}>Next step</p>
                <h2>Test this on your real traffic.</h2>
                <p>
                  Install free, approve the exact messages, and pay nothing
                  until a mature real comparison produces a result.
                </p>
              </div>
              <Form
                className={styles.installForm}
                method="post"
                action="/auth/login"
              >
                <label>
                  Shopify store
                  <input
                    name="shop"
                    placeholder="store.myshopify.com"
                    required
                  />
                </label>
                <button type="submit">Install founding beta</button>
              </Form>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.how} id="how">
        <p className={styles.eyebrow}>From preview to proof</p>
        <h2>Value now. Evidence next.</h2>
        <div>
          <article>
            <span>01</span>
            <h3>Preview</h3>
            <p>
              See your current product story reorganized for distinct shopper
              priorities.
            </p>
          </article>
          <article>
            <span>02</span>
            <h3>Approve</h3>
            <p>
              Control every displayed statement and keep Shopify’s native
              product and checkout controls untouched.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>Validate</h3>
            <p>
              Run A/A first so measurement earns trust before any
              personalization claim.
            </p>
          </article>
          <article>
            <span>04</span>
            <h3>Prove</h3>
            <p>
              Compare revenue per session under a frozen protocol and receive an
              honest positive, negative, or inconclusive result.
            </p>
          </article>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>Pagnetic founding beta</span>
        <div>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </div>
      </footer>
    </main>
  );
}

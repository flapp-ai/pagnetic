import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import prisma from "../db.server";
import {
  actorKey,
  ensurePilotRole,
  requirePilotRole,
} from "../services/access.server";
import {
  loadActivation,
  selectHeroProduct,
} from "../services/activation.server";
import {
  approveBrandProfile,
  buildDraftLibrary,
  ensureMerchant,
  syncProducts,
} from "../services/governance.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/governance.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  await ensurePilotRole({ db: prisma, merchantId: merchant.id, actor });
  const activation = await loadActivation({
    db: prisma,
    merchantId: merchant.id,
  });
  const seenAngles = new Set<string>();
  const previews = (activation.hero?.experiences ?? [])
    .filter((experience) => {
      const key = experience.angle?.key ?? "universal";
      if (seenAngles.has(key)) return false;
      seenAngles.add(key);
      return true;
    })
    .slice(0, 4)
    .map((experience) => ({
      id: experience.id,
      angle: experience.angle?.label ?? "Universal",
      status: experience.status,
      headline: experience.headline,
      supportingLine: experience.supportingLine,
      benefits: JSON.parse(experience.benefitsJson) as string[],
    }));
  return {
    shop: session.shop,
    products: activation.products.map((product) => ({
      id: product.id,
      title: product.title,
    })),
    hero: activation.hero
      ? { id: activation.hero.id, title: activation.hero.title }
      : null,
    brand: activation.brand
      ? {
          status: activation.brand.status,
          voiceTraits: JSON.parse(activation.brand.voiceTraitsJson) as string[],
          vocabulary: JSON.parse(activation.brand.vocabularyJson) as string[],
        }
      : null,
    facts: activation.facts,
    journey: activation.journey,
    entitlement: {
      status: activation.entitlement.status,
      firstValidResultAt:
        activation.entitlement.firstValidResultAt?.toISOString() ?? null,
      firstValidResultState: activation.entitlement.firstValidResultState,
      ...activation.entitlementView,
    },
    previews,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "sync-products") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const result = await syncProducts({
        db: prisma,
        shop: session.shop,
        actor,
        graphql: (query) => admin.graphql(query),
      });
      return {
        ok: true,
        message: `${result.productCount} products synced. Choose one hero product next.`,
      };
    }
    if (intent === "select-hero") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const product = await selectHeroProduct({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: `${product.title} is now the hero product for this beta.`,
      };
    }
    if (intent === "approve-brand") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      await approveBrandProfile({ db: prisma, merchantId: merchant.id, actor });
      return {
        ok: true,
        message:
          "Brand profile approved. You can now create the message-angle library.",
      };
    }
    if (intent === "build-library") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      const activation = await loadActivation({
        db: prisma,
        merchantId: merchant.id,
      });
      if (!activation.hero) throw new Error("Choose a hero product first.");
      if (activation.brand?.status !== "APPROVED")
        throw new Error("Approve the source-derived brand profile first.");
      const result = await buildDraftLibrary({
        db: prisma,
        merchantId: merchant.id,
        productId: activation.hero.id,
        actor,
      });
      return {
        ok: true,
        message: `${result.draftCount} message-angle previews created from ${result.approvedEvidenceCount} source records.`,
      };
    }
    return { ok: false, message: "Unknown activation action." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The activation action failed.",
    };
  }
};

export default function GetStarted() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} to="/app">
            ← Pagnetic
          </Link>
          <p className={styles.eyebrow}>Founding beta activation</p>
          <h1>From product to proof</h1>
          <p className={styles.lede}>
            Get immediate message previews first. The storefront stays original
            until you approve the content and every safety gate passes.
          </p>
        </div>
        <div className={styles.progressDial}>
          <strong>{data.journey.percent}%</strong>
          <span>
            {data.journey.completed} of {data.journey.total} stages
          </span>
        </div>
      </header>
      {actionData ? (
        <div
          className={
            actionData.ok ? styles.successMessage : styles.errorMessage
          }
          role="status"
        >
          {actionData.message}
        </div>
      ) : null}

      <section className={styles.betaBanner}>
        <div>
          <p className={styles.step}>Your founding-beta access</p>
          <h2>{data.entitlement.headline}</h2>
          <p>{data.entitlement.detail}</p>
        </div>
        <span
          className={styles.statusBadge}
          data-status={
            data.entitlement.phase === "FREE_UNTIL_RESULT"
              ? "READY"
              : "COLLECTING"
          }
        >
          {data.entitlement.phase.replaceAll("_", " ")}
        </span>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Activation path</p>
            <h2>
              {data.journey.next
                ? `Next: ${data.journey.next.label}`
                : "Activation journey complete"}
            </h2>
          </div>
          <p>
            {data.journey.next?.detail ??
              "Your first valid real experiment result is ready."}
          </p>
        </div>
        <div className={styles.activationList}>
          {data.journey.steps.map((step) => (
            <a data-complete={step.complete} href={step.href} key={step.key}>
              <span>{step.complete ? "✓" : step.number}</span>
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
              </div>
              <b>{step.complete ? "Complete" : step.cta} →</b>
            </a>
          ))}
        </div>
      </section>

      <section className={styles.section} id="catalog">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 1 · under two minutes</p>
            <h2>Choose the product worth testing</h2>
          </div>
          <p>Nothing goes live during this step.</p>
        </div>
        <div className={styles.actionRow}>
          <Form method="post">
            <input name="intent" type="hidden" value="sync-products" />
            <button
              className={styles.primaryButton}
              disabled={busy}
              type="submit"
            >
              {data.products.length
                ? "Refresh Shopify catalog"
                : "Sync Shopify catalog"}
            </button>
          </Form>
          {data.products.length ? (
            <Form className={styles.inlineForm} method="post">
              <input name="intent" type="hidden" value="select-hero" />
              <label>
                Hero product
                <select defaultValue={data.hero?.id} name="productId">
                  {data.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.secondaryButton}
                disabled={busy}
                type="submit"
              >
                Use this product
              </button>
            </Form>
          ) : null}
        </div>
      </section>

      <section className={styles.section} id="preview">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 2 · immediate value</p>
            <h2>See different message angles</h2>
          </div>
          <p>
            Every displayed product statement remains traceable to current
            Shopify source text.
          </p>
        </div>
        {data.brand ? (
          <div className={styles.brandSummary}>
            <div>
              <strong>Source-derived voice</strong>
              <p>{data.brand.voiceTraits.join(" · ")}</p>
              <small>
                {data.brand.vocabulary.join(", ") ||
                  "More catalog text will improve the profile."}
              </small>
            </div>
            {data.brand.status !== "APPROVED" ? (
              <Form method="post">
                <input name="intent" type="hidden" value="approve-brand" />
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  type="submit"
                >
                  Approve brand profile
                </button>
              </Form>
            ) : (
              <span className={styles.statusBadge} data-status="READY">
                APPROVED
              </span>
            )}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>Sync the catalog first</h3>
            <p>
              The app will derive a transparent voice profile from
              merchant-owned product text.
            </p>
          </div>
        )}
        {data.brand?.status === "APPROVED" &&
        data.hero &&
        !data.facts.draftLibraryCreated ? (
          <Form method="post">
            <input name="intent" type="hidden" value="build-library" />
            <button
              className={styles.primaryButton}
              disabled={busy}
              type="submit"
            >
              Create free previews for {data.hero.title}
            </button>
          </Form>
        ) : null}
        {data.previews.length ? (
          <>
            <div className={styles.previewCards}>
              {data.previews.map((preview) => (
                <article key={preview.id}>
                  <div>
                    <span>{preview.angle}</span>
                    <small>{preview.status.replaceAll("_", " ")}</small>
                  </div>
                  <h3>{preview.headline}</h3>
                  {preview.supportingLine ? (
                    <p>{preview.supportingLine}</p>
                  ) : null}
                  <ul>
                    {preview.benefits.map((benefit) => (
                      <li key={benefit}>{benefit}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div className={styles.actionRow}>
              <Link className={styles.primaryButton} to="/app/governance">
                Review evidence and approve
              </Link>
              <Link className={styles.secondaryLink} to="/app/preview">
                Open storefront preview
              </Link>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

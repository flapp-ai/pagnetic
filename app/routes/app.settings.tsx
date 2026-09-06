import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";

import prisma from "../db.server";
import { actorKey, ensurePilotRole, requirePilotRole } from "../services/access.server";
import {
  pauseAutopilotPlan,
  resumeAutopilotPlan,
} from "../services/autopilot-orchestrator.server";
import { ensureMerchant } from "../services/governance.server";
import {
  createShopifyAppPricingProviderV2,
  loadShopifyShopIdV2,
  shopifyAppPricingUrlV2,
} from "../services/shopify-app-pricing-v2.server";
import {
  ACTIVE_OFFER_VERSION_V2,
  offerCatalogV2,
  verifySubscriptionV2,
} from "../services/subscription-v2.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/governance.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  await ensurePilotRole({
    db: prisma,
    merchantId: merchant.id,
    actor: actorKey(session.shop, sessionToken.sub),
  });
  const [runtime, subscription, settings, plan, qa, incidents] = await Promise.all([
    prisma.runtimeControl.findUnique({ where: { merchantId: merchant.id } }),
    prisma.subscriptionState.findUnique({ where: { merchantId: merchant.id } }),
    prisma.pilotSettings.findUnique({ where: { merchantId: merchant.id } }),
    prisma.autopilotPlan.findFirst({
      where: { merchantId: merchant.id, state: { not: "INVALIDATED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, state: true },
    }),
    prisma.qaEvidence.findMany({
      where: { merchantId: merchant.id },
      orderBy: { capturedAt: "desc" },
      take: 30,
    }),
    prisma.incident.findMany({
      where: { merchantId: merchant.id, status: "OPEN" },
      orderBy: { detectedAt: "desc" },
      take: 10,
      select: { id: true, severity: true, category: true, summary: true },
    }),
  ]);
  const latestQa = qa.filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.productId === item.productId &&
          candidate.checkKey === item.checkKey,
      ) === index,
  );
  const offers = offerCatalogV2();
  const currentOffer = subscription
    ? offers.find((offer) => offer.version === subscription.offerVersion) ?? null
    : offers.find((offer) => offer.version === ACTIVE_OFFER_VERSION_V2) ?? null;
  const providerConfigured = [
    process.env.SHOPIFY_PARTNER_ORGANIZATION_ID,
    process.env.SHOPIFY_PARTNER_API_TOKEN,
    process.env.SHOPIFY_PARTNER_APP_ID,
    process.env.SHOPIFY_APP_PRICING_PLAN_HANDLE,
  ].every((value) => Boolean(value?.trim()));
  let pricingUrl: string | null = null;
  if (currentOffer?.publishable && process.env.SHOPIFY_APP_HANDLE) {
    try {
      pricingUrl = shopifyAppPricingUrlV2({
        shop: session.shop,
        appHandle: process.env.SHOPIFY_APP_HANDLE,
      });
    } catch {
      pricingUrl = null;
    }
  }
  return {
    shop: session.shop,
    paused: Boolean(runtime?.killSwitch) || plan?.state === "PAUSED",
    plan,
    subscription: subscription
      ? {
          status: subscription.authoritativeStatus,
          offerVersion: subscription.offerVersion,
          verifiedAt: subscription.verifiedAt?.toISOString() ?? null,
          periodEnd: subscription.periodEnd?.toISOString() ?? null,
          cancellationAt: subscription.cancellationAt?.toISOString() ?? null,
        }
      : null,
    offer: currentOffer,
    providerConfigured,
    pricingUrl,
    retention: {
      rawDays: settings?.rawEventRetentionDays ?? 90,
      aggregateDays: settings?.aggregateRetentionDays ?? 730,
    },
    surfaces: latestQa.map((item) => ({
      key: item.checkKey,
      status:
        item.expiresAt && item.expiresAt <= new Date()
          ? "EXPIRED"
          : item.status,
      applicability: item.applicability,
      capturedAt: item.capturedAt.toISOString(),
      expiresAt: item.expiresAt?.toISOString() ?? null,
    })),
    incidents,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    await requirePilotRole({
      db: prisma,
      merchantId: merchant.id,
      actor,
      allowed: ["OWNER", "OPERATOR"],
    });
    const planId = String(form.get("planId") ?? "");
    if (intent === "verifySubscription") {
      const shopId = await loadShopifyShopIdV2((query) => admin.graphql(query));
      const verified = await verifySubscriptionV2({
        db: prisma,
        merchantId: merchant.id,
        provider: createShopifyAppPricingProviderV2({ shopId }),
      });
      return {
        ok: true,
        message: `Shopify subscription verified: ${verified.authoritativeStatus.replaceAll("_", " ").toLowerCase()}.`,
      };
    }
    if (intent === "pause") {
      await pauseAutopilotPlan({
        db: prisma,
        merchantId: merchant.id,
        planId,
        actor,
      });
      return { ok: true, message: "Paused. New shoppers receive the original storefront." };
    }
    if (intent === "resume") {
      await resumeAutopilotPlan({
        db: prisma,
        merchantId: merchant.id,
        planId,
        actor,
      });
      return { ok: true, message: "Resumed under the existing reviewed authority." };
    }
    return { ok: false, message: "Unknown settings action." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The settings action failed.",
    };
  }
};

export function SettingsView({
  data,
  result,
  busy,
}: {
  data: ReturnType<typeof useLoaderData<typeof loader>>;
  result: ReturnType<typeof useActionData<typeof action>>;
  busy: boolean;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Settings</p>
          <h1>Storefront safety and account status</h1>
          <p className={styles.lede}>Pause serving, inspect verified surfaces and export your Pagnetic record.</p>
        </div>
      </header>
      {result ? <div className={result.ok ? styles.successMessage : styles.errorMessage} role="status">{result.message}</div> : null}
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><p className={styles.step}>Serving</p><h2>{data.paused ? "Original storefront only" : "Reviewed authority active"}</h2></div>
          <span className={styles.statusBadge} data-status={data.paused ? "HOLD" : "COLLECTING"}>{data.paused ? "Paused" : data.plan?.state.replaceAll("_", " ") ?? "No active plan"}</span>
        </div>
        {data.plan ? (
          <Form method="post">
            <input name="planId" type="hidden" value={data.plan.id} />
            <input name="intent" type="hidden" value={data.paused ? "resume" : "pause"} />
            <button className={data.paused ? styles.secondaryButton : styles.dangerButton} disabled={busy} type="submit">{data.paused ? "Resume reviewed plan" : "Pause and serve Original"}</button>
          </Form>
        ) : <p>No active plan can change the storefront.</p>}
      </section>
      <section className={styles.section}>
        <p className={styles.step}>Subscription</p>
        <h2>{data.subscription?.status.replaceAll("_", " ").toLowerCase() ?? "Free evaluation"}</h2>
        {data.offer ? <p><strong>{data.offer.name} · ${data.offer.priceUsdMonthly}/month</strong><br />{data.offer.evaluation}</p> : null}
        <p>
          {data.subscription?.verifiedAt
            ? `Shopify status last verified ${data.subscription.verifiedAt.slice(0, 16).replace("T", " ")} UTC.`
            : "No paid Shopify subscription has been verified. A favorable experiment result is never payment authorization."}
        </p>
        {data.subscription?.periodEnd ? <p>Current period ends {data.subscription.periodEnd.slice(0, 10)}.</p> : null}
        {data.subscription?.cancellationAt ? <p>Cancellation recorded for {data.subscription.cancellationAt.slice(0, 10)}.</p> : null}
        {!data.offer?.publishable ? <p>New paid enrollment is not published. Pagnetic will not create a charge until Shopify billing and the offer launch gate are both explicitly enabled.</p> : null}
        {data.providerConfigured ? <Form method="post"><input name="intent" type="hidden" value="verifySubscription" /><button className={styles.secondaryButton} disabled={busy} type="submit">Verify status with Shopify</button></Form> : <p>Shopify Partner API verification is not configured. Serving remains limited by the stored evaluation authority.</p>}
        {data.pricingUrl ? <a className={styles.primaryButton} href={data.pricingUrl}>View plans in Shopify</a> : null}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHeading}><div><p className={styles.step}>Supported surfaces</p><h2>Evidence, not assumptions</h2></div></div>
        {data.surfaces.length ? <div className={styles.readinessList}>{data.surfaces.map((surface) => (
          <div key={`${surface.key}-${surface.capturedAt}`}><strong>{surface.key.replaceAll("_", " ")}</strong><span>{surface.status} · {surface.applicability}{surface.expiresAt ? ` · expires ${surface.expiresAt.slice(0, 10)}` : ""}</span></div>
        ))}</div> : <p>No current product-specific commerce QA evidence is recorded. Unknown capability remains pending, not silently supported.</p>}
        <Link className={styles.secondaryButton} to="/app/setup">Open storefront verification</Link>
      </section>
      <section className={styles.section}>
        <p className={styles.step}>Data and support</p>
        <h2>Your record</h2>
        <p>Raw event retention: {data.retention.rawDays} days. Aggregate/report retention: {data.retention.aggregateDays} days.</p>
        <div className={styles.actionRow}>
          <a className={styles.secondaryButton} href="/app/settings/export">Export experiment record</a>
          <Link className={styles.secondaryButton} to="/privacy">Privacy</Link>
          <Link className={styles.secondaryButton} to="/support">Support</Link>
        </div>
      </section>
      {data.incidents.length ? <section className={styles.section}><p className={styles.step}>Open incidents</p><h2>Pagnetic is responsible for these checks</h2><div className={styles.noticeList}>{data.incidents.map((incident) => <article className={styles.noticeCard} key={incident.id}><strong>{incident.summary}</strong><p>{incident.category.replaceAll("_", " ")} · {incident.severity}</p></article>)}</div></section> : null}
      <details className={styles.advancedDetails}><summary>Advanced/operator workspace</summary><div className={styles.cardGrid}><Link className={styles.workspaceCard} to="/app/governance"><strong>Governance</strong><span>Evidence and immutable approvals</span></Link><Link className={styles.workspaceCard} to="/app/measurement"><strong>Measurement</strong><span>Protocol and health detail</span></Link><Link className={styles.workspaceCard} to="/app/operations"><strong>Operations</strong><span>Incidents, audit and rollback</span></Link></div></details>
    </main>
  );
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return <SettingsView {...{ data, result, busy }} />;
}

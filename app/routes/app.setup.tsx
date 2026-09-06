import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";

import prisma from "../db.server";
import {
  actorKey,
  ensurePilotRole,
  grantPilotRole,
  requirePilotRole,
} from "../services/access.server";
import { decryptField } from "../services/field-encryption.server";
import { ensureMerchant } from "../services/governance.server";
import {
  assessPartnerReadiness,
  PILOT_QA_KEYS,
  themeEditorDeepLink,
} from "../services/pilot-setup";
import {
  overrideQualification,
  productionEnvironmentStatus,
  qualifyProduct,
  recordThemeActivation,
  savePilotQa,
  savePilotSettings,
  syncInstallationHealth,
} from "../services/pilot-setup.server";
import { apiVersion, authenticate } from "../shopify.server";
import styles from "../styles/governance.module.css";

function contactConfigured(value: string | null | undefined) {
  const contact = decryptField<Record<string, unknown>>(value);
  return Boolean(contact?.name && contact?.email);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const currentRole = await ensurePilotRole({
    db: prisma,
    merchantId: merchant.id,
    actor,
  });
  const installation = await syncInstallationHealth({
    db: prisma,
    merchantId: merchant.id,
    sessionScope: session.scope,
    apiVersion,
  });
  const [settings, products, pixel, roles, brandProfile] = await Promise.all([
    prisma.pilotSettings.findUnique({ where: { merchantId: merchant.id } }),
    prisma.product.findMany({
      where: { merchantId: merchant.id, status: "ACTIVE" },
      orderBy: { title: "asc" },
      include: { qualification: true, themeActivation: true, qaChecks: true },
    }),
    prisma.pixelCredential.findUnique({ where: { merchantId: merchant.id } }),
    prisma.pilotRole.findMany({
      where: { merchantId: merchant.id, active: true },
      orderBy: { grantedAt: "asc" },
    }),
    prisma.brandProfile.findUnique({ where: { merchantId: merchant.id } }),
  ]);
  const environment = productionEnvironmentStatus();
  const incidentContactConfigured = contactConfigured(
    settings?.incidentContactJson,
  );
  const productRows = products.map((product) => {
    const qaPassed = product.qaChecks.filter(
      (check) => check.status === "PASSED",
    ).length;
    const readiness = assessPartnerReadiness({
      scopesReady: installation.ready,
      brandProfileApproved: brandProfile?.status === "APPROVED",
      qualificationReady:
        product.qualification?.status === "READY" ||
        Boolean(product.qualification?.overriddenAt),
      themeActive: product.themeActivation?.activeOnPublishedTheme === true,
      qaPassed,
      incidentContactConfigured,
      pixelActive: pixel?.status === "ACTIVE",
      stableAppUrl: environment.stableAppUrl,
      productionSecretsConfigured:
        environment.shopifyCredentialsConfigured &&
        environment.assignmentSecretConfigured &&
        environment.encryptionConfigured,
      automationConfigured: environment.automationConfigured,
      backupConfigured: environment.backupConfigured,
      alertDeliveryConfigured: environment.alertDeliveryConfigured,
      durableDatabaseConfigured: environment.durableDatabaseConfigured,
    });
    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      qualification: product.qualification
        ? {
            ...product.qualification,
            revenueAmount: Number(product.qualification.revenueAmount),
            windowStart: product.qualification.windowStart.toISOString(),
            windowEnd: product.qualification.windowEnd.toISOString(),
            evaluatedAt: product.qualification.evaluatedAt.toISOString(),
            overriddenAt:
              product.qualification.overriddenAt?.toISOString() ?? null,
            assumptions: JSON.parse(product.qualification.assumptionsJson) as {
              reasons?: string[];
            },
          }
        : null,
      theme: product.themeActivation
        ? {
            ...product.themeActivation,
            detectedAt:
              product.themeActivation.detectedAt?.toISOString() ?? null,
            verifiedAt:
              product.themeActivation.verifiedAt?.toISOString() ?? null,
          }
        : null,
      qaChecks: product.qaChecks,
      qaPassed,
      readiness,
    };
  });
  const contact = decryptField<{ name: string; email: string }>(
    settings?.incidentContactJson,
  ) ?? { name: "", email: "" };
  return {
    shop: session.shop,
    installation,
    settings: settings ? { ...settings, contact } : null,
    products: productRows,
    environment,
    themeEditorUrl: themeEditorDeepLink(
      session.shop,
      process.env.SHOPIFY_API_KEY || "a".repeat(16),
    ),
    qaKeys: PILOT_QA_KEYS,
    actor,
    currentRole: currentRole?.role ?? "UNASSIGNED",
    roles: roles.map((role) => ({
      actorKey: role.actorKey,
      role: role.role,
      grantedAt: role.grantedAt.toISOString(),
    })),
    brandProfile: brandProfile
      ? {
          status: brandProfile.status,
          voiceTraits: JSON.parse(brandProfile.voiceTraitsJson) as string[],
          vocabulary: JSON.parse(brandProfile.vocabularyJson) as string[],
          generatedAt: brandProfile.generatedAt.toISOString(),
          approvedAt: brandProfile.approvedAt?.toISOString() ?? null,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "save-settings") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await savePilotSettings({
        db: prisma,
        merchantId: merchant.id,
        unknownTrafficPolicy: String(
          formData.get("unknownTrafficPolicy") ?? "ORIGINAL",
        ),
        rawEventRetentionDays: Number(
          formData.get("rawEventRetentionDays") ?? 90,
        ),
        aggregateRetentionDays: Number(
          formData.get("aggregateRetentionDays") ?? 730,
        ),
        incidentContactName: String(formData.get("incidentContactName") ?? ""),
        incidentContactEmail: String(
          formData.get("incidentContactEmail") ?? "",
        ),
        vertical: String(formData.get("vertical") ?? ""),
        reviewProvider: String(formData.get("reviewProvider") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: "Pilot settings and incident contact saved.",
      };
    }
    if (intent === "qualify-product") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const result = await qualifyProduct({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        windowStart: new Date(String(formData.get("windowStart") ?? "")),
        windowEnd: new Date(String(formData.get("windowEnd") ?? "")),
        eligibleSessions: Number(formData.get("eligibleSessions") ?? 0),
        orders: Number(formData.get("orders") ?? 0),
        revenueAmount: Number(formData.get("revenueAmount") ?? 0),
        currencyCode: String(
          formData.get("currencyCode") ?? "USD",
        ).toUpperCase(),
        eventCoverage: Number(formData.get("eventCoverage") ?? 0) / 100,
        targetSampleSize: Number(formData.get("targetSampleSize") ?? 1000),
        minimumDurationDays: Number(formData.get("minimumDurationDays") ?? 14),
        maximumDurationDays: Number(formData.get("maximumDurationDays") ?? 42),
        actor,
      });
      return {
        ok: true,
        message: `Qualification result: ${result.result.status.replaceAll("_", " ")}.`,
      };
    }
    if (intent === "override-qualification") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      await overrideQualification({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        reason: String(formData.get("reason") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: "Qualification override recorded with its rationale.",
      };
    }
    if (intent === "record-theme-status") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const extensions = JSON.parse(
        String(formData.get("extensionsJson") ?? "[]"),
      ) as unknown;
      const activation = await recordThemeActivation({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        extensions,
        actor,
      });
      return {
        ok: true,
        message: activation.activeOnPublishedTheme
          ? "Adaptive Panel detected on the published theme."
          : "Adaptive Panel is not active on the published theme.",
      };
    }
    if (intent === "save-qa") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await savePilotQa({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        passedKeys: formData.getAll("qa").map(String),
        evidence: String(formData.get("evidence") ?? ""),
        actor,
      });
      return { ok: true, message: "Pilot QA evidence saved." };
    }
    if (intent === "grant-role") {
      const role = await grantPilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        shop: session.shop,
        shopifyUserId: String(formData.get("shopifyUserId") ?? ""),
        role: String(formData.get("role") ?? "VIEWER"),
      });
      return {
        ok: true,
        message: `${role.role} access granted to the Shopify staff user.`,
      };
    }
    return { ok: false, message: "Unknown setup action." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Setup action failed.",
    };
  }
};

const QA_LABELS: Record<string, string> = {
  placement: "Panel placement approved",
  mobile: "Mobile preview approved",
  desktop: "Desktop preview approved",
  standard_checkout: "Standard checkout and order join",
  accelerated_checkout: "Accelerated checkout and order join",
  shop_pay: "Shop Pay path",
  consent_flows: "Consent allowed, denied, and granted-late",
  original_fallback: "Timeout and invalid-content fallback",
  performance: "LCP, CLS, INP and decision latency",
};

export default function PilotSetup() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const themeFetcher = useFetcher<typeof action>();
  const busy =
    useNavigation().state !== "idle" || themeFetcher.state !== "idle";

  async function checkPublishedTheme(productId: string) {
    const shopifyGlobal = (
      globalThis as unknown as {
        shopify?: { app?: { extensions?: () => Promise<unknown[]> } };
      }
    ).shopify;
    if (!shopifyGlobal?.app?.extensions) {
      themeFetcher.submit(
        { intent: "record-theme-status", productId, extensionsJson: "[]" },
        { method: "post" },
      );
      return;
    }
    const extensions = await shopifyGlobal.app.extensions();
    themeFetcher.submit(
      {
        intent: "record-theme-status",
        productId,
        extensionsJson: JSON.stringify(extensions),
      },
      { method: "post" },
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} to="/app">
            ← Pagnetic
          </Link>
          <p className={styles.eyebrow}>Partner readiness</p>
          <h1>Setup and qualification</h1>
          <p className={styles.lede}>
            Qualify one hero product, verify the published theme, and preserve
            the evidence required to launch responsibly.
          </p>
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
      {themeFetcher.data ? (
        <div
          className={
            themeFetcher.data.ok ? styles.successMessage : styles.errorMessage
          }
          role="status"
        >
          {themeFetcher.data.message}
        </div>
      ) : null}

      <section className={styles.metrics} aria-label="Installation health">
        <article>
          <strong>{data.installation.ready ? "READY" : "ACTION"}</strong>
          <span>Shopify scopes</span>
        </article>
        <article>
          <strong>{data.products.length}</strong>
          <span>eligible catalog products</span>
        </article>
        <article>
          <strong>
            {data.products.filter((item) => item.readiness.ready).length}
          </strong>
          <span>partner-ready products</span>
        </article>
        <article>
          <strong>
            {data.products.reduce((sum, item) => sum + item.qaPassed, 0)}
          </strong>
          <span>QA checks passed</span>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 1</p>
            <h2>Installation and pilot policy</h2>
          </div>
          <p>
            {data.installation.ready
              ? "All required scopes are present."
              : `Missing: ${data.installation.missing.join(", ")}`}
          </p>
        </div>
        {data.brandProfile ? (
          <div className={styles.versionCard}>
            <div className={styles.cardHeader}>
              <div>
                <h3>Generated brand profile</h3>
                <p>{data.brandProfile.voiceTraits.join(" · ")}</p>
                <p className={styles.muted}>
                  Vocabulary:{" "}
                  {data.brandProfile.vocabulary.join(", ") ||
                    "not enough catalog text"}
                </p>
              </div>
              <span
                className={styles.statusBadge}
                data-status={
                  data.brandProfile.status === "APPROVED" ? "READY" : "HOLD"
                }
              >
                {data.brandProfile.status}
              </span>
            </div>
            <p className={styles.muted}>
              Approve it in the governed content workspace after checking the
              source-derived tone.
            </p>
          </div>
        ) : null}
        <Form className={styles.registrationForm} method="post">
          <input name="intent" type="hidden" value="save-settings" />
          <label>
            Vertical
            <input
              defaultValue={data.settings?.vertical ?? ""}
              name="vertical"
              placeholder="e.g. outdoor equipment"
              required
            />
          </label>
          <label>
            Review provider
            <input
              defaultValue={data.settings?.reviewProvider ?? ""}
              name="reviewProvider"
              placeholder="merchant-owned or provider"
            />
          </label>
          <label>
            Unknown traffic
            <select
              defaultValue={data.settings?.unknownTrafficPolicy ?? "ORIGINAL"}
              name="unknownTrafficPolicy"
            >
              <option value="ORIGINAL">Original</option>
              <option value="UNIVERSAL">Universal</option>
              <option value="EXCLUDE">Exclude</option>
            </select>
          </label>
          <label>
            Raw events, days
            <input
              defaultValue={data.settings?.rawEventRetentionDays ?? 90}
              min="30"
              max="365"
              name="rawEventRetentionDays"
              type="number"
            />
          </label>
          <label>
            Aggregates, days
            <input
              defaultValue={data.settings?.aggregateRetentionDays ?? 730}
              min="365"
              max="2555"
              name="aggregateRetentionDays"
              type="number"
            />
          </label>
          <label>
            Incident contact
            <input
              defaultValue={data.settings?.contact.name ?? ""}
              name="incidentContactName"
              required
            />
          </label>
          <label>
            Incident email
            <input
              defaultValue={data.settings?.contact.email ?? ""}
              name="incidentContactEmail"
              required
              type="email"
            />
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy}
            type="submit"
          >
            Save pilot policy
          </button>
        </Form>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 2</p>
            <h2>Historical product qualification</h2>
          </div>
          <p>
            Use product-page traffic—not whole-store traffic—for the proposed
            experiment window.
          </p>
        </div>
        <Form className={styles.registrationForm} method="post">
          <input name="intent" type="hidden" value="qualify-product" />
          <label>
            Product
            <select name="productId" required>
              {data.products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Window start
            <input name="windowStart" required type="date" />
          </label>
          <label>
            Window end
            <input name="windowEnd" required type="date" />
          </label>
          <label>
            Eligible PDP sessions
            <input min="0" name="eligibleSessions" required type="number" />
          </label>
          <label>
            Orders
            <input min="0" name="orders" required type="number" />
          </label>
          <label>
            Revenue
            <input
              min="0"
              name="revenueAmount"
              required
              step="0.01"
              type="number"
            />
          </label>
          <label>
            Currency
            <input
              defaultValue="USD"
              maxLength={3}
              name="currencyCode"
              required
            />
          </label>
          <label>
            Event coverage %
            <input
              defaultValue="95"
              min="0"
              max="100"
              name="eventCoverage"
              required
              type="number"
            />
          </label>
          <label>
            Target sample
            <input
              defaultValue="1000"
              min="20"
              name="targetSampleSize"
              required
              type="number"
            />
          </label>
          <label>
            Minimum days
            <input
              defaultValue="14"
              min="7"
              name="minimumDurationDays"
              required
              type="number"
            />
          </label>
          <label>
            Maximum days
            <input
              defaultValue="42"
              min="7"
              name="maximumDurationDays"
              required
              type="number"
            />
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy || !data.products.length}
            type="submit"
          >
            Calculate qualification
          </button>
        </Form>
        <div className={styles.versionList}>
          {data.products
            .filter((item) => item.qualification)
            .map((item) => (
              <article className={styles.versionCard} key={item.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3>{item.title}</h3>
                    <p>
                      {item.qualification?.weeklyEligibleSessions.toFixed(0)}{" "}
                      eligible sessions/week ·{" "}
                      {item.qualification?.expectedDurationDays.toFixed(1)}{" "}
                      expected days
                    </p>
                  </div>
                  <span
                    className={styles.statusBadge}
                    data-status={
                      item.qualification?.status === "READY" ||
                      item.qualification?.overriddenAt
                        ? "READY"
                        : "HOLD"
                    }
                  >
                    {item.qualification?.overriddenAt
                      ? "OVERRIDDEN"
                      : item.qualification?.status.replaceAll("_", " ")}
                  </span>
                </div>
                <ul>
                  {item.qualification?.assumptions.reasons?.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {item.qualification?.status !== "READY" &&
                !item.qualification?.overriddenAt ? (
                  <Form className={styles.inlineForm} method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="override-qualification"
                    />
                    <input name="productId" type="hidden" value={item.id} />
                    <label>
                      Override rationale
                      <input minLength={20} name="reason" required />
                    </label>
                    <button
                      className={styles.dangerButton}
                      disabled={busy}
                      type="submit"
                    >
                      Record internal override
                    </button>
                  </Form>
                ) : null}
              </article>
            ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 3</p>
            <h2>Published theme and launch QA</h2>
          </div>
          <p>
            Activation is read from Shopify’s published-theme extension status.
          </p>
        </div>
        <div className={styles.versionList}>
          {data.products.map((item) => (
            <article className={styles.versionCard} key={item.id}>
              <div className={styles.cardHeader}>
                <div>
                  <h3>{item.title}</h3>
                  <p>
                    {item.theme?.activeOnPublishedTheme
                      ? `Active · ${item.theme.activationTarget}`
                      : "Adaptive Panel not yet verified"}
                  </p>
                </div>
                <span
                  className={styles.statusBadge}
                  data-status={item.readiness.ready ? "READY" : "HOLD"}
                >
                  {item.readiness.ready ? "PARTNER READY" : "BLOCKED"}
                </span>
              </div>
              <div className={styles.actionRow}>
                <a
                  className={styles.primaryButton}
                  href={data.themeEditorUrl}
                  rel="noreferrer"
                  target="_top"
                >
                  Add block in theme editor
                </a>
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => void checkPublishedTheme(item.id)}
                  type="button"
                >
                  Check published theme
                </button>
                <Link
                  className={styles.textButton}
                  to={`/app/preview?productId=${encodeURIComponent(item.id)}`}
                >
                  Preview experiences
                </Link>
              </div>
              <Form method="post">
                <input name="intent" type="hidden" value="save-qa" />
                <input name="productId" type="hidden" value={item.id} />
                <div className={styles.readinessList}>
                  {data.qaKeys.map((key) => (
                    <label key={key}>
                      <input
                        defaultChecked={item.qaChecks.some(
                          (check) =>
                            check.key === key && check.status === "PASSED",
                        )}
                        name="qa"
                        type="checkbox"
                        value={key}
                      />{" "}
                      {QA_LABELS[key] ?? key}
                    </label>
                  ))}
                </div>
                <label>
                  Evidence or test-run reference
                  <input
                    defaultValue={
                      item.qaChecks.find((check) => check.evidence)?.evidence ??
                      ""
                    }
                    name="evidence"
                    placeholder="Build, report, ticket, or dated manual test"
                  />
                </label>
                <button
                  className={styles.primaryButton}
                  disabled={busy}
                  type="submit"
                >
                  Save QA evidence
                </button>
              </Form>
              <div className={styles.readinessList}>
                {item.readiness.checks.map((check) => (
                  <div data-passed={check.passed} key={check.key}>
                    <strong>
                      {check.passed ? "✓" : "×"} {check.label}
                    </strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Access</p>
            <h2>Pilot roles</h2>
          </div>
          <p>
            Current identity: {data.actor} · {data.currentRole}
          </p>
        </div>
        <Form className={styles.inlineForm} method="post">
          <input name="intent" type="hidden" value="grant-role" />
          <label>
            Shopify staff user ID
            <input name="shopifyUserId" required />
          </label>
          <label>
            Role
            <select name="role">
              <option value="OPERATOR">Operator</option>
              <option value="VIEWER">Viewer</option>
              <option value="OWNER">Owner</option>
            </select>
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy || data.currentRole !== "OWNER"}
            type="submit"
          >
            Grant role
          </button>
        </Form>
        <ul className={styles.auditList}>
          {data.roles.map((role) => (
            <li key={role.actorKey}>
              <span>{role.actorKey}</span>
              <strong>{role.role}</strong>
              <time>{new Date(role.grantedAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Infrastructure</p>
            <h2>Production environment</h2>
          </div>
          <p>
            These values come from deployment secrets and cannot be bypassed
            from the merchant UI.
          </p>
        </div>
        <div className={styles.readinessList}>
          {Object.entries(data.environment).map(([key, value]) => (
            <div data-passed={value} key={key}>
              <strong>
                {value ? "✓" : "×"} {key.replaceAll(/([A-Z])/g, " $1")}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

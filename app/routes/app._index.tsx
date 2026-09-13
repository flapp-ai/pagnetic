import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";

import prisma from "../db.server";
import { actorKey, ensurePilotRole, requirePilotRole } from "../services/access.server";
import {
  advanceAutopilotPlan,
  markAutopilotVerifying,
  pauseAutopilotPlan,
  resumeAutopilotPlan,
} from "../services/autopilot-orchestrator.server";
import { approveAutopilotPlan } from "../services/autopilot-preparation.server";
import { enqueueAutopilotPreparation } from "../services/autopilot-preparation-worker.server";
import {
  AUTOPILOT_PREPARATION_REFRESH_INTERVAL_MS,
  shouldRefreshAutopilotPreparation,
} from "../services/autopilot-preparation-refresh";
import { loadAutopilotPresentation } from "../services/autopilot-presentation.server";
import {
  resultValueSemantics,
  shouldOfferThemeVerification,
} from "../services/autopilot-presentation";
import { ensureMerchant, syncProducts } from "../services/governance.server";
import {
  LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
  mvpV2EnabledForShop,
} from "../services/mvp-v2";
import { themeEditorDeepLink } from "../services/pilot-setup";
import { recordThemeActivation } from "../services/pilot-setup.server";
import { publicAppOrigin } from "../services/public-origin.server";
import {
  createShopifyAppPricingProviderV2,
  loadShopifyShopIdV2,
} from "../services/shopify-app-pricing-v2.server";
import { verifySubscriptionV2 } from "../services/subscription-v2.server";
import {
  assertSelectedV2CutoverShop,
  assertCurrentV2TestStoreCutoverReceipt,
  beginSelectedTestStoreV2Cutover,
  loadAuthenticatedV2QaEvidenceProgress,
  loadSourceInvalidatedLegacyCutoverCandidate,
  loadV2TestStoreCutoverReceipt,
  recordAuthenticatedV2ThemeEvidence,
  releaseSelectedTestStoreV2CutoverHold,
  reviseSelectedTestStoreV2CutoverProduct,
  V2_TEST_STORE_CUTOVER_ACTION,
} from "../services/test-store-cutover.server";
import { authenticateAdmin } from "../shopify.server";
import styles from "../styles/governance.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  await ensurePilotRole({ db: prisma, merchantId: merchant.id, actor });
  const pricingPlanHandle = new URL(request.url).searchParams.get("plan_handle");
  const providerConfigured = [
    process.env.SHOPIFY_PARTNER_ORGANIZATION_ID,
    process.env.SHOPIFY_PARTNER_API_TOKEN,
    process.env.SHOPIFY_PARTNER_APP_ID,
    process.env.SHOPIFY_APP_PRICING_PLAN_HANDLE,
  ].every((value) => Boolean(value?.trim()));
  // Refresh on every authenticated app entry, not only when Shopify appends a
  // plan_handle after approval. Declines, reinstalls and lifecycle changes can
  // otherwise leave a stale ACTIVE row visible and usable indefinitely.
  if (providerConfigured) {
    try {
      const shopId = await loadShopifyShopIdV2((query) => admin.graphql(query));
      await verifySubscriptionV2({
        db: prisma,
        merchantId: merchant.id,
        provider: createShopifyAppPricingProviderV2({ shopId }),
      });
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          merchantId: merchant.id,
          actor: "system:shopify-app-pricing",
          action: "SUBSCRIPTION_REDIRECT_VERIFICATION_FAILED",
          resourceType: "MERCHANT",
          resourceId: merchant.id,
          detailsJson: JSON.stringify({
            refreshTrigger: pricingPlanHandle ? "PLAN_REDIRECT" : "APP_ENTRY",
            reason: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN",
          }),
        },
      });
    }
  }
  if (pricingPlanHandle) {
    const allowedRedirectHandles = new Set([
      process.env.SHOPIFY_APP_PRICING_PLAN_HANDLE,
      process.env.SHOPIFY_APP_PRICING_TEST_PLAN_HANDLE,
    ].map((value) => value?.trim()).filter(Boolean));
    if (!allowedRedirectHandles.has(pricingPlanHandle)) {
      await prisma.auditLog.create({
        data: {
          merchantId: merchant.id,
          actor: "system:shopify-app-pricing",
          action: "SUBSCRIPTION_REDIRECT_HANDLE_REJECTED",
          resourceType: "MERCHANT",
          resourceId: merchant.id,
          detailsJson: JSON.stringify({
            planHandle: pricingPlanHandle.slice(0, 100),
          }),
        },
      });
    }
  }
  let preparationError: string | null = null;
  let preparationPending = false;
  try {
    const preparationJob = await enqueueAutopilotPreparation({
      db: prisma,
      merchantId: merchant.id,
      shop: session.shop,
      endpoint: `${publicAppOrigin(request)}/storefront/events`,
    });
    preparationPending = ["PENDING", "RETRY", "RUNNING"].includes(
      preparationJob.status,
    );
  } catch (error) {
    preparationError =
      error instanceof Error
        ? error.message
        : "Pagnetic could not finish preparation yet.";
    await prisma.auditLog.create({
      data: {
        merchantId: merchant.id,
        actor: "system:autopilot-install",
        action: "autopilot_preparation_failed",
        resourceType: "MERCHANT",
        resourceId: merchant.id,
        detailsJson: JSON.stringify({ reason: preparationError.slice(0, 300) }),
      },
    });
  }
  const view = await loadAutopilotPresentation({
    db: prisma,
    merchantId: merchant.id,
  });
  let v2CutoverSelected = false;
  try {
    assertSelectedV2CutoverShop({ shop: session.shop });
    v2CutoverSelected = true;
  } catch {
    v2CutoverSelected = false;
  }
  let v2Reselection: null | {
    priorReceiptId: string;
    products: Array<{
      id: string;
      title: string;
      status: string;
      sourceVersion: string;
      sourceHash: string;
    }>;
  } = null;
  let v2PreparationRetry: null | {
    receiptId: string;
    product: { id: string; title: string; status: string };
  } = null;
  let v2SourceInvalidatedCutover = false;
  let v2QaProgress: null | {
    acceptedChecks: string[];
    pendingChecks: string[];
  } = null;
  if (
    v2CutoverSelected &&
    view.plan?.state === "INVALIDATED" &&
    view.plan.orchestrationProtocolVersion ===
      LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION
  ) {
    const recoverable = await loadSourceInvalidatedLegacyCutoverCandidate({
      db: prisma,
      merchantId: merchant.id,
      planId: view.plan.id,
    });
    v2SourceInvalidatedCutover = Boolean(recoverable);
    const latest = await prisma.actionReceipt.findFirst({
      where: {
        merchantId: merchant.id,
        action: V2_TEST_STORE_CUTOVER_ACTION,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!recoverable && latest) {
      try {
        const cutover = await loadV2TestStoreCutoverReceipt({
          db: prisma,
          merchantId: merchant.id,
          receiptId: latest.id,
          requireCurrentSource: true,
        });
        const [v2PlanCount, selectedProduct, products] = await Promise.all([
          prisma.autopilotPlan.count({
            where: {
              merchantId: merchant.id,
              orchestrationProtocolVersion:
                MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION,
            },
          }),
          prisma.product.findFirst({
            where: {
              id: cutover.scope.productId,
              merchantId: merchant.id,
              status: "ACTIVE",
            },
            select: { id: true, title: true, status: true },
          }),
          prisma.product.findMany({
            where: {
              merchantId: merchant.id,
              status: "ACTIVE",
              id: { not: cutover.scope.productId },
            },
            select: {
              id: true,
              title: true,
              status: true,
              sourceVersion: true,
              sourceHash: true,
            },
            orderBy: [{ syncedAt: "desc" }, { id: "asc" }],
            take: 50,
          }),
        ]);
        if (v2PlanCount === 0) {
          v2Reselection = { priorReceiptId: latest.id, products };
          if (selectedProduct)
            v2PreparationRetry = {
              receiptId: latest.id,
              product: selectedProduct,
            };
        }
      } catch {
        v2Reselection = null;
        v2PreparationRetry = null;
      }
    }
  }
  if (
    v2CutoverSelected &&
    view.plan?.orchestrationProtocolVersion ===
      MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION &&
    view.plan.cutoverReceiptId
  ) {
    try {
      v2QaProgress = await loadAuthenticatedV2QaEvidenceProgress({
        db: prisma,
        merchantId: merchant.id,
        planId: view.plan.id,
      });
    } catch {
      v2QaProgress = null;
    }
  }
  const viewEvent =
    view.plan?.state === "READY_FOR_APPROVAL"
      ? "opportunity_viewed"
      : view.plan?.state === "RESULT_READY"
        ? "result_viewed"
        : null;
  if (viewEvent && view.plan) {
    const seen = await prisma.auditLog.findFirst({
      where: {
        merchantId: merchant.id,
        resourceId: view.plan.id,
        action: viewEvent,
      },
    });
    if (!seen) {
      await prisma.auditLog.create({
        data: {
          merchantId: merchant.id,
          actor,
          action: viewEvent,
          resourceType: "AUTOPILOT_PLAN",
          resourceId: view.plan.id,
          detailsJson: "{}",
        },
      });
    }
  }
  return {
    shop: session.shop,
    preparationError,
    preparationPending,
    v2CutoverSelected,
    v2SourceInvalidatedCutover,
    v2Enabled: mvpV2EnabledForShop(session.shop),
    v2QaProgress,
    v2PreparationRetry,
    v2Reselection,
    themeEditorUrl: themeEditorDeepLink(
      session.shop,
      process.env.SHOPIFY_API_KEY || "a".repeat(16),
      view.product
        ? {
            handle: view.product.handle,
            templateSuffix: view.product.templateSuffix,
          }
        : undefined,
    ),
    view,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  try {
    await requirePilotRole({
      db: prisma,
      merchantId: merchant.id,
      actor,
      allowed: intent === "approve-plan" ? ["OWNER"] : ["OWNER", "OPERATOR"],
    });
    if (intent === "begin-v2-cutover") {
      assertSelectedV2CutoverShop({ shop: session.shop });
      if (
        String(formData.get("confirmation") ?? "") !==
        "retire-legacy-and-prepare-v2"
      )
        throw new Error("V2_CUTOVER_EXPLICIT_CONFIRMATION_REQUIRED");
      const planId = String(formData.get("planId") ?? "");
      const productId = String(formData.get("productId") ?? "");
      const expectedSourceVersion = String(
        formData.get("sourceVersion") ?? "",
      );
      const expectedSourceHash = String(formData.get("sourceHash") ?? "");
      await syncProducts({
        db: prisma,
        shop: session.shop,
        actor,
        graphql: (query) => admin.graphql(query),
      });
      const result = await beginSelectedTestStoreV2Cutover({
        db: prisma,
        merchantId: merchant.id,
        productId,
        legacyPlanId: planId,
        expectedSourceVersion,
        expectedSourceHash,
        actor,
        idempotencyKey: `v2-cutover:${planId}:${expectedSourceHash}`,
      });
      await enqueueAutopilotPreparation({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        endpoint: `${publicAppOrigin(request)}/storefront/events`,
        preferredProductId: productId,
        cutoverReceiptId: result.receipt.id,
        explicitRetry: true,
      });
      return {
        ok: true,
        message: result.replayed
          ? "The selected v2 cutover is already recorded; fresh preparation is queued."
          : "Legacy approval was retained and retired. Fresh v2 preparation is queued from the current product source.",
      };
    }
    if (intent === "reselect-v2-product") {
      assertSelectedV2CutoverShop({ shop: session.shop });
      if (
        String(formData.get("confirmation") ?? "") !==
        "reselect-v2-product"
      )
        throw new Error("V2_CUTOVER_EXPLICIT_CONFIRMATION_REQUIRED");
      const productId = String(formData.get("productId") ?? "");
      const priorReceiptId = String(formData.get("priorReceiptId") ?? "");
      const expectedSourceVersion = String(
        formData.get("sourceVersion") ?? "",
      );
      const expectedSourceHash = String(formData.get("sourceHash") ?? "");
      await syncProducts({
        db: prisma,
        shop: session.shop,
        actor,
        graphql: (query) => admin.graphql(query),
      });
      const result = await reviseSelectedTestStoreV2CutoverProduct({
        db: prisma,
        merchantId: merchant.id,
        priorReceiptId,
        productId,
        expectedSourceVersion,
        expectedSourceHash,
        actor,
        idempotencyKey: `v2-reselect:${priorReceiptId}:${productId}:${expectedSourceHash}`,
      });
      await enqueueAutopilotPreparation({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        endpoint: `${publicAppOrigin(request)}/storefront/events`,
        preferredProductId: productId,
        cutoverReceiptId: result.receipt.id,
        explicitRetry: true,
      });
      return {
        ok: true,
        message: result.replayed
          ? "This product reselection is already recorded; preparation is queued."
          : "The original cutover receipt was retained and preparation is now scoped to the newly selected product.",
      };
    }
    if (intent === "retry-v2-preparation") {
      assertSelectedV2CutoverShop({ shop: session.shop });
      if (
        String(formData.get("confirmation") ?? "") !==
        "retry-current-v2-product"
      )
        throw new Error("V2_CUTOVER_EXPLICIT_CONFIRMATION_REQUIRED");
      const receiptId = String(formData.get("receiptId") ?? "");
      const productId = String(formData.get("productId") ?? "");
      await syncProducts({
        db: prisma,
        shop: session.shop,
        actor,
        graphql: (query) => admin.graphql(query),
      });
      const cutover = await assertCurrentV2TestStoreCutoverReceipt({
        db: prisma,
        merchantId: merchant.id,
        receiptId,
        productId,
        requireCurrentSource: true,
      });
      const product = await prisma.product.findFirst({
        where: {
          id: cutover.scope.productId,
          merchantId: merchant.id,
          status: "ACTIVE",
        },
        select: { title: true },
      });
      if (!product) throw new Error("V2_CUTOVER_PRODUCT_INACTIVE");
      await enqueueAutopilotPreparation({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        endpoint: `${publicAppOrigin(request)}/storefront/events`,
        preferredProductId: cutover.scope.productId,
        cutoverReceiptId: cutover.receipt.id,
        explicitRetry: true,
      });
      return {
        ok: true,
        message: `Fresh source-backed preparation is queued for ${product.title}.`,
      };
    }
    if (intent === "approve-plan") {
      await approveAutopilotPlan({
        db: prisma,
        merchantId: merchant.id,
        planId: String(formData.get("planId") ?? ""),
        planHash: String(formData.get("planHash") ?? ""),
        mediumRiskAcknowledged:
          String(formData.get("mediumRiskAcknowledged") ?? "") === "yes",
        actor,
      });
      return {
        ok: true,
        message: "Plan approved. One Shopify theme-save step remains.",
      };
    }
    if (intent === "choose-candidate" || intent === "prepare") {
      await enqueueAutopilotPreparation({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        endpoint: `${publicAppOrigin(request)}/storefront/events`,
        preferredProductId:
          intent === "choose-candidate"
            ? String(formData.get("productId") ?? "")
            : undefined,
        explicitRetry: true,
      });
      return {
        ok: true,
        message: intent === "choose-candidate"
          ? "That product is queued for a source and eligibility check."
          : "Opportunity preparation is queued. You can leave this page while Pagnetic works.",
      };
    }
    if (intent === "open-theme-editor") {
      const planId = String(formData.get("planId") ?? "");
      const plan = await prisma.autopilotPlan.findFirst({
        where: { id: planId, merchantId: merchant.id },
        include: { product: true },
      });
      if (!plan) throw new Error("Autopilot plan was not found for this store.");
      let templateSuffix: string | null = null;
      try {
        const snapshot = JSON.parse(plan.product.sourceSnapshot) as {
          templateSuffix?: string | null;
        };
        templateSuffix = snapshot.templateSuffix ?? null;
      } catch {
        templateSuffix = null;
      }
      await prisma.auditLog.create({
        data: {
          merchantId: merchant.id,
          actor,
          action: "theme_editor_opened",
          resourceType: "AUTOPILOT_PLAN",
          resourceId: plan.id,
          detailsJson: JSON.stringify({ productId: plan.productId }),
        },
      });
      return redirect(
        themeEditorDeepLink(
          session.shop,
          process.env.SHOPIFY_API_KEY || "a".repeat(16),
          { handle: plan.product.handle, templateSuffix },
        ),
      );
    }
    if (intent === "verify-theme") {
      const planId = String(formData.get("planId") ?? "");
      const plan = await prisma.autopilotPlan.findFirst({
        where: { id: planId, merchantId: merchant.id },
      });
      if (!plan) throw new Error("Autopilot plan was not found for this store.");
      const extensions = JSON.parse(
        String(formData.get("extensionsJson") ?? "[]"),
      );
      const v2 =
        plan.orchestrationProtocolVersion ===
        MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION;
      const activation = v2
        ? (
            await recordAuthenticatedV2ThemeEvidence({
              db: prisma,
              merchantId: merchant.id,
              productId: plan.productId,
              extensions,
              actor,
            })
          ).theme
        : await recordThemeActivation({
            db: prisma,
            merchantId: merchant.id,
            productId: plan.productId,
            extensions,
            actor,
          });
      const verifying = await markAutopilotVerifying({
        db: prisma,
        merchantId: merchant.id,
        planId: plan.id,
        actor,
        themeActive: activation.activeOnPublishedTheme,
      });
      if (verifying.state === "VERIFYING" && !v2) {
        await advanceAutopilotPlan({
          db: prisma,
          merchantId: merchant.id,
          planId: plan.id,
        });
      }
      return {
        ok: activation.activeOnPublishedTheme,
        message: activation.activeOnPublishedTheme
          ? "Published theme verified. Pagnetic is checking the remaining measurement gates."
          : "The panel is not saved on the published theme yet. Preview it and click Save in Shopify.",
      };
    }
    if (intent === "activate-v2-cutover") {
      if (!mvpV2EnabledForShop(session.shop))
        throw new Error("V2_CUTOVER_REVIEWED_BACKEND_NOT_ENABLED");
      assertSelectedV2CutoverShop({ shop: session.shop });
      const planId = String(formData.get("planId") ?? "");
      await releaseSelectedTestStoreV2CutoverHold({
        db: prisma,
        merchantId: merchant.id,
        planId,
        actor,
      });
      const result = await advanceAutopilotPlan({
        db: prisma,
        merchantId: merchant.id,
        planId,
      });
      return {
        ok: result.outcome === "AA_STARTED",
        message:
          result.outcome === "AA_STARTED"
            ? "The registered Original-only baseline is active on this selected test store."
            : `Activation remains fail-closed: ${result.outcome}.`,
      };
    }
    if (intent === "pause-plan") {
      await pauseAutopilotPlan({
        db: prisma,
        merchantId: merchant.id,
        planId: String(formData.get("planId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: "Autopilot paused. New shoppers receive the original storefront.",
      };
    }
    if (intent === "resume-plan") {
      await resumeAutopilotPlan({
        db: prisma,
        merchantId: merchant.id,
        planId: String(formData.get("planId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: "Autopilot resumed under the original frozen protocol.",
      };
    }
    return { ok: false, message: "Unknown Autopilot action." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "The Autopilot action failed.",
    };
  }
};

export function DashboardView({
  data,
  actionData,
  themeFetcher,
  busy,
}: {
  data: ReturnType<typeof useLoaderData<typeof loader>>;
  actionData: ReturnType<typeof useActionData<typeof action>>;
  themeFetcher: ReturnType<typeof useFetcher<typeof action>>;
  busy: boolean;
}) {
  const { view } = data;
  const resultSemantics = resultValueSemantics();

  async function checkPublishedTheme() {
    if (!view.plan) return;
    const shopifyGlobal = (
      globalThis as unknown as {
        shopify?: { app?: { extensions?: () => Promise<unknown[]> } };
      }
    ).shopify;
    const extensions = shopifyGlobal?.app?.extensions
      ? await shopifyGlobal.app.extensions()
      : [];
    themeFetcher.submit(
      {
        intent: "verify-theme",
        planId: view.plan.id,
        extensionsJson: JSON.stringify(extensions),
      },
      { method: "post" },
    );
  }

  const message = actionData ?? themeFetcher.data;
  const live =
    view.plan &&
    ["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING", "RESULT_READY"].includes(
      view.plan.state,
    );
  const offerThemeVerification = Boolean(
    view.plan &&
      shouldOfferThemeVerification({
        planState: view.plan.state,
        pendingQaChecks: data.v2QaProgress?.pendingChecks,
      }),
  );
  const recapturingReleaseEvidence = view.plan?.state === "VERIFYING";
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Pagnetic · Autopilot</p>
          <h1>{view.merchantState.headline}</h1>
          <p className={styles.lede}>{view.merchantState.detail}</p>
        </div>
        <span
          className={styles.statusBadge}
          data-status={
            view.merchantState.state === "NEEDS_ATTENTION"
              ? "HOLD"
              : view.merchantState.state === "RESULT_READY"
                ? "POSITIVE"
                : "COLLECTING"
          }
        >
          {view.merchantState.state.replaceAll("_", " ")}
        </span>
      </header>

      {data.preparationError ? (
        <div className={styles.errorMessage} role="alert">
          {data.preparationError}
        </div>
      ) : null}
      {message ? (
        <div
          className={message.ok ? styles.successMessage : styles.errorMessage}
          role="status"
        >
          {message.message}
        </div>
      ) : null}

      {view.result ? (
        <section
          className={`${styles.section} ${styles[resultSemantics.verified.visualTreatment]}`}
          aria-label={resultSemantics.verified.ariaLabel}
          aria-labelledby="result-title"
        >
          <p className={styles.step}>
            {resultSemantics.verified.eyebrow} · {view.result.state}
          </p>
          <h2 id="result-title">{resultSemantics.verified.heading}</h2>
          <strong className={styles.valueFigure}>{view.result.verifiedLabel}</strong>
          <p>
            {view.result.intervalLabel
              ? `95% interval: ${view.result.intervalLabel}`
              : "An uncertainty interval is unavailable for this invalid result."}
          </p>
          <div className={styles.resultFacts}>
            <span>{view.result.eligibleSessions.toLocaleString()} eligible sessions</span>
            <span>{view.result.differenceLabel}</span>
            <span>
              {view.result.startedAt.slice(0, 10)} to {view.result.endedAt.slice(0, 10)}
            </span>
          </div>
          <h3>Recommendation: {view.result.recommendation}</h3>
          {view.result.projectedLabel ? (
            <aside
              className={styles[resultSemantics.projected.visualTreatment]}
              aria-label={resultSemantics.projected.ariaLabel}
            >
              <span>{resultSemantics.projected.eyebrow}</span>
              <strong>{view.result.projectedLabel}</strong>
              <small>{resultSemantics.projected.heading}</small>
            </aside>
          ) : null}
        </section>
      ) : null}

      {view.plan?.state === "RESULT_READY" && !view.result ? (
        <section className={styles.section} aria-labelledby="frozen-result-link">
          <p className={styles.step}>Frozen result available</p>
          <h2 id="frozen-result-link">Review the scoped experiment result</h2>
          <p>Pagnetic shows monetary outcomes only from the immutable financial-cutoff snapshot.</p>
          <Link className={styles.primaryButton} to="/app/results">Open Results</Link>
        </section>
      ) : null}

      <section className={styles.betaBanner} aria-live="polite">
        <div>
          <p className={styles.step}>{view.merchantState.eyebrow}</p>
          <h2>{view.product?.title ?? "Your first opportunity"}</h2>
          <p>
            {view.plan
              ? view.plan.timelineLabel
              : "Pagnetic will keep your original storefront unchanged until one bounded plan is approved."}
          </p>
        </div>
        {view.plan?.state === "READY_FOR_APPROVAL" ? (
          <a className={styles.primaryButton} href="#opportunity">
            Review opportunity →
          </a>
        ) : view.plan && ["APPROVED", "WAITING_FOR_THEME"].includes(view.plan.state) ? (
          <Form method="post">
            <input name="intent" type="hidden" value="open-theme-editor" />
            <input name="planId" type="hidden" value={view.plan.id} />
            <button className={styles.primaryButton} disabled={busy} type="submit">
              Open theme editor →
            </button>
          </Form>
        ) : !view.plan ? (
          <Form method="post">
            <input name="intent" type="hidden" value="prepare" />
            <button className={styles.primaryButton} disabled={busy} type="submit">
              Prepare opportunity →
            </button>
          </Form>
        ) : (
          <strong>
            {view.merchantState.primaryAction?.label ??
              (view.merchantState.owner === "WAITING_FOR_DATA"
                ? "Waiting for registered evidence"
                : live
                  ? "Pagnetic owns the next check"
                  : "Original is active")}
          </strong>
        )}
      </section>

      {data.v2CutoverSelected &&
      view.plan?.orchestrationProtocolVersion ===
        LEGACY_AUTOPILOT_PLAN_PROTOCOL_VERSION &&
      (view.plan.state !== "INVALIDATED" ||
        data.v2SourceInvalidatedCutover) &&
      view.product ? (
        <section className={styles.section} aria-labelledby="v2-cutover-title">
          <p className={styles.step}>Selected test-store migration</p>
          <h2 id="v2-cutover-title">Prepare a fresh v2 plan</h2>
          <p>
            {data.v2SourceInvalidatedCutover
              ? "The prior authority was already invalidated because its frozen source changed. This records that exact history without reviving or reusing the old approval, then prepares v2 only from the current source."
              : "This keeps the legacy approval and test history immutable, returns serving to Original, syncs this exact product, and requires a new owner approval."} If the current product has no supported sourced opportunity, Pagnetic will abstain and leave Original active.
          </p>
          <Form method="post">
            <input name="intent" type="hidden" value="begin-v2-cutover" />
            <input
              name="confirmation"
              type="hidden"
              value="retire-legacy-and-prepare-v2"
            />
            <input name="planId" type="hidden" value={view.plan.id} />
            <input name="productId" type="hidden" value={view.product.id} />
            <input
              name="sourceVersion"
              type="hidden"
              value={view.product.sourceVersion}
            />
            <input
              name="sourceHash"
              type="hidden"
              value={view.product.sourceHash}
            />
            <button className={styles.secondaryButton} disabled={busy} type="submit">
              Record cutover and sync source
            </button>
          </Form>
        </section>
      ) : null}

      {data.v2Reselection ? (
        <section className={styles.section} aria-labelledby="v2-reselect-title">
          <p className={styles.step}>No supported opportunity on the prior product</p>
          <h2 id="v2-reselect-title">Select another current, active test product</h2>
          <p>
            The previous receipt and legacy approval remain immutable. Pagnetic
            will sync Shopify again and create a new scoped receipt only if no v2
            plan, deployment or experiment exists.
          </p>
          {data.v2PreparationRetry ? (
            <div className={styles.authorityBox}>
              <h3>Retry the selected product</h3>
              <p>
                Pagnetic will sync and retry {data.v2PreparationRetry.product.title}
                {" "}under the existing scoped receipt. The prior diagnosis remains in
                the audit history.
              </p>
              <Form method="post">
                <input name="intent" type="hidden" value="retry-v2-preparation" />
                <input
                  name="confirmation"
                  type="hidden"
                  value="retry-current-v2-product"
                />
                <input
                  name="receiptId"
                  type="hidden"
                  value={data.v2PreparationRetry.receiptId}
                />
                <input
                  name="productId"
                  type="hidden"
                  value={data.v2PreparationRetry.product.id}
                />
                <button className={styles.secondaryButton} disabled={busy} type="submit">
                  Retry {data.v2PreparationRetry.product.title}
                </button>
              </Form>
            </div>
          ) : null}
          {data.v2Reselection.products.length ? (
            <div className={styles.candidateChoices}>
              {data.v2Reselection.products.map((product) => (
                <Form method="post" key={product.id}>
                  <input name="intent" type="hidden" value="reselect-v2-product" />
                  <input name="confirmation" type="hidden" value="reselect-v2-product" />
                  <input name="priorReceiptId" type="hidden" value={data.v2Reselection!.priorReceiptId} />
                  <input name="productId" type="hidden" value={product.id} />
                  <input name="sourceVersion" type="hidden" value={product.sourceVersion} />
                  <input name="sourceHash" type="hidden" value={product.sourceHash} />
                  <button className={styles.secondaryButton} disabled={busy} type="submit">
                    Select {product.title}
                  </button>
                </Form>
              ))}
            </div>
          ) : (
            <p>No other active synced product is available. Publish or activate a genuinely source-rich test product in Shopify, then reload this page.</p>
          )}
        </section>
      ) : null}

      {data.v2CutoverSelected &&
      view.plan?.orchestrationProtocolVersion ===
        MVP_V2_AUTOPILOT_PLAN_PROTOCOL_VERSION &&
      view.plan.state === "VERIFYING" ? (
        <section className={styles.section} aria-labelledby="v2-activation-title">
          <p className={styles.step}>Governed activation</p>
          <h2 id="v2-activation-title">Evidence must be complete before serving</h2>
          <p>
            Theme/runtime verification records only what Pagnetic can observe.
            The migration hold cannot clear for a partial checklist or an
            unrelated safety incident.
          </p>
          {data.v2QaProgress ? (
            data.v2QaProgress.pendingChecks.length ? (
              <div className={styles.authorityBox}>
                <strong>
                  {data.v2QaProgress.pendingChecks.length} authenticated QA checks
                  remain
                </strong>
                <ul>
                  {data.v2QaProgress.pendingChecks.map((check) => (
                    <li key={check}>
                      {check
                        .replace("standard_checkout", "Standard checkout")
                        .replace("accelerated_checkout", "Accelerated checkout")
                        .replace("shop_pay", "Shop Pay")
                        .replace("consent_flows", "Consent flows")
                        .replace("mobile", "Mobile")
                        .replace("desktop", "Desktop")
                        .replace("performance", "Performance")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>All nine scoped QA checks have authenticated evidence.</p>
            )
          ) : (
            <p>Authenticated QA progress is unavailable. Original remains active.</p>
          )}
          <Form method="post">
            <input name="intent" type="hidden" value="activate-v2-cutover" />
            <input name="planId" type="hidden" value={view.plan.id} />
            <button
              className={styles.primaryButton}
              disabled={busy || !data.v2Enabled}
              type="submit"
            >
              {data.v2Enabled ? "Activate verified Original baseline" : "Awaiting reviewed backend enablement"}
            </button>
          </Form>
        </section>
      ) : null}

      {view.notices.length ? (
        <section className={styles.section} id="attention" aria-labelledby="attention-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.step}>Attention</p>
              <h2 id="attention-title">One clear next step</h2>
            </div>
          </div>
          <div className={styles.noticeList}>
            {view.notices.map((notice) => (
              <article className={styles.noticeCard} key={notice.id}>
                <strong>{notice.title}</strong>
                <p>{notice.detail}</p>
                {notice.actionLabel && notice.actionHref ? (
                  <a className={styles.secondaryButton} href={notice.actionHref}>
                    {notice.actionLabel}
                  </a>
                ) : null}
              </article>
            ))}
          </div>
          {view.candidates.length > 1 && view.notices.some((notice) => notice.kind === "CANDIDATE_TIE") ? (
            <div className={styles.candidateChoices}>
              {view.candidates.map((candidate) => (
                <Form method="post" key={candidate.productId}>
                  <input name="intent" type="hidden" value="choose-candidate" />
                  <input name="productId" type="hidden" value={candidate.productId} />
                  <button className={styles.secondaryButton} disabled={busy} type="submit">
                    {candidate.title} · {candidate.qualificationBand.replaceAll("_", " ").toLowerCase()}
                  </button>
                </Form>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {view.noticeHistory.length ? (
        <section className={styles.section} aria-labelledby="notice-history-title">
          <details>
            <summary id="notice-history-title">
              Previous workflow notices ({view.noticeHistory.length})
            </summary>
            <p>
              These notices are retained for audit history and do not describe
              the current plan&apos;s next action.
            </p>
            <div className={styles.noticeList}>
              {view.noticeHistory.map((notice) => (
                <article className={styles.noticeCard} key={notice.id}>
                  <strong>{notice.title}</strong>
                  <p>{notice.detail}</p>
                </article>
              ))}
            </div>
          </details>
        </section>
      ) : null}

      {view.plan?.state === "READY_FOR_APPROVAL" && view.product ? (
        <section className={styles.section} id="opportunity" aria-labelledby="opportunity-title">
          <div className={styles.opportunityHeader}>
            {view.product.imageUrl ? (
              <img src={view.product.imageUrl} alt={view.product.imageAlt} />
            ) : (
              <div className={styles.productPlaceholder} aria-hidden="true">P</div>
            )}
            <div>
              <p className={styles.step}>Recommended first product</p>
              <h2 id="opportunity-title">{view.product.title}</h2>
              <strong>{view.plan.qualificationBand.replaceAll("_", " ").toLowerCase()} measurement path</strong>
              <ul>
                {view.plan.explanations.map((explanation) => (
                  <li key={explanation}>{explanation}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className={styles.previewGrid}>
            <article className={styles.originalPreview}>
              <span>Original</span>
              <h3>{view.product.title}</h3>
              <p>
                {view.product.description ??
                  "The current Shopify description is unavailable in this source snapshot."}
              </p>
              <small>Current catalog source · some eligible shoppers remain on this frozen control.</small>
            </article>
            {view.experiences.map((experience) => (
              <article className={styles.panelPreview} key={experience.id}>
                <span>{experience.angle}</span>
                <h3>{experience.headline}</h3>
                {experience.supportingLine ? <p>{experience.supportingLine}</p> : null}
                <ul>
                  {experience.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                </ul>
                <details>
                  <summary>View exact sources</summary>
                  {experience.evidence.map((evidence) => (
                    <div className={styles.sourceTrace} key={`${experience.id}-${evidence.id}-${evidence.claim}`}>
                      <strong>{evidence.claim}</strong>
                      <blockquote>{evidence.source}</blockquote>
                      <small>{evidence.riskClass} risk · {evidence.sourceId}</small>
                    </div>
                  ))}
                </details>
              </article>
            ))}
          </div>
          <div className={styles.authorityBox}>
            <h3>What you authorize</h3>
            <p>
              You approve only the exact content and evidence shown above. Pagnetic may run a frozen A/A measurement check, then Original versus Universal only if A/A passes. It may pause and return every shopper to Original when a safety gate fails.
            </p>
            <p>
              Pagnetic will never change price, discounts, inventory, checkout, product images, or unapproved claims.
            </p>
            <Form method="post">
              <input name="intent" type="hidden" value="approve-plan" />
              <input name="planId" type="hidden" value={view.plan.id} />
              <input name="planHash" type="hidden" value={view.plan.planHash} />
              {view.plan.hasMediumRisk ? (
                <label className={styles.consentCheck}>
                  <input name="mediumRiskAcknowledged" type="checkbox" value="yes" required />
                  I reviewed the highlighted source-bound benefit statements.
                </label>
              ) : null}
              <button className={styles.primaryButton} disabled={busy} type="submit">
                Approve and prepare test
              </button>
            </Form>
          </div>
        </section>
      ) : null}

      {view.plan && offerThemeVerification ? (
        <section className={styles.section} aria-labelledby="enable-title">
          <p className={styles.step}>
            {recapturingReleaseEvidence
              ? "Current release verification"
              : "One Shopify action"}
          </p>
          <h2 id="enable-title">
            {recapturingReleaseEvidence
              ? "Recapture the published panel and Original fallback"
              : "1. Preview the panel. 2. Click Save in Shopify."}
          </h2>
          <p>
            {recapturingReleaseEvidence
              ? "The prior runtime evidence belongs to an older app release. Pagnetic will verify this exact product on the published theme and keep the plan in VERIFYING."
              : "Return here after saving. Pagnetic checks the published theme—not a preview or unpublished copy."}
          </p>
          <div className={styles.actionRow}>
            <Form method="post">
              <input name="intent" type="hidden" value="open-theme-editor" />
              <input name="planId" type="hidden" value={view.plan.id} />
              <button className={styles.primaryButton} disabled={busy} type="submit">Open theme editor</button>
            </Form>
            <button className={styles.secondaryButton} disabled={busy} onClick={checkPublishedTheme} type="button">
              {recapturingReleaseEvidence
                ? "Verify current release now"
                : "I saved it — verify now"}
            </button>
          </div>
        </section>
      ) : null}

      {view.measurement ? (
        <section className={styles.section} aria-labelledby="measurement-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.step}>{view.measurement.phase}</p>
              <h2 id="measurement-title">
                {view.merchantState.severity === "attention" ||
                view.merchantState.severity === "critical"
                  ? "Measurement needs attention"
                  : view.merchantState.owner === "WAITING_FOR_DATA"
                    ? "Pagnetic is monitoring the registered test"
                    : "Pagnetic is checking measurement readiness"}
              </h2>
            </div>
            <strong>{view.measurement.progress}%</strong>
          </div>
          <div className={styles.progressTrack} aria-label={`${view.measurement.progress}% of registered sample collected`}>
            <span style={{ width: `${view.measurement.progress}%` }} />
          </div>
          <p>
            {view.measurement.eligibleAssignments.toLocaleString()} of {view.measurement.target.toLocaleString()} registered assignments. The minimum duration and refund/cancellation maturity lag still apply.
          </p>
        </section>
      ) : null}

      {view.plan && ["VERIFYING", "AA_RUNNING", "REAL_TEST_RUNNING"].includes(view.plan.state) ? (
        <section className={styles.safetyBar} aria-label="Storefront safety control">
          <div>
            <strong>{view.safety.originalServing ? "Original fallback protected" : "Approved test is serving"}</strong>
            <span>Any unsafe or stale input returns shoppers to Original.</span>
          </div>
          <Form method="post">
            <input name="intent" type="hidden" value="pause-plan" />
            <input name="planId" type="hidden" value={view.plan.id} />
            <button className={styles.dangerButton} disabled={busy} type="submit">Pause</button>
          </Form>
        </section>
      ) : null}

      {view.plan?.state === "PAUSED" ? (
        <section className={styles.safetyBar} aria-label="Resume Autopilot">
          <div>
            <strong>Autopilot is paused</strong>
            <span>Every shopper receives the original storefront.</span>
          </div>
          <Form method="post">
            <input name="intent" type="hidden" value="resume-plan" />
            <input name="planId" type="hidden" value={view.plan.id} />
            <button className={styles.secondaryButton} disabled={busy} type="submit">Resume safely</button>
          </Form>
        </section>
      ) : null}

      <details className={styles.advancedDetails}>
        <summary>Advanced details and evidence</summary>
        <div className={styles.cardGrid}>
          <Link className={styles.workspaceCard} to="/app/governance">
            <strong>Content and evidence</strong><span>Sources, claims and immutable approvals</span>
          </Link>
          <Link className={styles.workspaceCard} to="/app/setup">
            <strong>Storefront verification</strong><span>Qualification, theme and checkout QA</span>
          </Link>
          <Link className={styles.workspaceCard} to="/app/measurement">
            <strong>Measurement protocol</strong><span>A/A health, registration and reports</span>
          </Link>
          <Link className={styles.workspaceCard} to="/app/operations">
            <strong>Audit and operations</strong><span>Transitions, incidents and rollback</span>
          </Link>
        </div>
        {view.activity.length ? (
          <ol className={styles.activityList}>
            {view.activity.map((item) => (
              <li key={item.id}>
                <strong>{item.state.replaceAll("_", " ")}</strong>
                <span>{item.reason.replaceAll("_", " ")} · {item.occurredAt.slice(0, 16).replace("T", " ")} UTC</span>
              </li>
            ))}
          </ol>
        ) : null}
      </details>
    </main>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const themeFetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const refreshAttempts = useRef(0);
  const busy = navigation.state !== "idle" || themeFetcher.state !== "idle";
  const preparationPending = data.preparationPending && !data.view.plan;

  useEffect(() => {
    if (!preparationPending) {
      refreshAttempts.current = 0;
      return;
    }
    const refresh = () => {
      const active = document.activeElement;
      const editableFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (!shouldRefreshAutopilotPreparation({
        pending: preparationPending,
        visible: document.visibilityState === "visible",
        busy,
        revalidatorIdle: revalidator.state === "idle",
        editableFocused,
        attempts: refreshAttempts.current,
      })) return;
      refreshAttempts.current += 1;
      revalidator.revalidate();
    };
    const timer = window.setInterval(
      refresh,
      AUTOPILOT_PREPARATION_REFRESH_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [busy, preparationPending, revalidator]);

  return <DashboardView {...{ data, actionData, themeFetcher, busy }} />;
}

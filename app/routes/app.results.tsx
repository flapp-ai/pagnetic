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
import { ensureMerchant } from "../services/governance.server";
import {
  keepV2Message,
  reviseV2Result,
  stopV2Serving,
} from "../services/result-actions-v2.server";
import {
  canPresentMonetaryResult,
  findFinalizationReviewNotice,
  formatMinorAmount,
  resolveFrozenResultSnapshot,
} from "../services/result-presentation-v2";
import { authenticate } from "../shopify.server";
import { subscriptionAllowsApprovedServingV2 } from "../services/subscription-v2.server";
import styles from "../styles/governance.module.css";

function parsePayload(value: string) {
  try {
    return JSON.parse(value) as {
      registrationHash?: string;
      analysis?: {
        resultState?: string;
        currencyCode?: string;
        relativeEffect?: number | null;
        estimatedAdditionalSalesMinor?: string;
        confidenceLevel?: number;
        intervalMinor?: { lower?: number; upper?: number };
        control?: {
          assignments?: number;
          paidPurchasers?: number;
          netRevenueMinor?: string;
          meanMinor?: number;
        };
        treatment?: {
          assignments?: number;
          paidPurchasers?: number;
          netRevenueMinor?: string;
          meanMinor?: number;
        };
        reasons?: string[];
      };
      financial?: {
        complete?: boolean;
        linkedEligibleOrders?: number;
        reconciledLinkedOrders?: number;
        contradictoryLinks?: number;
      };
    };
  } catch {
    return {};
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  await ensurePilotRole({
    db: prisma,
    merchantId: merchant.id,
    actor: actorKey(session.shop, sessionToken.sub),
  });
  const experiments = await prisma.experiment.findMany({
    where: { merchantId: merchant.id, lifecycleVersion: 2 },
    orderBy: { createdAt: "desc" },
    include: {
      product: { select: { title: true } },
      registration: true,
      resultSnapshots: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { assignments: true } },
    },
  });
  const requested = new URL(request.url).searchParams.get("experimentId");
  const selected =
    experiments.find((experiment) => experiment.id === requested) ??
    experiments[0] ??
    null;
  const queriedSnapshot =
    selected?.finalResultSnapshotId && !selected.privacyAffectedAt
      ? await prisma.experimentResultSnapshot.findFirst({
          where: {
            id: selected.finalResultSnapshotId,
            experimentId: selected.id,
          },
        })
      : null;
  const frozenSnapshot = selected
    ? resolveFrozenResultSnapshot({
        experimentId: selected.id,
        finalResultSnapshotId: selected.finalResultSnapshotId,
        snapshots: queriedSnapshot ? [queriedSnapshot] : [],
      })
    : null;
  const payload = frozenSnapshot
    ? parsePayload(frozenSnapshot.payloadJson)
    : null;
  const [activeDeployment, subscription] = selected
    ? await Promise.all([
        prisma.activeDeployment.findFirst({
          where: { merchantId: merchant.id, productId: selected.productId },
          include: { deploymentVersion: true },
        }),
        prisma.subscriptionState.findUnique({
          where: { merchantId: merchant.id },
        }),
      ])
    : [null, null];
  let registeredContent: Array<{ id?: unknown; contentHash?: unknown }> = [];
  try {
    registeredContent = JSON.parse(
      selected?.registration?.contentVersionsJson ?? "[]",
    ) as typeof registeredContent;
  } catch {
    /* action remains unavailable */
  }
  const keepContent = registeredContent.find(
    (item) =>
      typeof item.id === "string" && typeof item.contentHash === "string",
  );
  const finalizationAudits = frozenSnapshot
    ? await prisma.auditLog.findMany({
        where: {
          merchantId: merchant.id,
          action: "V2_FINANCIAL_REVISION_AFTER_FINALIZATION",
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { createdAt: true, detailsJson: true },
      })
    : [];
  const reviewNotice =
    selected && frozenSnapshot
      ? findFinalizationReviewNotice({
          experimentId: selected.id,
          finalResultSnapshotId: frozenSnapshot.id,
          audits: finalizationAudits,
        })
      : null;
  return {
    experiments: experiments.map((experiment) => ({
      id: experiment.id,
      label: `${experiment.product.title} · ${experiment.controlPolicy === experiment.treatmentPolicy ? "measurement check" : "message test"}`,
      status: experiment.status,
      final: Boolean(experiment.finalResultSnapshotId),
      privacyRestricted: Boolean(experiment.privacyAffectedAt),
    })),
    selected: selected
      ? {
          id: selected.id,
          productTitle: selected.product.title,
          testType:
            selected.controlPolicy === selected.treatmentPolicy
              ? "A/A measurement check"
              : `${selected.controlPolicy} vs ${selected.treatmentPolicy}`,
          status: selected.status,
          assignments: selected._count.assignments,
          target: selected.registration?.targetSampleSize ?? null,
          enrollmentStartedAt: (
            selected.enrollmentStartedAt ?? selected.startedAt
          ).toISOString(),
          enrollmentClosedAt:
            selected.enrollmentClosedAt?.toISOString() ?? null,
          attributionClosesAt:
            selected.attributionClosesAt?.toISOString() ?? null,
          financialMaturityAt:
            selected.financialMaturityAt?.toISOString() ?? null,
          finalizedAt: selected.finalizedAt?.toISOString() ?? null,
          registrationHash: selected.registration?.registrationHash ?? null,
          analysisVersion: selected.registration?.analysisVersion ?? null,
          privacyAffectedAt: selected.privacyAffectedAt?.toISOString() ?? null,
        }
      : null,
    result:
      frozenSnapshot && payload
        ? {
            id: frozenSnapshot.id,
            state: frozenSnapshot.resultState,
            createdAt: frozenSnapshot.createdAt.toISOString(),
            dataMaturityAt: frozenSnapshot.dataMaturityAt.toISOString(),
            dataHash: frozenSnapshot.dataHash,
            reportMarkdown: frozenSnapshot.reportMarkdown,
            analysis: payload.analysis ?? null,
            financial: payload.financial ?? null,
          }
        : null,
    reviewNotice,
    privacyRestricted: Boolean(selected?.privacyAffectedAt),
    servingContext:
      selected && activeDeployment
        ? {
            deploymentId: activeDeployment.deploymentVersion.id,
            revision: activeDeployment.revision,
            policy: activeDeployment.deploymentVersion.policy,
            state: activeDeployment.deploymentVersion.state,
            idempotencyKey: `privacy-stop-${selected.id}-${activeDeployment.revision}`,
          }
        : null,
    actionContext:
      selected && frozenSnapshot && !selected.privacyAffectedAt
        ? {
            snapshotId: frozenSnapshot.id,
            resultState: frozenSnapshot.resultState,
            measurementCheck:
              selected.controlPolicy === selected.treatmentPolicy,
            contentVersionId:
              typeof keepContent?.id === "string" ? keepContent.id : null,
            currentDeploymentId: activeDeployment?.deploymentVersion.id ?? null,
            currentRevision: activeDeployment?.revision ?? 0,
            currentPolicy:
              activeDeployment?.deploymentVersion.policy ?? "ORIGINAL",
            currentState: activeDeployment?.deploymentVersion.state ?? null,
            entitled: subscription
              ? subscriptionAllowsApprovedServingV2({
                  status: subscription.authoritativeStatus,
                  periodEnd: subscription.periodEnd,
                  now: new Date(),
                })
              : false,
            idempotencyBase: `result-${frozenSnapshot.id}`,
          }
        : null,
  };
};

function integerField(form: FormData, key: string) {
  const value = Number(form.get(key));
  if (!Number.isInteger(value) || value < 0)
    throw new Error("RESULT_ACTION_REVISION_INVALID");
  return value;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticate.admin(request);
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
    const resultSnapshotId = String(form.get("resultSnapshotId") ?? "");
    const idempotencyKey = String(form.get("idempotencyKey") ?? "");
    if (intent === "keep") {
      await keepV2Message({
        db: prisma,
        merchantId: merchant.id,
        actor,
        resultSnapshotId,
        contentVersionId: String(form.get("contentVersionId") ?? ""),
        expectedRevision: integerField(form, "expectedRevision"),
        idempotencyKey,
      });
      return {
        ok: true,
        message: "The tested message is now the reviewed product default.",
      };
    }
    if (intent === "revise") {
      await reviseV2Result({
        db: prisma,
        merchantId: merchant.id,
        actor,
        resultSnapshotId,
        reason: String(form.get("reason") ?? ""),
        idempotencyKey,
      });
      return {
        ok: true,
        message:
          "A new source-backed draft is ready for review. The frozen result was preserved.",
      };
    }
    if (intent === "stop") {
      await stopV2Serving({
        db: prisma,
        merchantId: merchant.id,
        actor,
        deploymentId: String(form.get("deploymentId") ?? ""),
        expectedRevision: integerField(form, "expectedRevision"),
        idempotencyKey,
      });
      return {
        ok: true,
        message:
          "Serving stopped. Shoppers now receive the original product page.",
      };
    }
    return { ok: false, message: "Unknown result action." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "The result action failed.",
    };
  }
};

export function ResultsView({
  data,
  actionResult,
  busy,
}: {
  data: ReturnType<typeof useLoaderData<typeof loader>>;
  actionResult: ReturnType<typeof useActionData<typeof action>>;
  busy: boolean;
}) {
  const analysis = data.result?.analysis;
  const currency = analysis?.currencyCode ?? "";
  const monetaryResult = data.result
    ? canPresentMonetaryResult({
        frozenResultState: data.result.state,
        payloadResultState: analysis?.resultState,
        estimatedAdditionalSalesMinor: analysis?.estimatedAdditionalSalesMinor,
      })
    : false;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Results</p>
          <h1>Measured outcomes, frozen at their financial cutoff</h1>
          <p className={styles.lede}>
            Only the immutable final snapshot can show a monetary result. Live
            projections never overwrite it.
          </p>
        </div>
      </header>
      {actionResult ? (
        <div
          className={
            actionResult.ok ? styles.successMessage : styles.errorMessage
          }
          role="status"
        >
          {actionResult.message}
        </div>
      ) : null}
      <section className={styles.section}>
        <Form className={styles.inlineForm} method="get">
          <label>
            Experiment
            <select defaultValue={data.selected?.id ?? ""} name="experimentId">
              {data.experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  {experiment.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.secondaryButton} type="submit">
            Show result
          </button>
        </Form>
      </section>
      {!data.selected ? (
        <section className={styles.section}>
          <h2>No experiment yet</h2>
          <p>
            Pagnetic will show the measurement check and message-test record
            here after a plan starts.
          </p>
          <Link className={styles.primaryButton} to="/app/messages">
            Review messages
          </Link>
        </section>
      ) : data.privacyRestricted ? (
        <section
          className={styles.section}
          aria-labelledby="privacy-result-review-heading"
        >
          <div className={styles.errorMessage} role="status">
            <strong id="privacy-result-review-heading">
              Result withheld for governed privacy review.
            </strong>{" "}
            Serving and result actions are blocked. The immutable evidence
            remains stored unchanged, but Pagnetic will not display or reuse its
            effect or winner claim.
          </div>
          {data.servingContext &&
          data.servingContext.policy !== "ORIGINAL" &&
          data.servingContext.state !== "STOPPED" ? (
            <Form method="post">
              <input name="intent" type="hidden" value="stop" />
              <input
                name="deploymentId"
                type="hidden"
                value={data.servingContext.deploymentId}
              />
              <input
                name="expectedRevision"
                type="hidden"
                value={data.servingContext.revision}
              />
              <input
                name="idempotencyKey"
                type="hidden"
                value={data.servingContext.idempotencyKey}
              />
              <button
                className={styles.dangerButton}
                disabled={busy}
                type="submit"
              >
                Stop and show the original page
              </button>
            </Form>
          ) : (
            <p>
              The affected product is already restricted to Original or stopped.
            </p>
          )}
          <div className={styles.actionRow}>
            <Link className={styles.secondaryButton} to="/app/settings">
              Review serving status
            </Link>
          </div>
        </section>
      ) : data.result ? (
        <>
          {data.reviewNotice ? (
            <section
              className={styles.section}
              aria-labelledby="financial-review-heading"
            >
              <div className={styles.errorMessage} role="status">
                <strong id="financial-review-heading">
                  A later financial update needs Pagnetic review.
                </strong>{" "}
                The frozen test report below has not been silently changed.
                Reference {data.reviewNotice.reference}, detected{" "}
                {data.reviewNotice.detectedAt.slice(0, 16).replace("T", " ")}{" "}
                UTC.
              </div>
            </section>
          ) : null}
          <section
            className={`${styles.section} ${styles.resultHero}`}
            aria-labelledby="result-heading"
          >
            <p className={styles.step}>
              Estimated additional sales during this test
            </p>
            <h2 id="result-heading">
              {data.selected.productTitle}:{" "}
              {data.result.state.replaceAll("_", " ").toLowerCase()}
            </h2>
            {analysis && monetaryResult ? (
              <>
                <strong className={styles.valueFigure}>
                  {formatMinorAmount(
                    analysis.estimatedAdditionalSalesMinor,
                    currency,
                  )}
                </strong>
                <p>
                  {Math.round((analysis.confidenceLevel ?? 0.95) * 100)}%
                  interval per assigned visitor:{" "}
                  {formatMinorAmount(analysis.intervalMinor?.lower, currency)}{" "}
                  to{" "}
                  {formatMinorAmount(analysis.intervalMinor?.upper, currency)}.
                </p>
              </>
            ) : (
              <p>
                No monetary winner claim is available for this result state.
              </p>
            )}
            <div className={styles.resultFacts}>
              <span>{data.selected.testType}</span>
              <span>
                {data.selected.assignments.toLocaleString()} assigned visitors
              </span>
              <span>
                Financial cutoff{" "}
                {data.selected.financialMaturityAt?.slice(0, 10) ??
                  "not recorded"}
              </span>
            </div>
          </section>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.step}>Frozen evidence</p>
                <h2>Scope and integrity</h2>
              </div>
              <small>
                Snapshot {data.result.id.slice(0, 12)} · data{" "}
                {data.result.dataHash.slice(0, 12)}
              </small>
            </div>
            <div className={styles.resultGrid}>
              <article>
                <strong>Control</strong>
                <span>{analysis?.control?.assignments ?? 0} visitors</span>
                <span>
                  {analysis?.control?.paidPurchasers ?? 0} paid purchasers
                </span>
                <span>
                  {formatMinorAmount(
                    analysis?.control?.netRevenueMinor,
                    currency,
                  )}{" "}
                  net focal merchandise
                </span>
              </article>
              <article>
                <strong>Treatment</strong>
                <span>{analysis?.treatment?.assignments ?? 0} visitors</span>
                <span>
                  {analysis?.treatment?.paidPurchasers ?? 0} paid purchasers
                </span>
                <span>
                  {formatMinorAmount(
                    analysis?.treatment?.netRevenueMinor,
                    currency,
                  )}{" "}
                  net focal merchandise
                </span>
              </article>
              <article>
                <strong>Reconciliation</strong>
                <span>
                  {data.result.financial?.reconciledLinkedOrders ?? 0}/
                  {data.result.financial?.linkedEligibleOrders ?? 0} linked
                  orders
                </span>
                <span>
                  {data.result.financial?.contradictoryLinks ?? 0} contradictory
                  links
                </span>
                <span>
                  {data.result.financial?.complete
                    ? "Complete at cutoff"
                    : "Incomplete"}
                </span>
              </article>
            </div>
            {analysis?.reasons?.length ? (
              <ul>
                {analysis.reasons.map((reason) => (
                  <li key={reason}>
                    {reason.replaceAll("_", " ").toLowerCase()}
                  </li>
                ))}
              </ul>
            ) : null}
            <details>
              <summary>Full immutable report</summary>
              <pre className={styles.reportText}>
                {data.result.reportMarkdown}
              </pre>
            </details>
          </section>
          <section className={styles.section}>
            <p className={styles.step}>Next decision</p>
            <h2>Choose what happens next</h2>
            <p>
              Every action is tenant-scoped, idempotent and recorded. The frozen
              report remains unchanged.
            </p>
            {data.actionContext?.resultState === "POSITIVE" &&
            !data.actionContext.measurementCheck ? (
              data.actionContext.entitled &&
              data.actionContext.contentVersionId ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="keep" />
                  <input
                    name="resultSnapshotId"
                    type="hidden"
                    value={data.actionContext.snapshotId}
                  />
                  <input
                    name="contentVersionId"
                    type="hidden"
                    value={data.actionContext.contentVersionId}
                  />
                  <input
                    name="expectedRevision"
                    type="hidden"
                    value={data.actionContext.currentRevision}
                  />
                  <input
                    name="idempotencyKey"
                    type="hidden"
                    value={`${data.actionContext.idempotencyBase}-keep`}
                  />
                  <button
                    className={styles.primaryButton}
                    disabled={busy}
                    type="submit"
                  >
                    Keep the tested message
                  </button>
                </Form>
              ) : (
                <p>
                  Keeping a winner is unavailable until an active Shopify
                  subscription is verified.
                </p>
              )
            ) : null}
            {!data.actionContext?.measurementCheck ? (
              <Form method="post">
                <input name="intent" type="hidden" value="revise" />
                <input
                  name="resultSnapshotId"
                  type="hidden"
                  value={data.actionContext?.snapshotId ?? ""}
                />
                <input
                  name="idempotencyKey"
                  type="hidden"
                  value={`${data.actionContext?.idempotencyBase ?? "result"}-revise`}
                />
                <label>
                  Reason for revising
                  <textarea
                    name="reason"
                    required
                    minLength={10}
                    maxLength={500}
                    defaultValue="Create a materially different source-backed message for the next registered test."
                  />
                </label>
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  type="submit"
                >
                  Create a new draft
                </button>
              </Form>
            ) : (
              <p>
                This was a measurement check. Repair measurement health before
                creating a message-test result action.
              </p>
            )}
            {data.actionContext?.currentDeploymentId &&
            data.actionContext.currentPolicy !== "ORIGINAL" &&
            data.actionContext.currentState !== "STOPPED" ? (
              <Form method="post">
                <input name="intent" type="hidden" value="stop" />
                <input
                  name="resultSnapshotId"
                  type="hidden"
                  value={data.actionContext.snapshotId}
                />
                <input
                  name="deploymentId"
                  type="hidden"
                  value={data.actionContext.currentDeploymentId}
                />
                <input
                  name="expectedRevision"
                  type="hidden"
                  value={data.actionContext.currentRevision}
                />
                <input
                  name="idempotencyKey"
                  type="hidden"
                  value={`${data.actionContext.idempotencyBase}-stop-${data.actionContext.currentRevision}`}
                />
                <button
                  className={styles.dangerButton}
                  disabled={busy}
                  type="submit"
                >
                  Stop and show the original page
                </button>
              </Form>
            ) : null}
            <div className={styles.actionRow}>
              <Link className={styles.secondaryButton} to="/app/settings">
                Review serving status
              </Link>
              <Link className={styles.secondaryButton} to="/app/messages">
                Review another message
              </Link>
            </div>
          </section>
        </>
      ) : (
        <section className={styles.section}>
          <p className={styles.step}>
            {data.selected.status.replaceAll("_", " ")}
          </p>
          <h2>
            {data.selected.enrollmentClosedAt
              ? "Waiting for purchases and refunds to mature"
              : "Collecting the registered cohort"}
          </h2>
          <p>
            {data.selected.assignments.toLocaleString()}
            {data.selected.target
              ? ` of ${data.selected.target.toLocaleString()}`
              : ""}{" "}
            assigned visitors. Early movement is intentionally hidden.
          </p>
          <div className={styles.resultFacts}>
            <span>
              Enrollment began {data.selected.enrollmentStartedAt.slice(0, 10)}
            </span>
            <span>
              Attribution closes{" "}
              {data.selected.attributionClosesAt?.slice(0, 10) ??
                "after enrollment"}
            </span>
            <span>
              Financial cutoff{" "}
              {data.selected.financialMaturityAt?.slice(0, 10) ??
                "after attribution"}
            </span>
          </div>
        </section>
      )}
    </main>
  );
}

export default function Results() {
  const data = useLoaderData<typeof loader>();
  const actionResult = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return <ResultsView {...{ data, actionResult, busy }} />;
}

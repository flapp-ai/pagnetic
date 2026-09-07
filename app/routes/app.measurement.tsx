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
  loadExperimentReport,
  snapshotExperimentReport,
} from "../services/experiment-report.server";
import { ensureMerchant } from "../services/governance.server";
import {
  ensureCurrentPixelEndpoint,
  recoverRecentOrders,
} from "../services/measurement-reliability.server";
import {
  activateWebPixel,
  registerExperiment,
} from "../services/measurement.server";
import { publicAppOrigin } from "../services/public-origin.server";
import { authenticateAdmin } from "../shopify.server";
import styles from "../styles/governance.module.css";

const graphqlAdapter =
  (admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  }) =>
  (query: string, options?: { variables?: Record<string, unknown> }) =>
    admin.graphql(query, options);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  await ensurePilotRole({ db: prisma, merchantId: merchant.id, actor });
  const desiredEndpoint = `${publicAppOrigin(request)}/storefront/events`;
  const automationMessages: string[] = [];

  try {
    const result = await ensureCurrentPixelEndpoint({
      db: prisma,
      merchantId: merchant.id,
      shop: session.shop,
      endpoint: desiredEndpoint,
      graphql: graphqlAdapter(admin),
    });
    if (result.changed)
      automationMessages.push(
        "Web Pixel endpoint reconnected to the current app URL.",
      );
  } catch (error) {
    automationMessages.push(
      `Pixel check needs attention: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const previousSync = await prisma.measurementSyncState.findUnique({
    where: { merchantId: merchant.id },
  });
  const syncIsStale =
    !previousSync?.lastSuccessfulAt ||
    Date.now() - previousSync.lastSuccessfulAt.getTime() > 15 * 60 * 1000;
  if (syncIsStale) {
    try {
      const result = await recoverRecentOrders({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        graphql: graphqlAdapter(admin),
      });
      automationMessages.push(
        `Order recovery is current; ${result.recoveredOrderCount} cumulative order record(s) checked.`,
      );
    } catch (error) {
      automationMessages.push(
        `Order recovery needs attention: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const [
    products,
    experimentRows,
    eventCounts,
    orderCount,
    attributedOrderCount,
    pixel,
    sync,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { merchantId: merchant.id, status: "ACTIVE" },
      orderBy: { title: "asc" },
    }),
    prisma.experiment.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.commerceEvent.groupBy({
      by: ["eventType"],
      where: { merchantId: merchant.id },
      _count: { _all: true },
    }),
    prisma.storeOrder.count({ where: { merchantId: merchant.id } }),
    prisma.orderAttribution.count({ where: { merchantId: merchant.id } }),
    prisma.pixelCredential.findUnique({ where: { merchantId: merchant.id } }),
    prisma.measurementSyncState.findUnique({
      where: { merchantId: merchant.id },
    }),
  ]);

  const reports = await Promise.all(
    experimentRows.map(async ({ id }) => {
      try {
        return await loadExperimentReport({
          db: prisma,
          merchantId: merchant.id,
          experimentId: id,
        });
      } catch {
        return null;
      }
    }),
  );

  return {
    shop: session.shop,
    automationMessages,
    products: products.map((product) => ({
      id: product.id,
      title: product.title,
    })),
    pixel: pixel
      ? {
          status: pixel.status,
          endpoint: pixel.endpoint,
          webPixelId: pixel.webPixelId,
          activatedAt: pixel.activatedAt.toISOString(),
        }
      : null,
    sync: sync
      ? {
          status: sync.status,
          lastSuccessfulAt: sync.lastSuccessfulAt?.toISOString() ?? null,
          recoveredOrderCount: sync.recoveredOrderCount,
          lastError: sync.lastError,
        }
      : null,
    eventCounts: eventCounts.map((entry) => ({
      type: entry.eventType,
      count: entry._count._all,
    })),
    orderCount,
    attributedOrderCount,
    experiments: reports
      .filter((report): report is NonNullable<typeof report> => report != null)
      .map((report) => ({
        id: report.experiment.id,
        key: report.experiment.key,
        version: report.experiment.version,
        status: report.experiment.status,
        product: report.experiment.product.title,
        controlPercentage: report.experiment.controlPercentage,
        controlPolicy: report.experiment.controlPolicy,
        treatmentPolicy: report.experiment.treatmentPolicy,
        testType:
          report.experiment.controlPolicy === report.experiment.treatmentPolicy
            ? "A/A validation"
            : report.experiment.controlPolicy === "ORIGINAL" &&
                report.experiment.treatmentPolicy === "UNIVERSAL"
              ? "Stage 1: original vs universal"
              : report.experiment.controlPolicy === "UNIVERSAL" &&
                  report.experiment.treatmentPolicy === "MATCHED"
                ? "Stage 2: universal vs matched"
                : "Registered comparison",
        registrationHash: report.registration.registrationHash,
        protocolVersion: report.registration.protocolVersion,
        targetSampleSize: report.registration.targetSampleSize,
        minimumDurationDays: report.registration.minimumDurationDays,
        revenueDefinition: report.registration.revenueDefinition,
        checks: report.checks,
        readiness: report.readiness,
        analysis: {
          ...report.analysis,
          dataMaturityAt: report.analysis.dataMaturityAt.toISOString(),
        },
      })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  try {
    if (intent === "register-experiment") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      const mode = String(formData.get("experimentMode") ?? "AA");
      const policies =
        mode === "STAGE1"
          ? {
              controlPolicy: "ORIGINAL" as const,
              treatmentPolicy: "UNIVERSAL" as const,
            }
          : mode === "STAGE2"
            ? {
                controlPolicy: "UNIVERSAL" as const,
                treatmentPolicy: "MATCHED" as const,
              }
            : {
                controlPolicy: "ORIGINAL" as const,
                treatmentPolicy: "ORIGINAL" as const,
              };
      const experiment = await registerExperiment({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        key: String(formData.get("experimentKey") ?? ""),
        controlPercentage: Number(formData.get("controlPercentage") ?? 50),
        ...policies,
        initialStatus: mode === "AA" ? "ACTIVE" : "DRAFT",
        registration: {
          targetSampleSize: Number(formData.get("targetSampleSize") ?? 1000),
          minimumDurationDays: Number(
            formData.get("minimumDurationDays") ?? 14,
          ),
          maximumDurationDays: Number(
            formData.get("maximumDurationDays") ?? 42,
          ),
          revenueDefinition:
            String(formData.get("revenueDefinition") ?? "NET") === "GROSS"
              ? "GROSS"
              : "NET",
        },
      });
      return {
        ok: true,
        message: `${experiment.key} v${experiment.version} is registered with an immutable analysis plan.`,
      };
    }
    if (intent === "activate-pixel") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const endpoint = `${publicAppOrigin(request)}/storefront/events`;
      await activateWebPixel({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        endpoint,
        graphql: graphqlAdapter(admin),
      });
      return {
        ok: true,
        message: "Shopify Web Pixel reconnected with a rotated credential.",
      };
    }
    if (intent === "recover-orders") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const state = await recoverRecentOrders({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        graphql: graphqlAdapter(admin),
      });
      return {
        ok: true,
        message: `Order recovery completed; ${state.recoveredOrderCount} cumulative records checked idempotently.`,
      };
    }
    if (intent === "snapshot-report") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const snapshot = await snapshotExperimentReport({
        db: prisma,
        merchantId: merchant.id,
        experimentId: String(formData.get("experimentId") ?? ""),
      });
      return {
        ok: true,
        message: `Immutable ${snapshot.resultState.toLowerCase()} report snapshot saved.`,
      };
    }
    if (intent === "pause-experiment") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await prisma.experiment.updateMany({
        where: {
          id: String(formData.get("experimentId") ?? ""),
          merchantId: merchant.id,
          status: "ACTIVE",
        },
        data: { status: "PAUSED", endedAt: new Date() },
      });
      return {
        ok: true,
        message:
          "New assignments are paused; historical records remain immutable.",
      };
    }
    return { ok: false, message: "Unknown measurement action." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The action could not be completed.",
    };
  }
};

function percent(value: number | null) {
  return value == null ? "Not estimable" : `${(value * 100).toFixed(2)}%`;
}

export default function MeasurementWorkspace() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const assignments = data.experiments.reduce(
    (sum, item) =>
      sum +
      item.analysis.control.assignments +
      item.analysis.treatment.assignments,
    0,
  );
  const events = data.eventCounts.reduce((sum, item) => sum + item.count, 0);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} to="/app">
            ← Pagnetic
          </Link>
          <p className={styles.eyebrow}>Milestone 3</p>
          <h1>Causal measurement</h1>
          <p className={styles.lede}>
            Recover orders, freeze analysis plans, monitor data quality, and
            produce decision-grade experiment reports.
          </p>
        </div>
        <div className={styles.actionRow}>
          <Form method="post">
            <input name="intent" type="hidden" value="recover-orders" />
            <button
              className={styles.secondaryButton}
              disabled={busy}
              type="submit"
            >
              Recover orders
            </button>
          </Form>
          <Form method="post">
            <input name="intent" type="hidden" value="activate-pixel" />
            <button
              className={styles.primaryButton}
              disabled={busy}
              type="submit"
            >
              Reconnect pixel
            </button>
          </Form>
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
      {data.automationMessages.length ? (
        <div className={styles.automationMessage} role="status">
          {data.automationMessages.join(" ")}
        </div>
      ) : null}

      <section className={styles.metrics} aria-label="Measurement status">
        <article>
          <strong>{assignments}</strong>
          <span>sticky assignments</span>
        </article>
        <article>
          <strong>{events}</strong>
          <span>idempotent pixel events</span>
        </article>
        <article>
          <strong>{data.orderCount}</strong>
          <span>reconciled orders</span>
        </article>
        <article>
          <strong>{data.attributedOrderCount}</strong>
          <span>decision-to-order joins</span>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 1</p>
            <h2>Register a frozen experiment</h2>
          </div>
          <p>
            A/A launches immediately. Pilot Stage 1 and Stage 2 remain drafts
            until operational readiness passes.
          </p>
        </div>
        <Form className={styles.registrationForm} method="post">
          <input name="intent" type="hidden" value="register-experiment" />
          <label>
            Product
            <select name="productId" required>
              {data.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Experiment ID
            <input
              defaultValue="instrumentation-aa-v0"
              name="experimentKey"
              required
            />
          </label>
          <label>
            Test type
            <select defaultValue="AA" name="experimentMode">
              <option value="AA">A/A instrumentation</option>
              <option value="STAGE1">Stage 1: original vs universal</option>
              <option value="STAGE2">Stage 2: universal vs matched</option>
            </select>
          </label>
          <label>
            Control %
            <input
              defaultValue="50"
              max="100"
              min="0"
              name="controlPercentage"
              required
              type="number"
            />
          </label>
          <label>
            Target sessions
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
              min="1"
              name="minimumDurationDays"
              required
              type="number"
            />
          </label>
          <label>
            Maximum days
            <input
              defaultValue="42"
              min="1"
              name="maximumDurationDays"
              required
              type="number"
            />
          </label>
          <label>
            Revenue
            <select defaultValue="NET" name="revenueDefinition">
              <option value="NET">Net revenue</option>
              <option value="GROSS">Gross revenue</option>
            </select>
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy || !data.products.length}
            type="submit"
          >
            Freeze registration
          </button>
        </Form>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 2</p>
            <h2>Analysis and data quality</h2>
          </div>
          <p>
            All estimates are intent-to-treat and preliminary until the
            registered sample, duration, and maturity rules pass.
          </p>
        </div>
        {data.experiments.length ? (
          <div className={styles.versionList}>
            {data.experiments.map((experiment) => (
              <article className={styles.versionCard} key={experiment.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.muted}>
                      {experiment.product} · v{experiment.version} ·{" "}
                      {experiment.protocolVersion}
                    </p>
                    <h3>{experiment.key}</h3>
                  </div>
                  <div className={styles.badgeGroup}>
                    <span className={styles.statusBadge}>
                      {experiment.testType}
                    </span>
                    <span
                      className={styles.statusBadge}
                      data-status={experiment.readiness}
                    >
                      {experiment.readiness}
                    </span>
                    <span
                      className={styles.statusBadge}
                      data-status={experiment.analysis.resultState}
                    >
                      {experiment.analysis.resultState}
                    </span>
                    <span className={styles.statusBadge}>
                      {experiment.status}
                    </span>
                  </div>
                </div>
                <div className={styles.analysisGrid}>
                  <div>
                    <span>Arm A · {experiment.controlPolicy}</span>
                    <strong>
                      {experiment.analysis.control.revenuePerSession.toFixed(2)}
                    </strong>
                    <small>
                      RPS · {experiment.analysis.control.sessions} sessions ·{" "}
                      {experiment.analysis.control.orders} orders
                    </small>
                  </div>
                  <div>
                    <span>Arm B · {experiment.treatmentPolicy}</span>
                    <strong>
                      {experiment.analysis.treatment.revenuePerSession.toFixed(
                        2,
                      )}
                    </strong>
                    <small>
                      RPS · {experiment.analysis.treatment.sessions} sessions ·{" "}
                      {experiment.analysis.treatment.orders} orders
                    </small>
                  </div>
                  <div>
                    <span>Relative lift</span>
                    <strong>{percent(experiment.analysis.relativeLift)}</strong>
                    <small>
                      Absolute {experiment.analysis.absoluteLift.toFixed(2)} ·
                      interval {experiment.analysis.interval.lower.toFixed(2)}{" "}
                      to {experiment.analysis.interval.upper.toFixed(2)}
                    </small>
                  </div>
                  <div>
                    <span>Registered progress</span>
                    <strong>
                      {experiment.analysis.control.sessions +
                        experiment.analysis.treatment.sessions}
                      /{experiment.targetSampleSize}
                    </strong>
                    <small>
                      {experiment.analysis.durationDays.toFixed(1)}/
                      {experiment.minimumDurationDays} minimum days ·{" "}
                      {experiment.revenueDefinition.toLowerCase()} revenue
                    </small>
                  </div>
                </div>
                <div
                  className={styles.healthGrid}
                  aria-label={`${experiment.key} readiness checks`}
                >
                  {experiment.checks.map((check) => (
                    <div
                      className={styles.healthCheck}
                      data-status={check.status}
                      key={check.key}
                    >
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.status}</span>
                      </div>
                      <b>{check.value}</b>
                      <p>{check.detail}</p>
                    </div>
                  ))}
                </div>
                {experiment.analysis.reasons.length ? (
                  <ul className={styles.findings}>
                    {experiment.analysis.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
                <div className={styles.actionRow}>
                  <a
                    className={styles.secondaryLink}
                    href={`/app/measurement/report/${experiment.id}`}
                  >
                    Download live report
                  </a>
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="snapshot-report"
                    />
                    <input
                      name="experimentId"
                      type="hidden"
                      value={experiment.id}
                    />
                    <button
                      className={styles.secondaryButton}
                      disabled={busy}
                      type="submit"
                    >
                      Save immutable snapshot
                    </button>
                  </Form>
                  {experiment.status === "ACTIVE" ? (
                    <Form method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="pause-experiment"
                      />
                      <input
                        name="experimentId"
                        type="hidden"
                        value={experiment.id}
                      />
                      <button
                        className={styles.secondaryButton}
                        disabled={busy}
                        type="submit"
                      >
                        Pause assignments
                      </button>
                    </Form>
                  ) : null}
                </div>
                <details>
                  <summary>Frozen registration</summary>
                  <p className={styles.monoText}>
                    {experiment.registrationHash}
                  </p>
                  <p>
                    Data maturity:{" "}
                    {new Date(
                      experiment.analysis.dataMaturityAt,
                    ).toLocaleString()}
                  </p>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>No registered experiment</h3>
            <p>
              Register one before switching the storefront block to Experiment
              mode.
            </p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Reliability</p>
            <h2>Event and recovery state</h2>
          </div>
          <p>
            {data.sync
              ? `${data.sync.status} · last success ${data.sync.lastSuccessfulAt ? new Date(data.sync.lastSuccessfulAt).toLocaleString() : "pending"}`
              : "Order recovery not initialized"}
          </p>
        </div>
        <div className={styles.mappingList}>
          {data.eventCounts.map((event) => (
            <div key={event.type}>
              <code>{event.type}</code>
              <span>{event.count}</span>
            </div>
          ))}
        </div>
        {data.sync?.lastError ? (
          <p className={styles.errorMessage}>{data.sync.lastError}</p>
        ) : null}
      </section>
    </main>
  );
}

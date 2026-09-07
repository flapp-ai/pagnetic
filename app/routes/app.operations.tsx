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
import { decryptField } from "../services/field-encryption.server";
import { runMerchantAutomation } from "../services/automation.server";
import { ensureMerchant } from "../services/governance.server";
import {
  evaluateExperimentSafety,
  recordConfounder,
  recordIncident,
  resolveIncident,
  setMerchantKillSwitch,
} from "../services/pilot-operations.server";
import { assessPilotLaunchReadiness } from "../services/pilot-readiness";
import { productionEnvironmentStatus } from "../services/pilot-setup.server";
import { privacyHash } from "../services/privacy.server";
import { privacyLookupKeys } from "../services/privacy-lookup-keys.server";
import { customerPrivacyRequestSummary } from "../services/customer-privacy-queue.server";
import { authenticateAdmin } from "../shopify.server";
import styles from "../styles/governance.module.css";

async function launchReadiness(merchantId: string, experimentId: string) {
  const [
    experiment,
    pixel,
    control,
    aaValidated,
    stageOnePositive,
    activeMappings,
    pilotSettings,
    brandProfile,
  ] = await Promise.all([
    prisma.experiment.findFirst({
      where: { id: experimentId, merchantId },
      include: {
        product: {
          include: {
            experiences: { include: { angle: true } },
            qualification: true,
            themeActivation: true,
            qaChecks: true,
          },
        },
        registration: true,
      },
    }),
    prisma.pixelCredential.findUnique({ where: { merchantId } }),
    prisma.runtimeControl.findUnique({ where: { merchantId } }),
    prisma.experimentResultSnapshot.count({
      where: {
        experiment: {
          merchantId,
          controlPolicy: "ORIGINAL",
          treatmentPolicy: "ORIGINAL",
        },
        resultState: "VALIDATED",
      },
    }),
    prisma.experimentResultSnapshot.count({
      where: {
        experiment: {
          merchantId,
          controlPolicy: "ORIGINAL",
          treatmentPolicy: "UNIVERSAL",
        },
        resultState: "POSITIVE",
      },
    }),
    prisma.campaignMapping.findMany({
      where: { merchantId, status: "ACTIVE" },
      select: { id: true, version: true, signature: true },
    }),
    prisma.pilotSettings.findUnique({ where: { merchantId } }),
    prisma.brandProfile.findUnique({ where: { merchantId } }),
  ]);
  if (!experiment) throw new Error("Select a valid pilot experiment.");
  const approved = experiment.product.experiences.filter(
    (experience) => experience.status === "APPROVED_ACTIVE",
  );
  const contact = decryptField<Record<string, unknown>>(
    pilotSettings?.incidentContactJson,
  );
  const incidentContactConfigured = Boolean(contact?.name && contact?.email);
  const environment = productionEnvironmentStatus();
  const requiresUniversal =
    experiment.controlPolicy === "UNIVERSAL" ||
    experiment.treatmentPolicy === "UNIVERSAL";
  const requiresMatched =
    experiment.controlPolicy === "MATCHED" ||
    experiment.treatmentPolicy === "MATCHED";
  let frozenConfigurationCurrent = Boolean(experiment.registration);
  if (experiment.registration && (requiresUniversal || requiresMatched)) {
    try {
      const frozenContent = JSON.parse(
        experiment.registration.contentVersionsJson,
      ) as Array<{
        id: string;
        contentHash: string;
        angle?: { key?: string } | null;
      }>;
      const relevant = (angleKey: string | undefined) =>
        (requiresUniversal && angleKey === "universal") ||
        (requiresMatched && Boolean(angleKey && angleKey !== "universal"));
      const frozenSet = new Set(
        frozenContent
          .filter((item) => relevant(item.angle?.key))
          .map((item) => `${item.id}:${item.contentHash}`),
      );
      const currentSet = new Set(
        approved
          .filter((item) => relevant(item.angle?.key))
          .map((item) => `${item.id}:${item.contentHash}`),
      );
      frozenConfigurationCurrent =
        frozenSet.size === currentSet.size &&
        [...frozenSet].every((item) => currentSet.has(item));
      if (requiresMatched) {
        const frozenMappings = JSON.parse(
          experiment.registration.mappingVersionsJson,
        ) as Array<{ id: string; version: number; signature: string }>;
        const frozenMappingSet = new Set(
          frozenMappings.map(
            (item) => `${item.id}:${item.version}:${item.signature}`,
          ),
        );
        const currentMappingSet = new Set(
          activeMappings.map(
            (item) => `${item.id}:${item.version}:${item.signature}`,
          ),
        );
        frozenConfigurationCurrent =
          frozenConfigurationCurrent &&
          frozenMappingSet.size === currentMappingSet.size &&
          [...frozenMappingSet].every((item) => currentMappingSet.has(item));
      }
    } catch {
      frozenConfigurationCurrent = false;
    }
  }
  const readiness = assessPilotLaunchReadiness({
    hasRegistration: Boolean(experiment.registration),
    brandProfileApproved: brandProfile?.status === "APPROVED",
    pixelActive: pixel?.status === "ACTIVE",
    killSwitchActive: control?.killSwitch === true,
    productQualified:
      experiment.product.qualification?.status === "READY" ||
      Boolean(experiment.product.qualification?.overriddenAt),
    themeActive:
      experiment.product.themeActivation?.activeOnPublishedTheme === true,
    qaComplete:
      experiment.product.qaChecks.filter((check) => check.status === "PASSED")
        .length >= 9,
    incidentContactConfigured,
    productionEnvironmentReady: Object.values(environment).every(Boolean),
    frozenConfigurationCurrent,
    requiresAaValidation:
      experiment.controlPolicy !== experiment.treatmentPolicy,
    requiresUniversal,
    universalApproved: approved.some(
      (experience) => experience.angle?.key === "universal",
    ),
    requiresMatched,
    matchedApprovedCount: new Set(
      approved
        .filter((experience) => experience.angle?.key !== "universal")
        .map((experience) => experience.angleId),
    ).size,
    activeMappings: activeMappings.length,
    aaValidated: aaValidated > 0,
    stageOnePositive: stageOnePositive > 0,
  });
  return { experiment, readiness };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const currentRole = await ensurePilotRole({
    db: prisma,
    merchantId: merchant.id,
    actor,
  });
  const shopHashes = privacyLookupKeys().secrets.map((key) => privacyHash(key, session.shop));
  const [
    control,
    experiments,
    incidents,
    confounders,
    evaluations,
    privacyRequests,
    alerts,
    automationRuns,
  ] = await Promise.all([
    prisma.runtimeControl.findUnique({ where: { merchantId: merchant.id } }),
    prisma.experiment.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      include: { product: true, registration: true },
    }),
    prisma.incident.findMany({
      where: { merchantId: merchant.id },
      orderBy: { detectedAt: "desc" },
      take: 30,
    }),
    prisma.confounder.findMany({
      where: { merchantId: merchant.id },
      orderBy: { occurredAt: "desc" },
      take: 30,
      include: { experiment: true },
    }),
    prisma.safetyEvaluation.findMany({
      where: { merchantId: merchant.id },
      orderBy: { evaluatedAt: "desc" },
      take: 20,
      include: { experiment: true },
    }),
    prisma.privacyRequest.findMany({
      where: { shopHash: { in: shopHashes } },
      orderBy: { requestedAt: "desc" },
      take: 20,
      select: { id: true, requestType: true, status: true, requestedAt: true, completedAt: true, dueAt: true },
    }),
    prisma.operationalAlert.findMany({
      where: { merchantId: merchant.id },
      orderBy: { openedAt: "desc" },
      take: 30,
    }),
    prisma.automationRun.findMany({
      where: { merchantId: merchant.id },
      orderBy: { startedAt: "desc" },
      take: 20,
    }),
  ]);
  const readiness = await Promise.all(
    experiments.map(async (experiment) => {
      const result = await launchReadiness(merchant.id, experiment.id);
      return { experimentId: experiment.id, ...result.readiness };
    }),
  );
  const [autopilotPlans, autopilotTransitions, autopilotEvents] =
    await Promise.all([
      prisma.autopilotPlan.findMany({
        where: { merchantId: merchant.id },
        orderBy: { updatedAt: "desc" },
        take: 10,
        include: { product: { select: { title: true } } },
      }),
      prisma.autopilotTransition.findMany({
        where: { merchantId: merchant.id },
        orderBy: { occurredAt: "desc" },
        take: 30,
      }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where: {
          merchantId: merchant.id,
          action: {
            in: [
              "autopilot_preparation_started",
              "autopilot_preparation_completed",
              "autopilot_preparation_failed",
              "opportunity_viewed",
              "plan_approved",
              "theme_editor_opened",
              "theme_verified",
              "aa_started",
              "aa_failed",
              "real_experiment_started",
              "experiment_auto_paused",
              "result_ready",
              "result_viewed",
            ],
          },
        },
        _count: { _all: true },
      }),
    ]);
  return {
    currentRole: currentRole?.role ?? "UNASSIGNED",
    control: control
      ? {
          ...control,
          activatedAt: control.activatedAt?.toISOString() ?? null,
          clearedAt: control.clearedAt?.toISOString() ?? null,
          updatedAt: control.updatedAt.toISOString(),
        }
      : null,
    experiments: experiments.map((experiment) => ({
      id: experiment.id,
      key: experiment.key,
      version: experiment.version,
      status: experiment.status,
      product: experiment.product.title,
      policies: `${experiment.controlPolicy} vs ${experiment.treatmentPolicy}`,
      registered: Boolean(experiment.registration),
      readiness: readiness.find((item) => item.experimentId === experiment.id)!,
    })),
    incidents: incidents.map((incident) => ({
      ...incident,
      detectedAt: incident.detectedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    })),
    confounders: confounders.map((item) => ({
      ...item,
      experimentKey: item.experiment.key,
      occurredAt: item.occurredAt.toISOString(),
      recordedAt: item.recordedAt.toISOString(),
    })),
    evaluations: evaluations.map((item) => ({
      ...item,
      experimentKey: item.experiment.key,
      evaluatedAt: item.evaluatedAt.toISOString(),
      metrics: JSON.parse(item.metricsJson) as Record<string, number | null>,
      reasons: JSON.parse(item.reasonsJson) as string[],
    })),
    privacyRequests: privacyRequests.map(customerPrivacyRequestSummary),
    alerts: alerts.map((item) => ({
      ...item,
      openedAt: item.openedAt.toISOString(),
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
    })),
    automationRuns: automationRuns.map((item) => ({
      ...item,
      startedAt: item.startedAt.toISOString(),
      finishedAt: item.finishedAt?.toISOString() ?? null,
    })),
    autopilot: {
      plans: autopilotPlans.map((plan) => ({
        id: plan.id,
        product: plan.product.title,
        version: plan.version,
        state: plan.state,
        updatedAt: plan.updatedAt.toISOString(),
      })),
      transitions: autopilotTransitions.map((transition) => ({
        id: transition.id,
        fromState: transition.fromState,
        toState: transition.toState,
        reasonCode: transition.reasonCode,
        actorType: transition.actorType,
        occurredAt: transition.occurredAt.toISOString(),
      })),
      events: autopilotEvents.map((event) => ({
        action: event.action,
        count: event._count._all,
      })),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actor = actorKey(session.shop, sessionToken.sub);
  try {
    if (intent === "kill-switch-on" || intent === "kill-switch-off") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const active = intent === "kill-switch-on";
      await setMerchantKillSwitch({
        db: prisma,
        merchantId: merchant.id,
        active,
        reason: String(formData.get("reason") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: active
          ? "Kill switch activated; active experiments are paused and storefront traffic receives original."
          : "Kill switch cleared. Experiments remain paused until explicitly relaunched.",
      };
    }
    if (intent === "evaluate-safety") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const result = await evaluateExperimentSafety({
        db: prisma,
        merchantId: merchant.id,
        experimentId: String(formData.get("experimentId") ?? ""),
        actor: "AUTOMATED_GUARDRAIL",
      });
      return {
        ok: true,
        message: `Safety evaluation: ${result.assessment.outcome}${result.rollbackTriggered ? "; automatic rollback applied" : ""}.`,
      };
    }
    if (intent === "run-maintenance") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const result = await runMerchantAutomation({
        db: prisma,
        merchantId: merchant.id,
        shop: session.shop,
        graphql: (query, options) => admin.graphql(query, options),
      });
      return {
        ok: true,
        message: `Maintenance complete: ${result.openAlerts} open alert(s); ${result.evaluations.length} guardrail evaluation(s).`,
      };
    }
    if (intent === "resolve-alert") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await prisma.operationalAlert.updateMany({
        where: {
          id: String(formData.get("alertId") ?? ""),
          merchantId: merchant.id,
          status: "OPEN",
        },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      return { ok: true, message: "Operational alert resolved." };
    }
    if (intent === "record-incident") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const incident = await recordIncident({
        db: prisma,
        merchantId: merchant.id,
        experimentId: String(formData.get("experimentId") ?? "") || null,
        severity: String(formData.get("severity") ?? ""),
        category: String(formData.get("category") ?? ""),
        summary: String(formData.get("summary") ?? ""),
        actor,
      });
      if (incident.severity === "SEV1") {
        await setMerchantKillSwitch({
          db: prisma,
          merchantId: merchant.id,
          active: true,
          reason: `Severity 1 incident: ${incident.summary}`,
          actor,
        });
      }
      return {
        ok: true,
        message: `${incident.severity} incident recorded${incident.severity === "SEV1" ? " and kill switch activated" : ""}.`,
      };
    }
    if (intent === "resolve-incident") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await resolveIncident({
        db: prisma,
        merchantId: merchant.id,
        incidentId: String(formData.get("incidentId") ?? ""),
      });
      return {
        ok: true,
        message:
          "Incident resolved. Clear the kill switch separately after verifying recovery.",
      };
    }
    if (intent === "record-confounder") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await recordConfounder({
        db: prisma,
        merchantId: merchant.id,
        experimentId: String(formData.get("experimentId") ?? ""),
        eventType: String(formData.get("eventType") ?? ""),
        materiality: String(formData.get("materiality") ?? ""),
        summary: String(formData.get("summary") ?? ""),
        occurredAt: new Date(String(formData.get("occurredAt") ?? "")),
        actor,
      });
      return {
        ok: true,
        message: "Confounder appended to the immutable experiment record.",
      };
    }
    if (intent === "launch-experiment") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      const experimentId = String(formData.get("experimentId") ?? "");
      const { experiment, readiness } = await launchReadiness(
        merchant.id,
        experimentId,
      );
      const blockers = readiness.checks.filter((check) => !check.passed);
      if (blockers.length)
        throw new Error(
          `Launch blocked: ${blockers.map((check) => check.label).join(", ")}.`,
        );
      await prisma.$transaction([
        prisma.experiment.updateMany({
          where: {
            merchantId: merchant.id,
            productId: experiment.productId,
            status: "ACTIVE",
            id: { not: experiment.id },
          },
          data: { status: "PAUSED", endedAt: new Date() },
        }),
        prisma.experiment.update({
          where: { id: experiment.id },
          data: { status: "ACTIVE", startedAt: new Date(), endedAt: null },
        }),
        prisma.auditLog.create({
          data: {
            merchantId: merchant.id,
            actor,
            action: "PILOT_EXPERIMENT_LAUNCHED",
            resourceType: "Experiment",
            resourceId: experiment.id,
            detailsJson: JSON.stringify({
              registrationHash: experiment.registration?.registrationHash,
            }),
          },
        }),
      ]);
      return {
        ok: true,
        message: `${experiment.key} launched; competing active experiments on the product were paused.`,
      };
    }
    return { ok: false, message: "Unknown pilot operation." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "The operation could not be completed.",
    };
  }
};

export default function PilotOperations() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const killSwitch = data.control?.killSwitch === true;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} to="/app">
            ← Pagnetic
          </Link>
          <p className={styles.eyebrow}>Milestone 4 · {data.currentRole}</p>
          <h1>Pilot operations</h1>
          <p className={styles.lede}>
            Launch only registered experiments, keep an operational record, and
            force the original storefront when a guardrail fails.
          </p>
        </div>
        <span
          className={styles.statusBadge}
          data-status={killSwitch ? "HOLD" : "READY"}
        >
          {killSwitch ? "KILL SWITCH ACTIVE" : "RUNTIME ENABLED"}
        </span>
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

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Autopilot funnel</p>
            <h2>Activation and exceptions</h2>
          </div>
          <p>Merchant-scoped transition evidence with no customer PII.</p>
        </div>
        <div className={styles.metrics}>
          <article>
            <strong>{data.autopilot.plans.length}</strong>
            <span>plan versions</span>
          </article>
          <article>
            <strong>{data.autopilot.transitions.length}</strong>
            <span>recorded transitions</span>
          </article>
          <article>
            <strong>{data.autopilot.events.find((item) => item.action === "plan_approved")?.count ?? 0}</strong>
            <span>approvals</span>
          </article>
          <article>
            <strong>{data.autopilot.events.find((item) => item.action === "result_ready")?.count ?? 0}</strong>
            <span>mature results</span>
          </article>
        </div>
        <ul className={styles.auditList}>
          {data.autopilot.transitions.slice(0, 8).map((transition) => (
            <li key={transition.id}>
              <span>
                <strong>{transition.fromState} → {transition.toState}</strong>
                <br />{transition.reasonCode.replaceAll("_", " ")}
              </span>
              <span>{transition.actorType}</span>
              <time>{new Date(transition.occurredAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Safety boundary</p>
            <h2>Merchant kill switch</h2>
          </div>
          <p>
            Activation immediately pauses every active experiment. Clearing it
            never silently restarts an experiment.
          </p>
        </div>
        {killSwitch ? (
          <Form method="post">
            <input name="intent" type="hidden" value="kill-switch-off" />
            <button
              className={styles.primaryButton}
              disabled={busy}
              type="submit"
            >
              Clear kill switch
            </button>
          </Form>
        ) : (
          <Form className={styles.inlineForm} method="post">
            <input name="intent" type="hidden" value="kill-switch-on" />
            <label>
              Reason
              <input
                name="reason"
                placeholder="Operational or safety reason"
                required
              />
            </label>
            <button
              className={styles.dangerButton}
              disabled={busy}
              type="submit"
            >
              Serve original now
            </button>
          </Form>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Launch gate</p>
            <h2>Registered pilot stages</h2>
          </div>
          <p>
            Stage 1 and Stage 2 cannot launch until every protocol dependency
            passes.
          </p>
        </div>
        <div className={styles.versionList}>
          {data.experiments.map((experiment) => (
            <article className={styles.versionCard} key={experiment.id}>
              <div className={styles.cardHeader}>
                <div>
                  <p className={styles.muted}>
                    {experiment.product} · v{experiment.version}
                  </p>
                  <h3>{experiment.key}</h3>
                  <p>{experiment.policies}</p>
                </div>
                <div className={styles.badgeGroup}>
                  <span
                    className={styles.statusBadge}
                    data-status={experiment.readiness.ready ? "READY" : "HOLD"}
                  >
                    {experiment.readiness.ready ? "READY" : "BLOCKED"}
                  </span>
                  <span className={styles.statusBadge}>
                    {experiment.status}
                  </span>
                </div>
              </div>
              <div className={styles.readinessList}>
                {experiment.readiness.checks.map((check) => (
                  <div data-passed={check.passed} key={check.key}>
                    <strong>
                      {check.passed ? "✓" : "×"} {check.label}
                    </strong>
                    <span>{check.detail}</span>
                  </div>
                ))}
              </div>
              <div className={styles.actionRow}>
                <Form method="post">
                  <input name="intent" type="hidden" value="evaluate-safety" />
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
                    Evaluate guardrails
                  </button>
                </Form>
                {experiment.status === "DRAFT" ? (
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="launch-experiment"
                    />
                    <input
                      name="experimentId"
                      type="hidden"
                      value={experiment.id}
                    />
                    <button
                      className={styles.primaryButton}
                      disabled={busy || !experiment.readiness.ready}
                      type="submit"
                    >
                      Launch registered stage
                    </button>
                  </Form>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Incident workflow</p>
            <h2>Record operational incidents</h2>
          </div>
          <p>
            A Severity 1 incident automatically activates the merchant kill
            switch.
          </p>
        </div>
        <Form className={styles.registrationForm} method="post">
          <input name="intent" type="hidden" value="record-incident" />
          <label>
            Experiment
            <select name="experimentId">
              <option value="">Store-wide</option>
              {data.experiments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select name="severity">
              <option value="SEV2">Severity 2</option>
              <option value="SEV1">Severity 1</option>
              <option value="SEV3">Severity 3</option>
            </select>
          </label>
          <label>
            Category
            <input defaultValue="RUNTIME" name="category" required />
          </label>
          <label className={styles.wideField}>
            Summary
            <input name="summary" required />
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy}
            type="submit"
          >
            Record incident
          </button>
        </Form>
        <ul className={styles.auditList}>
          {data.incidents.map((incident) => (
            <li key={incident.id}>
              <span>
                <strong>
                  {incident.severity} · {incident.category}
                </strong>
                <br />
                {incident.summary}
              </span>
              <time>{new Date(incident.detectedAt).toLocaleString()}</time>
              {incident.status === "OPEN" ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="resolve-incident" />
                  <input name="incidentId" type="hidden" value={incident.id} />
                  <button
                    className={styles.textButton}
                    disabled={busy}
                    type="submit"
                  >
                    Resolve
                  </button>
                </Form>
              ) : (
                <span>Resolved</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Confounder log</p>
            <h2>Record experiment changes</h2>
          </div>
          <p>
            Price, inventory, campaign, theme, promotion, and checkout changes
            remain attached to the analysis record.
          </p>
        </div>
        <Form className={styles.registrationForm} method="post">
          <input name="intent" type="hidden" value="record-confounder" />
          <label>
            Experiment
            <select name="experimentId" required>
              {data.experiments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.key}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="eventType">
              <option value="PRICE">Price</option>
              <option value="INVENTORY">Inventory</option>
              <option value="CAMPAIGN">Campaign</option>
              <option value="THEME">Theme</option>
              <option value="PROMOTION">Promotion</option>
              <option value="CHECKOUT">Checkout</option>
              <option value="OUTAGE">Outage</option>
            </select>
          </label>
          <label>
            Materiality
            <select name="materiality">
              <option value="IMMATERIAL">Immaterial</option>
              <option value="MODEL_ADJUSTABLE">Model-adjustable</option>
              <option value="INVALIDATING">Invalidating</option>
            </select>
          </label>
          <label>
            Occurred at
            <input name="occurredAt" required type="datetime-local" />
          </label>
          <label className={styles.wideField}>
            Summary
            <input name="summary" required />
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy}
            type="submit"
          >
            Append record
          </button>
        </Form>
        <ul className={styles.auditList}>
          {data.confounders.map((item) => (
            <li key={item.id}>
              <span>
                <strong>
                  {item.experimentKey} · {item.eventType}
                </strong>
                <br />
                {item.summary}
              </span>
              <span>{item.materiality}</span>
              <time>{new Date(item.occurredAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Compliance</p>
            <h2>Privacy deletion workflow</h2>
          </div>
          <p>
            Received requests are not necessarily fulfilled. Customer order scope
            is encrypted server-side; deletion, data delivery and retained backups
            require separate verification.
          </p>
        </div>
        {data.privacyRequests.length ? (
          <ul className={styles.auditList}>
            {data.privacyRequests.map((item) => (
              <li key={item.id}>
                <span>{item.requestType}</span>
                <span>{item.status}</span>
                <time>{new Date(item.requestedAt).toLocaleString()}</time>
                {item.dueAt ? <span>Due: {new Date(item.dueAt).toLocaleDateString()}</span> : null}
                {data.currentRole === "OWNER" && item.requestType === "CUSTOMERS_DATA_REQUEST" &&
                  item.status === "EXPORT_READY_OWNER_DELIVERY" ?
                  <Link to={`/app/privacy/${item.id}`}>Review data copy</Link> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.emptyState}>
            <h3>No privacy requests</h3>
            <p>No requests are recorded for this store. This does not verify webhook delivery or privacy readiness.</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Guardrail history</p>
            <h2>Safety evaluations</h2>
          </div>
          <p>
            Each evaluation is immutable and records the exact metrics and
            rollback decision.
          </p>
        </div>
        <ul className={styles.auditList}>
          {data.evaluations.map((item) => (
            <li key={item.id}>
              <span>
                <strong>
                  {item.experimentKey} · {item.outcome}
                </strong>
                <br />
                {item.reasons.join(" ") || "No threshold failure."}
              </span>
              <span>{item.rollbackTriggered ? "Rolled back" : "Observed"}</span>
              <time>{new Date(item.evaluatedAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Unattended operations</p>
            <h2>Alerts and maintenance</h2>
          </div>
          <Form method="post">
            <input name="intent" type="hidden" value="run-maintenance" />
            <button
              className={styles.primaryButton}
              disabled={busy}
              type="submit"
            >
              Run maintenance now
            </button>
          </Form>
        </div>
        <ul className={styles.auditList}>
          {data.alerts.map((alert) => (
            <li key={alert.id}>
              <span>
                <strong>
                  {alert.severity} · {alert.kind}
                </strong>
                <br />
                {alert.summary}
              </span>
              <span>{alert.status}</span>
              {alert.status === "OPEN" ? (
                <Form method="post">
                  <input name="intent" type="hidden" value="resolve-alert" />
                  <input name="alertId" type="hidden" value={alert.id} />
                  <button
                    className={styles.textButton}
                    disabled={busy}
                    type="submit"
                  >
                    Resolve
                  </button>
                </Form>
              ) : (
                <time>{new Date(alert.openedAt).toLocaleString()}</time>
              )}
            </li>
          ))}
        </ul>
        {data.alerts.length === 0 ? (
          <p className={styles.muted}>No operational alerts.</p>
        ) : null}
        <h3>Recent automation runs</h3>
        <ul className={styles.auditList}>
          {data.automationRuns.map((run) => (
            <li key={run.id}>
              <span>
                <strong>{run.jobType}</strong>
                <br />
                {run.error || run.status}
              </span>
              <span>{run.status}</span>
              <time>{new Date(run.startedAt).toLocaleString()}</time>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

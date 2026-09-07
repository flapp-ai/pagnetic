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
  approveEvidence,
  approveExperience,
  approveBrandProfile,
  buildDraftLibrary,
  createCampaignMapping,
  ensureMerchant,
  proposeExperience,
  reviseDraftExperience,
  syncProducts,
} from "../services/governance.server";
import { authenticateAdmin } from "../shopify.server";
import styles from "../styles/governance.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  await ensurePilotRole({ db: prisma, merchantId: merchant.id, actor });
  const [
    products,
    angles,
    experiences,
    mappings,
    auditEntries,
    pilotSettings,
    recentDecisions,
    brandProfile,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { merchantId: merchant.id },
      orderBy: { syncedAt: "desc" },
      include: {
        evidence: { orderBy: { capturedAt: "desc" } },
      },
    }),
    prisma.acquisitionAngle.findMany({
      where: { merchantId: merchant.id, active: true },
      orderBy: { key: "asc" },
    }),
    prisma.experienceVersion.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        product: true,
        angle: true,
        approval: true,
        claims: {
          include: {
            evidenceLinks: { include: { evidence: true } },
          },
        },
      },
    }),
    prisma.campaignMapping.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { angle: true },
    }),
    prisma.auditLog.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.pilotSettings.findUnique({ where: { merchantId: merchant.id } }),
    prisma.decision.findMany({
      where: {
        merchantId: merchant.id,
        occurredAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
      select: { mappingVersion: true, acquisitionAngle: true },
    }),
    prisma.brandProfile.findUnique({ where: { merchantId: merchant.id } }),
  ]);

  return {
    shop: session.shop,
    unknownTrafficPolicy: pilotSettings?.unknownTrafficPolicy ?? "ORIGINAL",
    campaignCoverage: {
      decisions: recentDecisions.length,
      mapped: recentDecisions.filter(
        (decision) => decision.mappingVersion != null,
      ).length,
      percent: recentDecisions.length
        ? recentDecisions.filter((decision) => decision.mappingVersion != null)
            .length / recentDecisions.length
        : 0,
      byAngle: Object.entries(
        recentDecisions.reduce<Record<string, number>>((counts, decision) => {
          const key = decision.acquisitionAngle ?? "unresolved";
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {}),
      ).map(([angle, count]) => ({ angle, count })),
    },
    products: products.map((product) => ({
      ...product,
      syncedAt: product.syncedAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      evidence: product.evidence
        .filter((item) => item.sourceVersion === product.sourceVersion)
        .map((item) => ({
          ...item,
          effectiveFrom: item.effectiveFrom.toISOString(),
          expiresAt: item.expiresAt?.toISOString() ?? null,
          capturedAt: item.capturedAt.toISOString(),
        })),
    })),
    angles: angles.map((angle) => ({
      ...angle,
      createdAt: angle.createdAt.toISOString(),
      updatedAt: angle.updatedAt.toISOString(),
    })),
    experiences: experiences.map((experience) => ({
      id: experience.id,
      version: experience.version,
      status: experience.status,
      headline: experience.headline,
      supportingLine: experience.supportingLine,
      benefits: JSON.parse(experience.benefitsJson) as string[],
      proofItems: JSON.parse(experience.proofItemsJson) as string[],
      reassurance: experience.reassurance,
      contentHash: experience.contentHash,
      sourceSnapshotHash: experience.sourceSnapshotHash,
      riskClass: experience.riskClass,
      promptVersion: experience.promptVersion,
      findings: JSON.parse(experience.validationFindingsJson) as Array<{
        code: string;
        message: string;
      }>,
      createdAt: experience.createdAt.toISOString(),
      publishedAt: experience.publishedAt?.toISOString() ?? null,
      product: {
        id: experience.product.id,
        title: experience.product.title,
        handle: experience.product.handle,
      },
      angle: experience.angle
        ? { key: experience.angle.key, label: experience.angle.label }
        : null,
      approval: experience.approval
        ? {
            approver: experience.approval.approver,
            approvedAt: experience.approval.approvedAt.toISOString(),
            policyVersion: experience.approval.policyVersion,
          }
        : null,
      claims: experience.claims.map((claim) => ({
        id: claim.id,
        text: claim.claimText,
        transformation: claim.transformationType,
        riskClass: claim.riskClass,
        evidence: claim.evidenceLinks.map(({ evidence }) => ({
          id: evidence.id,
          text: evidence.verbatimText,
          status: evidence.merchantStatus,
          sourceId: evidence.sourceId,
        })),
      })),
    })),
    mappings: mappings.map((mapping) => ({
      ...mapping,
      createdAt: mapping.createdAt.toISOString(),
      angle: { key: mapping.angle.key, label: mapping.angle.label },
    })),
    auditEntries: auditEntries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    })),
    brandProfile: brandProfile
      ? {
          status: brandProfile.status,
          voiceTraits: JSON.parse(brandProfile.voiceTraitsJson) as string[],
          vocabulary: JSON.parse(brandProfile.vocabularyJson) as string[],
          sourceHash: brandProfile.sourceHash,
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actor = actorKey(session.shop, sessionToken.sub);

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
        message: `Synced ${result.productCount} products; ${result.staleCount} approved versions marked stale.`,
      };
    }

    if (intent === "approve-evidence") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      await approveEvidence({
        db: prisma,
        merchantId: merchant.id,
        evidenceId: String(formData.get("evidenceId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: "Evidence approved and recorded in the audit log.",
      };
    }

    if (intent === "approve-brand-profile") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      await approveBrandProfile({ db: prisma, merchantId: merchant.id, actor });
      return {
        ok: true,
        message: "Brand profile approved for pilot generation.",
      };
    }

    if (intent === "propose-experience") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      const result = await proposeExperience({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        angleId: String(formData.get("angleId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: `Draft v${result.experience.version} created with ${result.findingCount} validation finding(s).`,
      };
    }

    if (intent === "build-draft-library") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      const result = await buildDraftLibrary({
        db: prisma,
        merchantId: merchant.id,
        productId: String(formData.get("productId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: `Approved ${result.approvedEvidenceCount} current source items and generated ${result.draftCount} governed drafts.`,
      };
    }

    if (intent === "approve-experience") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      await approveExperience({
        db: prisma,
        merchantId: merchant.id,
        experienceId: String(formData.get("experienceId") ?? ""),
        actor,
      });
      return {
        ok: true,
        message: "Experience approved as an immutable active version.",
      };
    }

    if (intent === "revise-experience") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await reviseDraftExperience({
        db: prisma,
        merchantId: merchant.id,
        experienceId: String(formData.get("experienceId") ?? ""),
        headline: String(formData.get("headline") ?? ""),
        supportingLine: String(formData.get("supportingLine") ?? ""),
        benefits: String(formData.get("benefits") ?? "").split("\n"),
        proofItems: String(formData.get("proofItems") ?? "").split("\n"),
        reassurance: String(formData.get("reassurance") ?? ""),
        actor,
      });
      return {
        ok: true,
        message:
          "Draft revised and revalidated against approved source evidence.",
      };
    }

    if (intent === "create-mapping") {
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER", "OPERATOR"],
      });
      await createCampaignMapping({
        db: prisma,
        merchantId: merchant.id,
        angleId: String(formData.get("angleId") ?? ""),
        utmSource: String(formData.get("utmSource") ?? ""),
        utmCampaign: String(formData.get("utmCampaign") ?? ""),
        utmContent: String(formData.get("utmContent") ?? ""),
        campaignAdText: String(formData.get("campaignAdText") ?? ""),
        campaignLocale: String(formData.get("campaignLocale") ?? "en"),
        fallback: String(formData.get("fallback") ?? "ORIGINAL"),
        actor,
      });
      return {
        ok: true,
        message: "A new immutable mapping version is active.",
      };
    }

    return { ok: false, message: "Unknown governance action." };
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

export default function GovernanceWorkspace() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const pendingEvidence = data.products.reduce(
    (count, product) =>
      count +
      product.evidence.filter((item) => item.merchantStatus !== "APPROVED")
        .length,
    0,
  );
  const approvable = data.experiences.filter(
    (experience) =>
      experience.status === "DRAFT" && experience.findings.length === 0,
  ).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} to="/app">
            ← Pagnetic
          </Link>
          <p className={styles.eyebrow}>Milestone 2</p>
          <h1>Governed content workspace</h1>
          <p className={styles.lede}>
            Sync merchant sources, review evidence, create evidence-bound
            drafts, approve immutable versions, and map campaigns to acquisition
            angles.
          </p>
        </div>
        <Form method="post">
          <input name="intent" type="hidden" value="sync-products" />
          <button
            className={styles.primaryButton}
            disabled={busy}
            type="submit"
          >
            {busy ? "Working…" : "Sync Shopify products"}
          </button>
        </Form>
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

      <section className={styles.metrics} aria-label="Governance status">
        <article>
          <strong>{data.products.length}</strong>
          <span>synced products</span>
        </article>
        <article>
          <strong>{pendingEvidence}</strong>
          <span>evidence items awaiting review</span>
        </article>
        <article>
          <strong>{approvable}</strong>
          <span>drafts ready to approve</span>
        </article>
        <article>
          <strong>
            {data.mappings.filter((item) => item.status === "ACTIVE").length}
          </strong>
          <span>active campaign mappings</span>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Brand intelligence</p>
            <h2>Source-derived voice profile</h2>
          </div>
          <p>
            Generated locally from current catalog wording; no shopper data or
            external model is used.
          </p>
        </div>
        {data.brandProfile ? (
          <article className={styles.versionCard}>
            <div className={styles.cardHeader}>
              <div>
                <h3>{data.brandProfile.voiceTraits.join(" · ")}</h3>
                <p>
                  Vocabulary:{" "}
                  {data.brandProfile.vocabulary.join(", ") ||
                    "not enough source text"}
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
            {data.brandProfile.status !== "APPROVED" ? (
              <Form method="post">
                <input
                  name="intent"
                  type="hidden"
                  value="approve-brand-profile"
                />
                <button
                  className={styles.primaryButton}
                  disabled={busy}
                  type="submit"
                >
                  Approve brand profile
                </button>
              </Form>
            ) : null}
          </article>
        ) : (
          <div className={styles.emptyState}>
            <h3>No brand profile yet</h3>
            <p>Sync Shopify products to generate one.</p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 1</p>
            <h2>Review source evidence</h2>
          </div>
          <p>
            Approval records the exact source version and hash. It does not
            approve generated claims.
          </p>
        </div>

        {data.products.length ? (
          <div className={styles.cardGrid}>
            {data.products.map((product) => (
              <article className={styles.card} key={product.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.muted}>{product.status}</p>
                    <h3>{product.title}</h3>
                  </div>
                  <span className={styles.hash} title={product.sourceHash}>
                    {product.sourceHash.slice(0, 10)}
                  </span>
                </div>
                <p className={styles.muted}>/products/{product.handle}</p>

                <div className={styles.evidenceList}>
                  {product.evidence.map((evidence) => (
                    <div className={styles.evidence} key={evidence.id}>
                      <div className={styles.evidenceMeta}>
                        <span>{evidence.riskClass} risk</span>
                        <span
                          className={
                            evidence.merchantStatus === "APPROVED"
                              ? styles.approvedBadge
                              : styles.reviewBadge
                          }
                        >
                          {evidence.merchantStatus.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p>{evidence.verbatimText}</p>
                      {evidence.merchantStatus !== "APPROVED" ? (
                        <Form method="post">
                          <input
                            name="intent"
                            type="hidden"
                            value="approve-evidence"
                          />
                          <input
                            name="evidenceId"
                            type="hidden"
                            value={evidence.id}
                          />
                          <button
                            className={styles.secondaryButton}
                            disabled={busy}
                            type="submit"
                          >
                            Approve this exact evidence
                          </button>
                        </Form>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className={styles.proposalActions}>
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="build-draft-library"
                    />
                    <input name="productId" type="hidden" value={product.id} />
                    <button
                      className={styles.primaryButton}
                      disabled={busy}
                      type="submit"
                    >
                      Approve source + build draft library
                    </button>
                  </Form>
                  {data.angles.map((angle) => (
                    <Form method="post" key={angle.id}>
                      <input
                        name="intent"
                        type="hidden"
                        value="propose-experience"
                      />
                      <input
                        name="productId"
                        type="hidden"
                        value={product.id}
                      />
                      <input name="angleId" type="hidden" value={angle.id} />
                      <button
                        className={styles.textButton}
                        disabled={busy}
                        type="submit"
                      >
                        Propose {angle.label}
                      </button>
                    </Form>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>No catalog snapshot yet</h3>
            <p>
              Sync Shopify products to create immutable source and evidence
              records.
            </p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 2</p>
            <h2>Validate and approve versions</h2>
          </div>
          <p>
            Only verbatim, evidence-backed statements can pass this
            technical-proof validator.
          </p>
        </div>

        {data.experiences.length ? (
          <div className={styles.versionList}>
            {data.experiences.map((experience) => (
              <article className={styles.versionCard} key={experience.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.muted}>
                      {experience.product.title} ·{" "}
                      {experience.angle?.label ?? "Universal"} · v
                      {experience.version}
                    </p>
                    <h3>{experience.headline}</h3>
                  </div>
                  <span className={styles.statusBadge}>
                    {experience.status.replaceAll("_", " ")}
                  </span>
                </div>
                <ul className={styles.benefits}>
                  {experience.benefits.map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>

                {experience.status === "DRAFT" ? (
                  <details>
                    <summary>Revise this draft</summary>
                    <Form className={styles.registrationForm} method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="revise-experience"
                      />
                      <input
                        name="experienceId"
                        type="hidden"
                        value={experience.id}
                      />
                      <label>
                        Headline
                        <input
                          defaultValue={experience.headline}
                          maxLength={160}
                          name="headline"
                          required
                        />
                      </label>
                      <label>
                        Supporting line
                        <input
                          defaultValue={experience.supportingLine ?? ""}
                          maxLength={240}
                          name="supportingLine"
                        />
                      </label>
                      <label>
                        Benefits, one per line
                        <textarea
                          defaultValue={experience.benefits.join("\n")}
                          name="benefits"
                          required
                          rows={5}
                        />
                      </label>
                      <label>
                        Proof items, one per line
                        <textarea
                          defaultValue={experience.proofItems.join("\n")}
                          name="proofItems"
                          rows={3}
                        />
                      </label>
                      <label>
                        Reassurance
                        <input
                          defaultValue={experience.reassurance ?? ""}
                          maxLength={240}
                          name="reassurance"
                        />
                      </label>
                      <button
                        className={styles.secondaryButton}
                        disabled={busy}
                        type="submit"
                      >
                        Save governed revision
                      </button>
                    </Form>
                  </details>
                ) : null}

                <details>
                  <summary>
                    Evidence trace ({experience.claims.length} claims)
                  </summary>
                  <div className={styles.claimList}>
                    {experience.claims.map((claim) => (
                      <div key={claim.id}>
                        <strong>{claim.text}</strong>
                        <span>
                          {claim.transformation} · {claim.riskClass}
                        </span>
                        {claim.evidence.map((evidence) => (
                          <blockquote key={evidence.id}>
                            {evidence.text}
                          </blockquote>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>

                {experience.findings.length ? (
                  <div className={styles.findings}>
                    <strong>Approval blocked</strong>
                    <ul>
                      {experience.findings.map((finding) => (
                        <li key={`${finding.code}-${finding.message}`}>
                          {finding.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : experience.status === "DRAFT" ? (
                  <Form method="post">
                    <input
                      name="intent"
                      type="hidden"
                      value="approve-experience"
                    />
                    <input
                      name="experienceId"
                      type="hidden"
                      value={experience.id}
                    />
                    <button
                      className={styles.primaryButton}
                      disabled={busy}
                      type="submit"
                    >
                      Approve immutable version
                    </button>
                  </Form>
                ) : null}

                <footer className={styles.versionFooter}>
                  <span>Content {experience.contentHash.slice(0, 12)}</span>
                  <span>
                    Sources {experience.sourceSnapshotHash.slice(0, 12)}
                  </span>
                  <span>{experience.promptVersion}</span>
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>No proposed versions</h3>
            <p>
              Approve current evidence, then create an angle-specific proposal.
            </p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Step 3</p>
            <h2>Map campaigns to angles</h2>
          </div>
          <p>
            Every change creates a new mapping version; ambiguous active
            mappings are rejected. Recent mapped coverage:{" "}
            {(data.campaignCoverage.percent * 100).toFixed(1)}%.
          </p>
        </div>

        <Form className={styles.mappingForm} method="post">
          <input name="intent" type="hidden" value="create-mapping" />
          <label>
            UTM source
            <input name="utmSource" placeholder="meta" required />
          </label>
          <label>
            UTM campaign
            <input name="utmCampaign" placeholder="run_q3" required />
          </label>
          <label>
            UTM content
            <input name="utmContent" placeholder="comfort_video_02" />
          </label>
          <label className={styles.wideField}>
            Exact campaign or ad message
            <textarea
              maxLength={2000}
              name="campaignAdText"
              placeholder="Paste the exact promise shoppers see. Pagnetic will not infer it from UTM names."
              required
              rows={3}
            />
          </label>
          <input name="campaignLocale" type="hidden" value="en" />
          <label>
            Acquisition angle
            <select name="angleId" required>
              {data.angles.map((angle) => (
                <option key={angle.id} value={angle.id}>
                  {angle.label}
                </option>
              ))}
            </select>
          </label>
          <input
            name="fallback"
            type="hidden"
            value={data.unknownTrafficPolicy}
          />
          <label>
            Unknown traffic
            <input disabled value={data.unknownTrafficPolicy} />
          </label>
          <button
            className={styles.primaryButton}
            disabled={busy}
            type="submit"
          >
            Save mapping version
          </button>
        </Form>

        <div className={styles.mappingList}>
          {data.mappings.map((mapping) => (
            <div key={mapping.id}>
              <code>
                {mapping.utmSource}/{mapping.utmCampaign}/
                {mapping.utmContent || "*"}
              </code>
              <span>→ {mapping.angle.label}</span>
              <span>v{mapping.version}</span>
              <span>
                {mapping.status} · {mapping.campaignEvidenceHash ? "evidence linked" : "legacy mapping"}
              </span>
            </div>
          ))}
        </div>
        <p className={styles.muted}>
          Last 30 days: {data.campaignCoverage.mapped} of{" "}
          {data.campaignCoverage.decisions} experiment decisions used a
          versioned campaign mapping. Change the global unknown-traffic rule in
          Setup and qualification.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.step}>Audit</p>
            <h2>Recent governed actions</h2>
          </div>
          <p>Store: {data.shop}</p>
        </div>
        <ol className={styles.auditList}>
          {data.auditEntries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.action.replaceAll("_", " ")}</strong>
              <span>{entry.resourceType}</span>
              <time dateTime={entry.createdAt}>
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

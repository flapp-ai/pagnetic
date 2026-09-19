import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { AdaptivePackageReviewPanel } from "../components/adaptive-package-review";
import { approvedMessageSummaries, previewExperienceHref } from "../services/approved-message-presentation";

import prisma from "../db.server";
import { actorKey, ensurePilotRole } from "../services/access.server";
import {
  approveExperience,
  buildDraftLibrary,
  createSourceBackedCampaignDraft,
  ensureMerchant,
  reviseDraftExperience,
} from "../services/governance.server";
import {
  approveAdaptivePackageReview,
  buildAdaptiveApprovedPackage,
  createAdaptivePackageReview,
  parseAdaptiveApprovedPackage,
} from "../services/adaptive-package.server";
import { authenticateAdmin } from "../shopify.server";
import { requirePilotRouteAction } from "../services/pilot-route-access.server";
import styles from "../styles/governance.module.css";

function parseSource(value: string) {
  try {
    return JSON.parse(value) as {
      description?: string;
      featuredImage?: { url?: string; altText?: string | null } | null;
    };
  } catch {
    return {};
  }
}

type CampaignFormValues = {
  utmSource: string;
  utmCampaign: string;
  utmContent: string;
  angleId: string;
  campaignAdText: string;
};

function campaignFormValues(form: FormData): CampaignFormValues {
  return {
    utmSource: String(form.get("utmSource") ?? ""),
    utmCampaign: String(form.get("utmCampaign") ?? ""),
    utmContent: String(form.get("utmContent") ?? ""),
    angleId: String(form.get("angleId") ?? ""),
    campaignAdText: String(form.get("campaignAdText") ?? ""),
  };
}

function campaignActionError(error: unknown) {
  if (!(error instanceof Error)) return "The campaign setup could not be saved. Review the fields and try again.";
  const messages: Record<string, string> = {
    DIAGNOSIS_EVIDENCE_LINK_MISSING:
      "The campaign was not drafted because this product's current facts have not completed source review. Refresh the source review, then try again. Original remains active.",
    CAMPAIGN_EVIDENCE_REQUIRED:
      "Paste the exact campaign message so Pagnetic can verify the proposed storefront message.",
    CAMPAIGN_EVIDENCE_CHANGED:
      "The saved campaign evidence changed. Review the exact ad message and submit it again.",
    CAMPAIGN_EVIDENCE_INVALID:
      "The exact ad message could not be read safely. Review it and submit again.",
  };
  if (messages[error.message]) return messages[error.message];
  if (
    /^(Select a valid synced product|Current product-title evidence is missing|No distinct source-backed campaign message could be created|This product is outside the supported low-risk English workflow|Pagnetic could not create a source-backed campaign message)/.test(
      error.message,
    )
  ) return error.message;
  return "The campaign setup could not be completed safely. Your storefront remains Original; review the product facts and campaign fields, then try again.";
}

export function diagnosisUiState(args: {
  status: string;
  hasCurrentDraft: boolean;
  stale: boolean;
}) {
  if (args.stale || ["STALE", "INVALIDATED", "EXPIRED"].includes(args.status)) {
    return {
      kind: "stale" as const,
      title: "Source review out of date",
      detail: "The product facts changed after this review. Refresh the source review before using its message.",
    };
  }
  if (args.status === "EXPERIENCE_DRAFTED" || (args.status === "DRAFT" && args.hasCurrentDraft)) {
    return {
      kind: "success" as const,
      title: "Source-backed draft ready",
      detail: "Review the exact proposed message and its sources below. Nothing reaches shoppers until it is approved.",
    };
  }
  if (args.status === "UNSUPPORTED_SOURCE") {
    return {
      kind: "abstained" as const,
      title: "Source outside the supported workflow",
      detail: "No unsafe copy was invented. Choose another product or update this product's English source facts, then refresh the review.",
    };
  }
  if (args.status === "NO_SUPPORTED_OPPORTUNITY") {
    return {
      kind: "abstained" as const,
      title: "No supported message opportunity",
      detail: "No unsafe copy was invented. Add specific factual product benefits or choose another product, then refresh the review.",
    };
  }
  return {
    kind: "pending" as const,
    title: "Source review needs a refresh",
    detail: "No current draft is linked to this review. Refresh it before creating or approving a message.",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const pilotRole = await ensurePilotRole({
    db: prisma,
    merchantId: merchant.id,
    actor: actorKey(session.shop, sessionToken.sub),
  });
  const url = new URL(request.url);
  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id, status: "ACTIVE" },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
  const productId = url.searchParams.get("productId") ?? products[0]?.id ?? null;
  const product = productId
    ? await prisma.product.findFirst({
        where: { id: productId, merchantId: merchant.id },
        include: {
          experiences: {
            where: { status: { in: ["DRAFT", "APPROVED_ACTIVE"] }, staleAt: null },
            orderBy: [{ status: "asc" }, { createdAt: "desc" }],
            include: {
              angle: true,
              claims: {
                include: { evidenceLinks: { include: { evidence: true } } },
              },
            },
          },
          messageDiagnoses: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      })
    : null;
  const source = parseSource(product?.sourceSnapshot ?? "{}");
  const packageReviewRecord = product
    ? await prisma.adaptivePackageReview.findFirst({
        where: {
          merchantId: merchant.id,
          productId: product.id,
          status: { in: ["PENDING", "APPROVED"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          packageHash: true,
          payloadJson: true,
          status: true,
          approvedAt: true,
        },
      })
    : null;
  let packageReview = null;
  if (packageReviewRecord) {
    try {
      packageReview = {
        id: packageReviewRecord.id,
        packageHash: packageReviewRecord.packageHash,
        status: packageReviewRecord.status,
        approvedAt: packageReviewRecord.approvedAt?.toISOString() ?? null,
        package: parseAdaptiveApprovedPackage(packageReviewRecord.payloadJson),
      };
    } catch {
      packageReview = {
        id: packageReviewRecord.id,
        packageHash: packageReviewRecord.packageHash,
        status: "INVALIDATED",
        approvedAt: null,
        package: null,
      };
    }
  }
  return {
    currentRole: pilotRole.role,
    products,
    product: product
      ? {
          id: product.id,
          title: product.title,
          description: source.description ?? null,
          imageUrl: source.featuredImage?.url ?? null,
          imageAlt: source.featuredImage?.altText ?? product.title,
        }
      : null,
    diagnosis: product?.messageDiagnoses[0]
      ? {
          mode: product.messageDiagnoses[0].mode,
          gapType: product.messageDiagnoses[0].gapType,
          rationale: product.messageDiagnoses[0].rationale,
          status: product.messageDiagnoses[0].status,
          stale:
            product.messageDiagnoses[0].sourceVersion !== product.sourceVersion ||
            Boolean(
              product.messageDiagnoses[0].expiresAt &&
              product.messageDiagnoses[0].expiresAt <= new Date(),
            ),
        }
      : null,
    experiences: (product?.experiences ?? []).map((experience) => ({
      id: experience.id,
      status: experience.status,
      angle: experience.angle?.label ?? "Default",
      headline: experience.headline,
      supportingLine: experience.supportingLine,
      benefits: JSON.parse(experience.benefitsJson) as string[],
      reassurance: experience.reassurance,
      claims: experience.claims.map((claim) => ({
        text: claim.claimText,
        sources: claim.evidenceLinks.map((link) => link.evidence.verbatimText),
      })),
    })),
    angles: await prisma.acquisitionAngle.findMany({
      where: { merchantId: merchant.id, active: true },
      orderBy: { key: "asc" },
      select: { id: true, label: true },
    }),
    plan: await prisma.autopilotPlan.findFirst({
      where: { merchantId: merchant.id, productId: product?.id, state: { not: "INVALIDATED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, state: true },
    }),
    packageReview,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const actor = actorKey(session.shop, sessionToken.sub);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const submittedCampaign = intent === "campaign-draft" ? campaignFormValues(form) : null;
  try {
    const productId = String(form.get("productId") ?? "");
    if (intent === "build-draft") {
      await requirePilotRouteAction({ db: prisma, merchantId: merchant.id, actor, action: "messages:build-draft" });
      const result = await buildDraftLibrary({
        db: prisma,
        merchantId: merchant.id,
        productId,
        actor,
      });
      return {
        ok: result.draftCount > 0,
        message: result.draftCount
          ? "A source-backed message is ready for review."
          : "No useful supported change was found. Add more specific product evidence or an exact campaign message.",
      };
    }
    if (intent === "campaign-draft") {
      await requirePilotRouteAction({ db: prisma, merchantId: merchant.id, actor, action: "messages:campaign-draft" });
      await createSourceBackedCampaignDraft({
        db: prisma,
        merchantId: merchant.id,
        productId,
        angleId: String(form.get("angleId") ?? ""),
        utmSource: String(form.get("utmSource") ?? ""),
        utmCampaign: String(form.get("utmCampaign") ?? ""),
        utmContent: String(form.get("utmContent") ?? ""),
        campaignAdText: String(form.get("campaignAdText") ?? ""),
        campaignLocale: "en",
        fallback: "ORIGINAL",
        actor,
      });
      return {
        ok: true,
        message: "The campaign promise is linked to a source-backed draft.",
        campaignForm: submittedCampaign,
      };
    }
    if (intent === "revise-draft") {
      await requirePilotRouteAction({ db: prisma, merchantId: merchant.id, actor, action: "messages:revise-draft" });
      await reviseDraftExperience({
        db: prisma,
        merchantId: merchant.id,
        experienceId: String(form.get("experienceId") ?? ""),
        headline: String(form.get("headline") ?? ""),
        supportingLine: String(form.get("supportingLine") ?? ""),
        benefits: String(form.get("benefits") ?? "").split("\n"),
        proofItems: [],
        reassurance: String(form.get("reassurance") ?? ""),
        actor,
      });
      return { ok: true, message: "Draft updated and revalidated against exact source evidence." };
    }
    if (intent === "approve-message") {
      await requirePilotRouteAction({ db: prisma, merchantId: merchant.id, actor, action: "messages:approve-message" });
      await approveExperience({
        db: prisma,
        merchantId: merchant.id,
        experienceId: String(form.get("experienceId") ?? ""),
        actor,
      });
      return { ok: true, message: "Message approved. Test approval remains a separate bounded step." };
    }
    if (intent === "prepare-adaptive-package") {
      await requirePilotRouteAction({ db: prisma, merchantId: merchant.id, actor, action: "messages:prepare-adaptive-package" });
      const approved = await buildAdaptiveApprovedPackage({ db: prisma, merchantId: merchant.id, productId });
      if (approved.coverage.mappedBundles === 0) {
        return {
          ok: false,
          message: "No active campaign mapping has both exact ad evidence and an approved product bundle yet. Nothing was deployed.",
        };
      }
      const review = await createAdaptivePackageReview({ db: prisma, package: approved, actor });
      return {
        ok: approved.coverage.mappedBundles > 0,
        message: approved.coverage.mappedBundles > 0
          ? `Adaptive package review ${review.id} prepared (${approved.coverage.mappedBundles}/${approved.coverage.activeMappings} mappings; hash ${approved.packageHash.slice(0, 12)}…). No deployment was started.`
          : "No active campaign mapping has both exact ad evidence and an approved product bundle yet. Nothing was deployed.",
      };
    }
    if (intent === "approve-adaptive-package") {
      await requirePilotRouteAction({ db: prisma, merchantId: merchant.id, actor, action: "messages:approve-adaptive-package" });
      const review = await approveAdaptivePackageReview({ db: prisma, merchantId: merchant.id, productId, reviewId: String(form.get("reviewId") ?? ""), actor });
      return { ok: true, message: `Adaptive package ${review.id} approved. Deployment still requires the registered experiment preparation gate.` };
    }
    return { ok: false, message: "Unknown message action." };
  } catch (error) {
    return {
      ok: false,
      message: intent === "campaign-draft"
        ? campaignActionError(error)
        : error instanceof Error ? error.message : "The message action failed.",
      campaignForm: submittedCampaign,
    };
  }
};

export function MessagesView({
  data,
  result,
  busy,
}: {
  data: ReturnType<typeof useLoaderData<typeof loader>>;
  result: ReturnType<typeof useActionData<typeof action>>;
  busy: boolean;
}) {
  const draft = data.experiences.find((experience) => experience.status === "DRAFT");
  const canApprove = data.currentRole === "OWNER";
  const approvedMessages = approvedMessageSummaries(data.experiences, data.product?.id ?? "");
  const adaptiveReview = data.packageReview?.package ?? null;
  const diagnosisState = data.diagnosis
    ? diagnosisUiState({
        status: data.diagnosis.status,
        hasCurrentDraft: Boolean(draft),
        stale: data.diagnosis.stale,
      })
    : null;
  const campaignForm = result && "campaignForm" in result
    ? result.campaignForm
    : null;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Messages</p>
          <h1>One useful change, with its source beside it</h1>
          <p className={styles.lede}>
            Pagnetic will abstain when the product page cannot support a distinct message.
          </p>
        </div>
      </header>
      {result ? (
        <div className={result.ok ? styles.successMessage : styles.errorMessage} role="status">
          {result.message}
        </div>
      ) : null}
      <section className={styles.section}>
        <Form className={styles.inlineForm} method="get">
          <label>
            Product
            <select defaultValue={data.product?.id ?? ""} name="productId">
              {data.products.map((product) => (
                <option key={product.id} value={product.id}>{product.title}</option>
              ))}
            </select>
          </label>
          <button className={styles.secondaryButton} type="submit">Show messages</button>
        </Form>
      </section>
      {data.product ? (
        <section className={styles.section}>
          <div className={styles.reviewSplit}>
            <article>
              <p className={styles.step}>Current source</p>
              {data.product.imageUrl ? (
                <img className={styles.reviewImage} src={data.product.imageUrl} alt={data.product.imageAlt} />
              ) : null}
              <h2>{data.product.title}</h2>
              <p>{data.product.description ?? "No current description was found."}</p>
            </article>
            <article>
              <p className={styles.step}>Diagnosis</p>
              {data.diagnosis ? (
                <>
                  <h2>{diagnosisState?.title}</h2>
                  <p>{data.diagnosis.rationale}</p>
                  <p className={styles.muted}>{diagnosisState?.detail}</p>
                  <small>
                    {data.diagnosis.gapType.replaceAll("_", " ").toLowerCase()} · {data.diagnosis.mode.replaceAll("_", " ").toLowerCase()}
                  </small>
                  <Form method="post">
                    <input name="intent" type="hidden" value="build-draft" />
                    <input name="productId" type="hidden" value={data.product.id} />
                    <button className={styles.secondaryButton} disabled={busy} type="submit">Refresh source review</button>
                  </Form>
                </>
              ) : (
                <>
                  <h2>No diagnosis yet</h2>
                  <p>Run the deterministic source review. Nothing reaches shoppers from this action.</p>
                  <Form method="post">
                    <input name="intent" type="hidden" value="build-draft" />
                    <input name="productId" type="hidden" value={data.product.id} />
                    <button className={styles.primaryButton} disabled={busy} type="submit">Find a message opportunity</button>
                  </Form>
                </>
              )}
            </article>
          </div>
        </section>
      ) : null}
      {draft && data.product ? (
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div><p className={styles.step}>Review</p><h2>Exact proposed message</h2></div>
            <Link className={styles.secondaryButton} to={previewExperienceHref(data.product.id, draft.id)}>Preview in context</Link>
          </div>
          <div className={styles.reviewSplit}>
            <article className={styles.panelPreview}>
              <span>{draft.angle}</span>
              <h3>{draft.headline}</h3>
              {draft.supportingLine ? <p>{draft.supportingLine}</p> : null}
              <ul>{draft.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
              <details><summary>View exact sources</summary>{draft.claims.map((claim) => (
                <div className={styles.sourceTrace} key={claim.text}><strong>{claim.text}</strong>{claim.sources.map((source) => <blockquote key={source}>{source}</blockquote>)}</div>
              ))}</details>
            </article>
            <Form className={styles.reviewForm} method="post">
              <input name="intent" type="hidden" value="revise-draft" />
              <input name="productId" type="hidden" value={data.product.id} />
              <input name="experienceId" type="hidden" value={draft.id} />
              <label>Headline<input defaultValue={draft.headline} maxLength={160} name="headline" required /></label>
              <label>Supporting line<input defaultValue={draft.supportingLine ?? ""} maxLength={240} name="supportingLine" /></label>
              <label>Benefits, one per line<textarea defaultValue={draft.benefits.join("\n")} maxLength={1000} name="benefits" required rows={6} /></label>
              <label>Reassurance<input defaultValue={draft.reassurance ?? ""} maxLength={240} name="reassurance" /></label>
              <button className={styles.secondaryButton} disabled={busy} type="submit">Save supported edits</button>
            </Form>
          </div>
          {canApprove ? (
            <Form method="post">
              <input name="intent" type="hidden" value="approve-message" />
              <input name="productId" type="hidden" value={data.product.id} />
              <input name="experienceId" type="hidden" value={draft.id} />
              <button className={styles.primaryButton} disabled={busy} type="submit">Approve this message</button>
            </Form>
          ) : (
            <p className={styles.muted}>Draft saved for the store owner to approve. Your setup access cannot publish or activate it.</p>
          )}
          <p className={styles.muted}>Message approval does not start a test or authorize billing. Review the bounded test on Overview next.</p>
        </section>
      ) : null}
      {data.product ? (
        <details
          className={styles.advancedDetails}
          open={!draft && approvedMessages.length === 0}
        >
          <summary>Match this product to one campaign</summary>
          <p className={styles.muted}>
            Enter the exact labels used by the ad link and paste the exact ad
            message. Saving the mapping does not edit an ad or start a test.
          </p>
          <Form className={styles.mappingForm} method="post">
            <input name="intent" type="hidden" value="campaign-draft" />
            <input name="productId" type="hidden" value={data.product.id} />
            <label>UTM source<input defaultValue={campaignForm?.utmSource ?? ""} name="utmSource" placeholder="meta" required /></label>
            <label>UTM campaign<input defaultValue={campaignForm?.utmCampaign ?? ""} name="utmCampaign" placeholder="launch" required /></label>
            <label>UTM content<input defaultValue={campaignForm?.utmContent ?? ""} name="utmContent" placeholder="video-01" /></label>
            <label>Message angle<select defaultValue={campaignForm?.angleId ?? data.angles[0]?.id ?? ""} name="angleId" required>{data.angles.map((angle) => <option key={angle.id} value={angle.id}>{angle.label}</option>)}</select></label>
            <label className={styles.wideField}>Exact ad message<textarea defaultValue={campaignForm?.campaignAdText ?? ""} maxLength={2000} name="campaignAdText" required rows={4} /></label>
            <button className={styles.primaryButton} disabled={busy} type="submit">Create campaign draft</button>
          </Form>
        </details>
      ) : null}
      {approvedMessages.length ? (
        <section className={styles.section}>
          <h2>Approved messages</h2>
          <p>Approved message versions are immutable. A separate package review freezes the exact campaign mappings, text, evidence and experiment question.</p>
          <div className={styles.versionList}>
            {approvedMessages.map((experience) => (
              <article className={styles.versionCard} key={experience.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.step}>{experience.angle}</p>
                    <h3>{experience.headline}</h3>
                    {experience.supportingLine ? <p>{experience.supportingLine}</p> : null}
                  </div>
                  <span className={styles.statusBadge} data-status="READY">APPROVED</span>
                </div>
                <ul>
                  {experience.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                </ul>
                {experience.reassurance ? <p>{experience.reassurance}</p> : null}
                <details>
                  <summary>View exact sources</summary>
                  {experience.claims.map((claim) => (
                    <div className={styles.sourceTrace} key={claim.text}>
                      <strong>{claim.text}</strong>
                      {claim.sources.map((source) => <blockquote key={source}>{source}</blockquote>)}
                    </div>
                  ))}
                </details>
                <Link className={styles.secondaryButton} to={experience.previewHref}>
                  Preview in context
                </Link>
              </article>
            ))}
          </div>
          <Link className={styles.primaryButton} to="/app">Review test readiness</Link>
          {canApprove && data.product ? <Form method="post"><input name="intent" type="hidden" value="prepare-adaptive-package" /><input name="productId" type="hidden" value={data.product.id} /><button className={styles.secondaryButton} disabled={busy} type="submit">Prepare adaptive package for review</button></Form> : null}
          {canApprove && adaptiveReview ? (
            <div className={styles.panelPreview}>
              <AdaptivePackageReviewPanel
                package={adaptiveReview}
                reviewId={data.packageReview!.id}
                reviewStatus={data.packageReview!.status}
                productId={data.product!.id}
                busy={busy}
              />
            </div>
          ) : data.packageReview ? <p role="alert">The saved package payload is invalid. Prepare a fresh package before approval.</p> : null}
        </section>
      ) : null}
    </main>
  );
}

export default function Messages() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return <MessagesView {...{ data, result, busy }} />;
}

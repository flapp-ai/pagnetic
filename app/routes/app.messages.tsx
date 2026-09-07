import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { AdaptivePackageReviewPanel } from "../components/adaptive-package-review";

import prisma from "../db.server";
import { actorKey, ensurePilotRole, requirePilotRole } from "../services/access.server";
import {
  approveExperience,
  buildDraftLibrary,
  createCampaignMapping,
  ensureMerchant,
  reviseDraftExperience,
} from "../services/governance.server";
import { createDiagnosisDraftV2 } from "../services/message-diagnosis-v2.server";
import {
  approveAdaptivePackageReview,
  buildAdaptiveApprovedPackage,
  createAdaptivePackageReview,
  parseAdaptiveApprovedPackage,
} from "../services/adaptive-package.server";
import { authenticateAdmin } from "../shopify.server";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, sessionToken } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  await ensurePilotRole({
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
  try {
    await requirePilotRole({
      db: prisma,
      merchantId: merchant.id,
      actor,
      allowed: ["OWNER", "OPERATOR"],
    });
    const productId = String(form.get("productId") ?? "");
    if (intent === "build-draft") {
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
      const mapping = await createCampaignMapping({
        db: prisma,
        merchantId: merchant.id,
        angleId: String(form.get("angleId") ?? ""),
        utmSource: String(form.get("utmSource") ?? ""),
        utmCampaign: String(form.get("utmCampaign") ?? ""),
        utmContent: String(form.get("utmContent") ?? ""),
        campaignAdText: String(form.get("campaignAdText") ?? ""),
        campaignLocale: "en",
        fallback: "ORIGINAL",
        actor,
      });
      const drafted = await createDiagnosisDraftV2({
        db: prisma,
        merchantId: merchant.id,
        productId,
        campaignMappingId: mapping.id,
        actor,
      });
      return {
        ok: Boolean(drafted.experience),
        message: drafted.experience
          ? "The campaign promise is linked to a source-backed draft."
          : "That campaign did not produce a distinct supported message. No treatment was created.",
      };
    }
    if (intent === "revise-draft") {
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
      await requirePilotRole({
        db: prisma,
        merchantId: merchant.id,
        actor,
        allowed: ["OWNER"],
      });
      await approveExperience({
        db: prisma,
        merchantId: merchant.id,
        experienceId: String(form.get("experienceId") ?? ""),
        actor,
      });
      return { ok: true, message: "Message approved. Test approval remains a separate bounded step." };
    }
    if (intent === "prepare-adaptive-package") {
      await requirePilotRole({ db: prisma, merchantId: merchant.id, actor, allowed: ["OWNER"] });
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
      await requirePilotRole({ db: prisma, merchantId: merchant.id, actor, allowed: ["OWNER"] });
      const review = await approveAdaptivePackageReview({ db: prisma, merchantId: merchant.id, productId, reviewId: String(form.get("reviewId") ?? ""), actor });
      return { ok: true, message: `Adaptive package ${review.id} approved. Deployment still requires the registered experiment preparation gate.` };
    }
    return { ok: false, message: "Unknown message action." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The message action failed.",
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
  const adaptiveReview = data.packageReview?.package ?? null;
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
                  <h2>{data.diagnosis.gapType.replaceAll("_", " ").toLowerCase()}</h2>
                  <p>{data.diagnosis.rationale}</p>
                  <small>{data.diagnosis.mode.replaceAll("_", " ").toLowerCase()}</small>
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
            <Link className={styles.secondaryButton} to={`/app/preview?productId=${encodeURIComponent(data.product.id)}`}>Preview in context</Link>
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
          <Form method="post">
            <input name="intent" type="hidden" value="approve-message" />
            <input name="productId" type="hidden" value={data.product.id} />
            <input name="experienceId" type="hidden" value={draft.id} />
            <button className={styles.primaryButton} disabled={busy} type="submit">Approve this message</button>
          </Form>
          <p className={styles.muted}>Message approval does not start a test or authorize billing. Review the bounded test on Overview next.</p>
        </section>
      ) : null}
      {data.product ? (
        <details className={styles.advancedDetails}>
          <summary>Match this product to one campaign</summary>
          <Form className={styles.mappingForm} method="post">
            <input name="intent" type="hidden" value="campaign-draft" />
            <input name="productId" type="hidden" value={data.product.id} />
            <label>UTM source<input name="utmSource" placeholder="meta" required /></label>
            <label>UTM campaign<input name="utmCampaign" placeholder="launch" required /></label>
            <label>UTM content<input name="utmContent" placeholder="video-01" /></label>
            <label>Message angle<select name="angleId" required>{data.angles.map((angle) => <option key={angle.id} value={angle.id}>{angle.label}</option>)}</select></label>
            <label className={styles.wideField}>Exact ad message<textarea maxLength={2000} name="campaignAdText" required rows={4} /></label>
            <button className={styles.primaryButton} disabled={busy} type="submit">Create campaign draft</button>
          </Form>
        </details>
      ) : null}
      {data.experiences.some((experience) => experience.status === "APPROVED_ACTIVE") ? (
        <section className={styles.section}>
          <h2>Approved messages</h2>
          <p>Approved message versions are immutable. A separate package review freezes the exact campaign mappings, text, evidence and experiment question.</p>
          <Link className={styles.primaryButton} to="/app">Review test readiness</Link>
          {data.product ? <Form method="post"><input name="intent" type="hidden" value="prepare-adaptive-package" /><input name="productId" type="hidden" value={data.product.id} /><button className={styles.secondaryButton} disabled={busy} type="submit">Prepare adaptive package for review</button></Form> : null}
          {adaptiveReview ? (
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

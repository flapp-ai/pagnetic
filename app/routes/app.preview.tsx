import type { LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";

import prisma from "../db.server";
import { selectRequestedExperience } from "../services/approved-message-presentation";
import { ensureMerchant } from "../services/governance.server";
import { authenticateAdmin } from "../shopify.server";
import styles from "../styles/governance.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdmin(request);
  const merchant = await ensureMerchant(prisma, session.shop);
  const url = new URL(request.url);
  const products = await prisma.product.findMany({
    where: { merchantId: merchant.id, status: "ACTIVE" },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
  const requestedProduct = url.searchParams.get("productId") ?? products[0]?.id;
  const requestedExperience = url.searchParams.get("experienceId");
  const product = requestedProduct
    ? await prisma.product.findFirst({
        where: { id: requestedProduct, merchantId: merchant.id },
        include: {
          experiences: {
            // Stale drafts/approvals must never be previewable.
            where: { status: { in: ["DRAFT", "APPROVED_ACTIVE"] }, staleAt: null },
            include: {
              angle: true,
              claims: {
                include: { evidenceLinks: { include: { evidence: true } } },
              },
            },
            orderBy: { publishedAt: "desc" },
          },
        },
      })
    : null;
  const angle = url.searchParams.get("angle") ?? "universal";
  const selected = selectRequestedExperience(
    product?.experiences ?? [],
    requestedExperience,
    () => product?.experiences.find(
      (experience) => (experience.angle?.key ?? "universal") === angle,
    ) ?? product?.experiences[0] ?? null,
  );
  let productSource: {
    description?: string;
    featuredImage?: { url?: string; altText?: string | null } | null;
    templateSuffix?: string | null;
  } = {};
  try {
    productSource = JSON.parse(product?.sourceSnapshot ?? "{}") as typeof productSource;
  } catch {
    productSource = {};
  }
  return {
    products,
    product: product
      ? {
          id: product.id,
          title: product.title,
          handle: product.handle,
          description: productSource.description ?? null,
          imageUrl: productSource.featuredImage?.url ?? null,
          imageAlt: productSource.featuredImage?.altText ?? product.title,
          templateSuffix: productSource.templateSuffix ?? null,
          onlineUrl: `https://${session.shop}/products/${encodeURIComponent(product.handle)}`,
        }
      : null,
    angles:
      product?.experiences.map((experience) => ({
        id: experience.id,
        key: experience.angle?.key ?? "universal",
        label: experience.angle?.label ?? "Universal",
      })) ?? [],
    selected: selected
      ? {
          id: selected.id,
          version: selected.version,
          angle: selected.angle?.label ?? "Universal",
          headline: selected.headline,
          supportingLine: selected.supportingLine,
          benefits: JSON.parse(selected.benefitsJson) as string[],
          proofItems: JSON.parse(selected.proofItemsJson) as string[],
          reassurance: selected.reassurance,
          contentHash: selected.contentHash,
          claims: selected.claims.map((claim) => ({
            text: claim.claimText,
            evidence: claim.evidenceLinks.map(
              (link) => link.evidence.verbatimText,
            ),
          })),
        }
      : null,
    device: url.searchParams.get("device") === "mobile" ? "mobile" : "desktop",
    selectedAngle: selected?.angle?.key ?? (selected ? "universal" : angle),
    selectedExperienceId: selected?.id ?? null,
  };
};

export default function ExperiencePreview() {
  const data = useLoaderData<typeof loader>();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link className={styles.back} to="/app/messages">
            ← Messages
          </Link>
          <p className={styles.eyebrow}>Merchant approval</p>
          <h1>Experience preview</h1>
          <p className={styles.lede}>
            Compare the current catalog source with the exact proposed panel at
            representative desktop and mobile widths.
          </p>
        </div>
      </header>
      <section className={styles.section}>
        <Form className={styles.registrationForm} method="get">
          <label>
            Product
            <select defaultValue={data.product?.id} name="productId">
              {data.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Experience
            <select defaultValue={data.selectedExperienceId ?? ""} name="experienceId">
              {data.angles.map((experience) => (
                <option key={experience.id} value={experience.id}>
                  {experience.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Device
            <select defaultValue={data.device} name="device">
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </label>
          <button className={styles.primaryButton} type="submit">
            Update preview
          </button>
        </Form>
      </section>
      <section className={styles.section}>
        <div className={styles.previewStage} data-device={data.device}>
          {data.selected ? (
            <div className={styles.previewComparison}>
              <article className={styles.previewPage}>
                <p className={styles.step}>Current catalog source</p>
                <div className={styles.previewProduct}>
                  {data.product?.imageUrl ? (
                    <img
                      className={styles.previewProductImage}
                      src={data.product.imageUrl}
                      alt={data.product.imageAlt}
                    />
                  ) : (
                    <div
                      className={styles.previewMedia}
                      aria-label="Product media unavailable"
                    />
                  )}
                  <div>
                    <p className={styles.muted}>Product</p>
                    <h2>{data.product?.title}</h2>
                    <p>
                      {data.product?.description ??
                        "The current product description is unavailable in this source snapshot."}
                    </p>
                    {data.product ? (
                      <a
                        className={styles.secondaryButton}
                        href={data.product.onlineUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open current product page
                      </a>
                    ) : null}
                  </div>
                </div>
              </article>
              <article
                className={`${styles.previewPage} ${styles.previewPanel}`}
                aria-labelledby="adaptive-preview-heading"
              >
                <p className={styles.step}>Proposed panel</p>
                <p className={styles.eyebrow}>{data.selected.angle}</p>
                <h2 id="adaptive-preview-heading">{data.selected.headline}</h2>
                {data.selected.supportingLine ? (
                  <p>{data.selected.supportingLine}</p>
                ) : null}
                <ul>
                  {data.selected.benefits.map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
                {data.selected.proofItems.map((proof) => (
                  <blockquote key={proof}>{proof}</blockquote>
                ))}
                {data.selected.reassurance ? (
                  <p>{data.selected.reassurance}</p>
                ) : null}
              </article>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <h3>No approved experience</h3>
              <p>
                Approve a universal or angle-specific version before previewing
                it.
              </p>
            </div>
          )}
        </div>
      </section>
      {data.selected ? (
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.step}>Evidence trace</p>
              <h2>Exact statements</h2>
            </div>
            <p>
              Version {data.selected.version} · content{" "}
              {data.selected.contentHash.slice(0, 12)}
            </p>
          </div>
          <div className={styles.claimList}>
            {data.selected.claims.map((claim) => (
              <div key={claim.text}>
                <strong>{claim.text}</strong>
                {claim.evidence.map((evidence) => (
                  <blockquote key={evidence}>{evidence}</blockquote>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

import { Form } from "react-router";

import type { AdaptiveApprovedPackage } from "../services/adaptive-package.server";

export function AdaptivePackageReviewPanel(props: {
  package: AdaptiveApprovedPackage;
  reviewId: string;
  reviewStatus: string;
  productId: string;
  busy: boolean;
}) {
  const reviewed = props.package;
  return (
    <article aria-labelledby="adaptive-package-title">
      <p>Exact adaptive package</p>
      <h3 id="adaptive-package-title">Review before approving</h3>
      <p>
        Status: <strong>{props.reviewStatus}</strong>. Coverage: {reviewed.coverage.mappedBundles}/{reviewed.coverage.activeMappings} active mappings have approved bundles; {reviewed.coverage.unmappedMappings} remain unsupported.
      </p>
      <dl>
        <dt>Owner-review protocol</dt><dd><code>{reviewed.reviewPayload.protocolVersion}</code></dd>
        <dt>Package hash</dt><dd><code>{reviewed.packageHash}</code></dd>
        <dt>Mapping snapshot</dt><dd>v{reviewed.bundleSet.snapshot.version} · <code>{reviewed.bundleSet.snapshot.hash}</code></dd>
        <dt>Product source</dt><dd><code>{reviewed.productSourceVersion}</code> · <code>{reviewed.productSourceHash}</code></dd>
      </dl>
      <h4>Registered questions are different</h4>
      <p><strong>{reviewed.reviewPayload.experimentQuestions.ORIGINAL_MATCHED.protocolVersion}</strong>: {reviewed.reviewPayload.experimentQuestions.ORIGINAL_MATCHED.question}</p>
      <p>{reviewed.reviewPayload.experimentQuestions.ORIGINAL_MATCHED.interpretation}</p>
      <p><strong>{reviewed.reviewPayload.experimentQuestions.UNIVERSAL_MATCHED.protocolVersion}</strong>: {reviewed.reviewPayload.experimentQuestions.UNIVERSAL_MATCHED.question}</p>
      <p>{reviewed.reviewPayload.experimentQuestions.UNIVERSAL_MATCHED.interpretation}</p>
      {reviewed.reviewPayload.mappings.map((mapping) => (
        <details key={`${mapping.mappingId}:${mapping.mappingVersion}`} open>
          <summary>{mapping.utmSource} / {mapping.utmCampaign}{mapping.utmContent ? ` / ${mapping.utmContent}` : ""} → {mapping.angleLabel}</summary>
          <p><strong>Exact supplied campaign promise:</strong> {mapping.campaignEvidenceText ?? "Missing — this mapping cannot be approved."}</p>
          <p>Mapping v{mapping.mappingVersion} · <code>{mapping.campaignRef}</code> · bundle v{mapping.bundleVersion} <code>{mapping.bundleId}</code></p>
          <p>Content <code>{mapping.contentHash}</code> · authority <code>{mapping.contentAuthorityHash}</code> · source <code>{mapping.sourceSnapshotHash}</code></p>
          <h4>{mapping.headline}</h4>
          {mapping.supportingLine ? <p>{mapping.supportingLine}</p> : null}
          <ul>{mapping.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul>
          {mapping.proofItems.map((proof) => <blockquote key={proof}>{proof}</blockquote>)}
          {mapping.reassurance ? <p>{mapping.reassurance}</p> : null}
          {mapping.faq.length ? <div><h5>FAQ</h5>{mapping.faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div> : null}
          <details><summary>Evidence trace</summary>{mapping.claims.map((claim) => <p key={`${mapping.bundleId}:${claim.text}`}><strong>{claim.text}</strong> — evidence {claim.evidenceIds.join(", ")}</p>)}</details>
        </details>
      ))}
      {props.reviewStatus === "PENDING" ? (
        <Form method="post">
          <input name="intent" type="hidden" value="approve-adaptive-package" />
          <input name="productId" type="hidden" value={props.productId} />
          <input name="reviewId" type="hidden" value={props.reviewId} />
          <button disabled={props.busy} type="submit">Approve this exact adaptive package</button>
        </Form>
      ) : null}
    </article>
  );
}

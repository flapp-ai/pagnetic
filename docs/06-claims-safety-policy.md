# Adaptive Storefront Claims and Safety Policy

Status: Proposed  
Version: 0.2  
Owners: Product/Legal/Trust  
Applies to: All generated, selected or reordered storefront content

## Purpose

Prevent Adaptive Storefront from inventing, strengthening, mis-scoping or misleadingly presenting merchant claims while allowing approved product information to be reorganized for different acquisition messages.

This policy is a product-control specification, not legal advice. Supported markets and verticals require qualified legal review before public launch.

## Core rule

Adaptive Storefront may change emphasis and order only within an approved evidence boundary.

Every factual statement must be:

- supported by a stored evidence object;
- valid for the exact product, variant, market and locale where served;
- accompanied by any required qualification;
- approved by the merchant;
- immutable and auditable once published.

Evidence that a merchant previously published a statement does not by itself prove that the statement is lawful, current or appropriately substantiated.

## Allowed operations

Subject to evidence and approval, the system may:

- shorten a statement without removing meaning or qualifications;
- simplify language without increasing certainty;
- reorder approved benefits;
- select a verbatim or minimally truncated review;
- select among approved policies or reassurance statements;
- group compatible proof points;
- adapt tone within approved brand-language constraints;
- omit claims that are irrelevant to an acquisition angle.

## Prohibited operations

The system must not:

- invent a fact, statistic, certification, award or testimonial;
- create or materially rewrite a review;
- turn possibility into certainty;
- turn correlation or customer opinion into product efficacy;
- generalize a result beyond the supporting population or product;
- remove a disclaimer, condition, time period or material limitation;
- transform a cosmetic/wellness statement into a disease or treatment claim;
- claim a product is safe for a condition or population without approved evidence;
- imply scientific or clinical support stronger than the source;
- create false urgency, scarcity or inventory statements;
- alter price, discount, shipping, return or guarantee terms;
- present an expired policy or outdated product version;
- combine individually supported statements in a way that creates a new unsupported implied claim;
- rank reviews to fabricate a false picture of typical outcomes;
- target or infer protected identity.

## Pilot exclusions

The first pilot excludes:

- dietary supplements;
- drugs, devices and products marketed for diagnosis, treatment, cure or prevention;
- disease and medical-condition acquisition angles;
- pregnancy, child-safety or other sensitive-population claims;
- weight-loss, sexual-health and mental-health efficacy claims;
- financial, legal or safety-critical products;
- claims requiring evidence the merchant cannot provide for review.

An excluded product cannot be enabled through a normal merchant setting. Override requires recorded legal approval and a new policy version.

## Evidence model

### Evidence object fields

```text
evidence_id
merchant_id
source_type
source_id
source_version
verbatim_text or structured_value
product_scope
variant_scope
market_scope
locale_scope
effective_from
expires_at optional
required_qualifiers[]
substantiation_reference optional
merchant_status
risk_class
captured_at
```

### Source types

- Product or variant field.
- Product metafield.
- Merchant policy.
- Certification record.
- Merchant-supplied substantiation record.
- Supported review with stable identifier.
- Approved brand guideline.
- Manual legal/merchant evidence entry.

### Source precedence

When sources conflict:

1. product/variant-specific approved evidence;
2. current market-specific policy;
3. current merchant-global policy;
4. other merchant content.

Conflicts block generation or approval. The system must not silently choose the more favorable statement.

## Claim record

Every proposed factual statement has:

```text
claim_id
claim_text
claim_type
evidence_ids[]
transformation_type
scope
required_qualifiers[]
risk_class
validation_findings[]
approval_state
```

Claim types include:

- product attribute;
- product benefit;
- performance/efficacy;
- comparative/superlative;
- scientific/clinical;
- certification;
- price/value;
- shipping/returns/guarantee;
- testimonial;
- sensitive or prohibited.

## Risk classes

### Low

Objective, directly verifiable product or policy facts, such as material, size, fragrance-free status when structured evidence exists, or a current return window.

Controls: automated validation plus merchant approval.

### Medium

Benefit language, comparative statements, review selection, environmental language and claims whose meaning depends on presentation.

Controls: automated validation, source-context review and explicit merchant approval.

### High

Clinical/scientific claims, quantified outcomes, safety claims, sensitive populations, health-related efficacy or statements likely to carry implied claims.

Controls: blocked in the pilot. Future support requires legal approval, substantiation review and dedicated templates.

### Prohibited

Disease claims, invented or deceptive claims, fabricated reviews, false scarcity, unsupported guarantees and protected-identity targeting.

Controls: cannot be saved as publishable content.

## Transformation validation

Validation compares source and output for:

- entities and product identity;
- numbers, units and time periods;
- modality: may, helps, proven, guarantees;
- population and use conditions;
- comparative reference class;
- negation;
- disclaimers and qualifications;
- scientific evidence level;
- policy effective dates;
- composite implied meaning.

Deterministic checks should validate exact numbers, dates, certifications and policy terms. Model-based safety review may flag semantic risk but cannot be the only enforcement mechanism.

## Reviews and testimonials

Adaptive Storefront may retrieve real supported reviews; it may not create testimonials.

Requirements:

- preserve review ID, source, rating, date and verified-purchase status when supplied;
- show the review verbatim except for clearly marked length truncation;
- never splice separate review passages together;
- do not correct meaning-bearing grammar or wording;
- exclude reviews with prohibited claims from adaptive proof;
- preserve disclosures or incentives associated with the review;
- prevent repeated selection from creating a misleading impression of typical results;
- retain a link or trace to the source record.

Review relevance is not sufficient for eligibility. Every selected testimonial is evaluated for express and implied product claims.

## Policies and reassurance

Shipping, return, guarantee and certification messages must come from structured, current evidence.

The statement must respect:

- market and customer eligibility;
- product or category exclusions;
- minimum spend;
- timing and carrier limitations;
- return condition and window;
- effective and expiry dates.

For example, “Free shipping over $50” is invalid if the selected market has a different threshold or the product is excluded.

## Generation pipeline controls

1. Snapshot merchant sources.
2. Extract proposed evidence objects.
3. Validate scope, conflicts and expiry.
4. Generate structured claims and bundle text.
5. Run deterministic comparison checks.
6. Run semantic/implied-claim review.
7. Assign risk class.
8. Require merchant review.
9. Publish immutable version.
10. Monitor source changes and serving scope.

The production renderer accepts only immutable versions with status `approved_active`.

## Merchant approval

Approval UI must show:

- final text as it will appear;
- supporting source text/value;
- transformations performed;
- scope and required qualifications;
- risk classification;
- preview within the complete panel, not only isolated sentences.

Approval records:

```text
approver
merchant account
timestamp
content hash
evidence snapshot
policy version
```

Changing any displayed content, evidence, qualifier or scope invalidates approval.

## Source updates and staleness

When a source changes:

- identify every dependent claim and experience;
- compare whether the approved meaning remains supported;
- mark affected versions `stale_review_required` when material;
- prevent new assignments to invalid or expired content;
- serve original when no valid approved replacement exists;
- notify the merchant and record the event.

Do not silently regenerate and publish content.

## Runtime enforcement

Before returning an experience, validate:

- merchant and product match;
- variant applicability where relevant;
- market and locale scope;
- experience approval status;
- evidence validity and expiry;
- active policy version;
- kill-switch state.

Any failure resolves to original. Runtime never relaxes scope to increase match coverage.

## Monitoring

Monitor:

- content served outside approved scope;
- expired or stale evidence;
- approval/content hash mismatch;
- missing required qualifiers;
- review-source deletion;
- policy changes;
- merchant complaints and shopper reports;
- unusually concentrated review selection;
- generation validation failure patterns.

## Incident levels

### Severity 1

Potentially harmful, prohibited, cross-merchant or materially deceptive content is live.

Response:

- disable affected merchant or global serving immediately;
- preserve evidence and audit records;
- notify incident owners and merchant;
- assess shopper exposure;
- require formal approval before restoration.

### Severity 2

Unsupported or stale claim with limited risk, incorrect scope or missing qualification.

Response:

- disable affected experience;
- serve original;
- notify merchant;
- correct and reapprove as a new version.

### Severity 3

Stylistic, formatting or relevance issue that does not change factual meaning.

Response:

- queue correction;
- reapprove if displayed content changes;
- monitor for recurrence.

## Responsibility model

Before pilot launch, merchant agreements and product UI must clearly state:

- merchant responsibility for truthfulness and ownership of supplied evidence;
- Adaptive Storefront responsibility for enforcing published controls;
- who can approve content;
- incident notification and takedown rights;
- retention and audit access;
- prohibited categories and use cases.

Merchant approval does not authorize the system to bypass platform policy or applicable law.

## Audit requirements

For every rendered version, the company must be able to reconstruct:

- exact displayed text;
- product, market and locale;
- evidence and source snapshot;
- transformation and generation metadata;
- validation findings;
- approver and approval time;
- experiment and mapping version;
- activation and retirement times.

Audit records must be protected from ordinary content editing.

## References

- [FTC Health Products Compliance Guidance](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance)
- [FTC advertisement endorsements](https://www.ftc.gov/news-events/topics/truth-advertising/advertisement-endorsements)
- [FTC Consumer Reviews and Testimonials Rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)
- [FDA structure/function claims](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/structurefunction-claims)
- [FDA dietary supplement claims guide](https://www.fda.gov/food/dietary-supplements-guidance-documents-regulatory-information/dietary-supplement-labeling-guide-chapter-vi-claims)

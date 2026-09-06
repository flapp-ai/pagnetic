# Pagnetic Adaptive Storefront — proposed product PRD

Date: 2026-09-06  
Status: Implementation-ready proposal; not implemented or launch-approved.  
Companions: [current-state assessment](./61-built-vs-required-assessment.md), [execution backlog](./62-adaptive-storefront-execution-plan.md).

## 1. Authority and purpose

This document records the latest conversation direction: real-time adaptive ecommerce experiences, with campaign intent as the first reliable signal. It replaces generic copy improvement as the proposed customer-facing product focus. It does not alter production, approved content, billing, privacy permissions, or any registered experiment. Document24 remains the implemented v2 contract until a versioned successor is built and verified. Existing claims, financial, privacy, recovery and release requirements continue to apply.

Update 2026-09-06: the owner authorized development by Luna with Astra milestone oversight. AP-00 through AP-06 code-controlled preparation is approved; this is not permission for new charges, live treatment, legal approvals or public launch. See docs63–64 for execution and evidence. Requirements remain unimplemented until verified.

## 2. Product value and competitive hypothesis

Pagnetic turns a Shopify store into an adaptive salesperson: it selects the relevant benefits, evidence and reassurance for why a shopper arrived, and measures whether that experience improves sales.

The page adapts without requiring shoppers to open a chatbot. This is a proposed experience distinction, not an exclusive feature claim. Highest-priority bets: one clear ad-to-page problem, meaningful selling stories, low merchant effort, qualified traffic and actual paid repeat use. More algorithms, platforms or chat features must not delay validating this path.

Long-term vision: context-aware selling experiences that improve from outcomes. Initial sellable release: campaign-aware adaptation of one product's approved experience on the existing storefront. These are different horizons, not different businesses.

Target: paid-acquisition-driven Shopify brands with a few important products, multiple meaningful campaign promises, sufficient eligible traffic, and no dedicated conversion-optimization team. Start with one lower-claim-risk category, provisionally travel bags/accessories; validate category choice with merchants. Qualify on selected-product traffic, source quality and campaign stability, not GMV alone.

Hypothesis: lower setup and recurring operating effort, coherent evidence-backed experiences and honest measurement can win a focused Shopify segment. Neither AI copy, native integration, ad matching nor experimentation is independently unique. No merchant demand, willingness to pay or causal uplift is established by this document.

## 3. Scope by horizon

| Horizon | Included | Exit condition |
| --- | --- | --- |
| A: campaign-adaptive pilot | Shopify, English, one hero product, two or three meaningful approved campaign angles, one composite panel, deterministic matching, randomized measurement, manually supplied ad evidence | Governed end-to-end test passes and qualified merchants activate/use it |
| B: repeatable launch product | Recurring campaign maintenance, simple coverage/results UI, bounded paid evaluation, operational launch gates and supported multi-store deployment | Paid continuation and sustainable support effort; public distribution approved |
| C: behavioral adaptation | Small consented behavioral vocabulary, shadow evaluation then separate governed trial; optional single ad-platform connector selected by demand | Incremental value beyond campaign-only policy with safe performance/privacy |
| D: broader adaptive storefront | Additional placements/products/platform adapters; learned policies only after enough trustworthy outcomes | Repeated commercial evidence and explicit scope approval |

Horizon A must not be marketed as individual psychological inference, whole-page generation, autonomous learning or compatibility with every theme. Source-bound campaign matching is contextual personalization, not a claim to know a shopper's identity.

## 4. Merchant and shopper experience

Merchant flow: product + actual ads → contextual preview → approve package → enable Shopify block/check campaign links → see status and results.

1. Preview accepts a product and up to three exact ad messages with stable campaign references. For image/video-led promises, accept a merchant-supplied transcript/description and approved supporting asset references; do not claim automatic video understanding.
2. Show each ad beside its proposed product-page experience, with original comparison, mobile preview and expandable evidence. Explain unsupported promises and ask for evidence rather than fabricating a variant.
3. Allow bounded editing and approval of the exact bundle set, mappings and experiment policy. Editing invalidates the affected approval. Theme activation remains an explicit Shopify action.
4. Check actual link propagation and supported theme/consent/runtime behavior before launch. Technical calibration is explained simply, not hidden as an instant-sales promise.
5. Home states: Preparing, Needs approval, Ready to activate, Checking measurement, Adapting and measuring, Result ready, Needs attention, Paused. Show one primary action and preserve accessible history.
6. Results show observed sales separately from estimated incremental sales, uncertainty, population/window and negative/inconclusive states. Before maturity, show coverage and operation rather than a fabricated earnings counter.

Example: the same backpack can emphasize low weight for a travel-light campaign, compartment organization for commuting, or substantiated material/warranty evidence for durability. Price, inventory, checkout and product truth remain identical. No unsupported airline-size or durability claim may be invented.

## 5. Functional requirements and acceptance

### AS-01 — Campaign evidence and mappings (A)

- Store tenant/product-scoped campaign reference, exact ad evidence, source/version/hash, locale, approval state, angle and optional approved media reference.
- Generate candidate angles from supported campaign promises; do not force Comfort/Performance/Value labels.
- Use existing approved URL parameters where possible; otherwise supply explicit campaign links. Preserve unrelated URL parameters. Do not infer an ad promise from opaque click IDs or UTM names.
- Match only a single valid approved mapping in the correct tenant/product/locale/version. Ambiguous, expired or unknown mappings use the registered default; conflicts never select arbitrarily.
- Acceptance: two campaigns for one product resolve to different approved bundles; unknown, duplicated, cross-tenant, changed and revoked references safely fall back. URL helpers never publish ad changes themselves.

### AS-02 — Coherent approved experience bundles (A)

- Version headline, two-to-four benefits, optional genuine proof, optional reassurance and bounded FAQ. Every factual statement links to eligible evidence for this product and locale.
- Reviews retain attribution/context and qualifications; no synthetic testimonials. A product fact can supply proof when reviews are unavailable. Abstain if evidence cannot support distinct experiences.
- Model-generated candidates are prepared offline, schema-validated and reviewed. Deterministic composition remains a fallback. No model request in the page-rendering path.
- Acceptance: at least two materially different, human-approved selling stories in a qualified fixture; all statements trace to evidence; duplicate/reordered-only variants are rejected as insufficient differentiation.

### AS-03 — Versioned contextual runtime (A)

- Introduce a separately versioned deployment/decision contract capable of an approved bundle set plus mapping snapshot, rather than the v2 single-content pointer.
- Resolve consent, active authority and sticky experiment assignment before selecting content according to the assigned policy. A control visitor must never receive contextual treatment.
- Record policy version, arm, bundle ID/hash, mapping version, reason, deployment revision and consent version. Keep identity pseudonymous, tenant-scoped and subject to existing suppression/erasure rules.
- Failed validation, timeout, revoked consent, kill switch or unavailable approved content leaves the original storefront usable. Approved data only; no executable generated HTML/JS.
- Acceptance: replay produces the same authorized decision; changed authority invalidates caches; no campaign causes cross-arm movement or cross-tenant content leakage; old v2 deployments remain readable and behaviorally unchanged.

### AS-04 — Supported rendering (A)

- Extend the current composite block to render proof and bounded FAQ accessibly; begin with text and existing approved assets, not a new full-page builder.
- Retain stable layout and purchase controls. Do not overwrite price, inventory, checkout, native product identifiers or unsupported theme DOM.
- Set a tested theme/placement support list. A buried or visually ineffective panel is not acceptable merely because it renders.
- Acceptance: keyboard and screen-reader checks, mobile/desktop and supported browser checks, malicious-content rejection, original fallback, and before/after performance measurements. Freeze explicit latency/layout budgets in the new runtime contract before implementation acceptance; do not reuse incomparable legacy latency measurements.

### AS-05 — Direct policy experiments (A)

- Primary analysis includes every randomized eligible visitor by assigned policy, including those who never engage with the panel. Freeze eligibility using pre-treatment information; do not exclude treatment failures after assignment. Engaged-user conversion is diagnostic, not causal uplift evidence.

- Create new protocol registrations; never rewrite existing v1/v2 registrations or approvals. Calibration remains required, but do not make a Universal win a prerequisite for contextual access.
- Commercial policy test: Original versus campaign-matched bundle policy. Personalization-specific test: one strong Universal bundle versus campaign-matched policy. Report these as different questions. The first cannot prove matching itself caused a win.
- Use visitor-sticky 50/50 assignment, campaign balance monitoring and policy-level analysis. Predefine eligibility, campaign weighting/strata, sample target, minimum/maximum duration, outcome/refund maturity and stopping rules. Do not treat traffic from different campaigns as randomized comparison groups.
- Preserve net selected-product merchandise revenue per assigned eligible visitor and existing deterministic order/refund reconciliation. Report storewide revenue only as a separately defined measure; do not call net sales profit.
- Unknown campaign handling and returning visitor/campaign-change handling are frozen in the protocol. Default proposal: unknown traffic receives Original and is outside the eligible matching experiment; known visitors keep their arm, and approved mapping selection on later visits remains part of the frozen policy.
- Acceptance: calibration/simulation plus integration tests cover null effects, missing events, cross-campaign revisits, refunds, sparse strata, expiry, negative outcomes, fixed maximum duration and inconclusive reporting. No early automatic winner selection or live mutation of content during an experiment.

### AS-06 — Campaign coverage and recurring operation (A/B)

- Show recognized eligible visits, unmatched/ambiguous visits, mapped campaign count, unsupported promises and measurement health. State the denominator and missing-data limits; do not imply complete ad-spend coverage without a verified ad connector.
- Detect supplied source/product changes, mark affected proposals stale and queue review. An unconnected ad account cannot be automatically monitored: provide a simple add/update-ad workflow and state that limitation.
- Approved updates create a new deployment and, where material, a new experiment. Never silently replace an active test's approved bundle.
- Acceptance: source drift prevents stale serving, prompts one deduplicated action and preserves prior evidence. A second campaign can be added through a supported repeat workflow without an operator database edit.

### AS-07 — Onboarding and economics (B)

- Free preview, qualified bounded evaluation, then transparent subscription for ongoing adaptation. Proposed $99/month is a willingness-to-pay test, not an approved live price.
- No free-until-positive guarantee, percentage-of-unverified-lift charge, guaranteed result date or unlimited-support promise.
- Measure preview → approval → activation → repeat campaign → paid continuation, active merchant time, operator time and infrastructure/model cost per store.
- Acceptance: authorized billing config, accurate trial/expiry/cancellation behavior and no silent charge. Copy and entitlement rules must reconcile with the older founding-beta offer before publication.

### AS-08 — Platform boundary (A/C/D)

- Keep the current modular application; define internal contracts for catalog/evidence, storefront capability, context, decision and financial outcomes. Shopify IDs and SDK calls stay within adapters where practical.
- Do not build WooCommerce/BigCommerce implementations now or claim platform neutrality is already complete. A second adapter must preserve platform-specific consent and financial semantics, not merely translate IDs.
- Acceptance: policy-selection unit tests run without Shopify network calls; unsupported capabilities fail explicitly. No distributed-services rewrite or new ranking infrastructure is needed for A.

### AS-09 — Behavioral personalization (C, explicitly not A launch scope)

- Later, offer an optional skippable question such as "What will you use this for?" when context is unclear. Map explicit approved answers to supported experiences, not inferred identity. Define consent, persistence, expiry/reset and stable UX before implementation. No question/chat is required for campaign-first launch.

- Proposed signals: product comparison, explicitly selected use case and bounded category/product interactions. Never infer sensitive identity or treat hesitation/scrolling as certain intent.
- Before collecting: freeze signal vocabulary, purpose/consent, retention, erasure and no-PII rules. Evaluate a deterministic candidate policy in shadow before any serving experiment.
- Avoid moving purchase controls or repeatedly changing a page while it is being read. Any within-page change needs a separately approved stable interaction design; initial behavioral decisions may apply only on the next navigation.
- Acceptance: consent revocation clears behavior state; no pre-consent signal collection; negative feedback and weak signals fall back; experiment compares behavior-plus-campaign with campaign-only. Learned bandits require separate statistical design and outcome sufficiency.

## 6. Proposed contracts and migration

Reuse SourceDocument/EvidenceObject, AcquisitionAngle, CampaignMapping, ExperienceVersion, approvals, assignments, decisions, jobs/outbox, ledgers and privacy infrastructure. Do not duplicate these tables by default.

Design before migration: a versioned approved bundle-set payload; campaign evidence provenance; mapping-set hash; policy/selection reason; diagnostic coverage aggregates; owner review/change receipt. Proof/FAQ additions need schema, validation, evidence and renderer changes together. Existing proofItemsJson alone is not v2 rendering support.

Illustrative next decision response fields: schemaVersion, deploymentRevision, experimentId, assignmentId, assignedPolicy, selectedBundleId, bundleHash, mappingVersion, reason, expiresAt and validated content. The exact version identifier is reserved during AS-03; do not rename v2 behavior in place.

Migration rules: additive SQLite and PostgreSQL tracks; populated legacy fixtures; explicit selected-store cutover; fresh approvals for new content/contracts; rollback to original under existing recovery controls. No direct mutation of active registrations. Do not enable legacy matching as an unreviewed shortcut around new financial/privacy contracts.

## 7. Non-goals and safety

Before building overlapping agent functionality, perform a bounded reuse assessment of [Anthropic's blueprint](https://github.com/anthropics/commerce-agents) and [engineering guide](https://claude.com/blog/the-anatomy-of-effective-commerce-agents). Record adopt/reject reasons against licensing, maintenance, authorization, privacy, latency and cost. Adoption is optional: no new chatbot, service, provider lock-in or rewrite merely to reuse a reference. Vendor lift claims are not Pagnetic acceptance targets. Existing safeguards remain mandatory.

No whole-page-per-request generation, automatic discounts/pricing, autonomous checkout, fabricated proof, sensitive profiling, cross-store training, chat sales agent, recommendation catalog engine, custom foundation model, broad theme adapters, or additional commerce platform at initial launch.

Keep tenant isolation, source validation, consent, signed references, idempotency, fraud/test-order exclusion, privacy workflows, rollback, backup and recovery. New signals/content must pass these boundaries. Engineering quality is necessary but not proof of product value.

## 8. Launch and learning gates

Engineering: current source-bound checks plus all AS-A scenarios, supported theme/browser QA, financial lifecycle, consent and fallback evidence. Preserve scoped evidence rather than blanket PASS.

Operational: alert sending/delivery, approved legal identity/terms, independent recovery, applicable Shopify distribution/data approvals and a declared supported storage/capacity boundary. Latest saved live evidence is doc59, not a fresh verification by this PRD task.

Commercial discovery: five qualified pilots, aim for less than 20 minutes active merchant setup and a usable preview in the first session. These are internal targets, not industry benchmarks or current results. Record whether at least three request continued paid use; actual paid repeat use is stronger than stated intent. Five stores do not prove PMF or statistically prove lift.

Scientific: each merchant needs a prospective traffic/power assessment; no universal 30-day result promise or arbitrary 5% guaranteed win. A matching-specific claim requires matched-versus-Universal evidence. If informative tests do not support incremental matching value, revisit the thesis rather than add unsupported sophistication.

## 9. Research context (checked in the conversation on 2026-09-06)

- [Kinect, YC Spring2026](https://www.ycombinator.com/companies/kinect): adaptive product pages and AI selling; direct positioning overlap.
- [Spangle](https://www.spangle.ai/) and [Madrona investment perspective](https://www.madrona.com/agentic-brand-experience-at-scale-spangle-ais-series-a/): contextual commerce experiences and ongoing optimization.
- [FERMAT dynamic product pages](https://www.fermatcommerce.com/product/dynamic-product-pages): adaptive merchandising and experimentation.
- [Sequen funding/product announcement](https://www.businesswire.com/news/home/20260317105541/en/Sequen-Raises-%2416M-Series-A-to-Bring-Sub-second-In-session-Personalization-to-Enterprise-Consumer-Companies): in-session ranking infrastructure.

These primary descriptions establish competing approaches and investor interest, not independent causal efficacy, merchant satisfaction, or Pagnetic's differentiation.

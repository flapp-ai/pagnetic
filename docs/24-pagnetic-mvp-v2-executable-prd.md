# Pagnetic MVP v2 — executable product requirements

Development update (2026-09-06): the owner authorized the adaptive scope in [doc60](./60-adaptive-storefront-prd.md), with Luna implementing under [doc63](./63-luna-development-brief.md) and milestones tracked in [doc64](./64-adaptive-development-status.md). Earlier contracts and verification below remain historical/implemented baselines, not evidence that the new scope is built. New protocol changes must be versioned and reviewed; no active registrations or production authority change through this notice.

Version: 1.0  
Date: 2026-09-05  
Owner: Flapp Bilişim A.Ş.  
Implementer: Sol  
Status: implementation specification requested by the owner; new commercial offers and external vendor spending are not approved by this document  
Repository: `/Users/erenyigit/Documents/ChatGPT/ecommerce ai`  
Start here: [Sol execution brief](./25-sol-execution-brief.md)

## 0. How to use this PRD

This is the execution baseline for resolving the [audit](./21-astra-market-and-product-audit.md), implementing the [customer experience](./22-pagnetic-value-and-experience-prd.md), and completing the [improvement plan](./23-pagnetic-improvement-execution-plan.md). MUST means required for its stated release gate. SHOULD permits a documented equivalent implementation. Deferred means do not build for this release.

This document resolves the earlier proposals into implementation decisions. For new MVP-v2 work, it takes precedence over proposed behavior in documents 19, 22 and 23 where explicitly stated. Existing experiment registrations, content approvals, merchant offers and production evidence are immutable historical authority. Never apply a new metric, threshold, eligibility rule or commercial term retroactively.

Implementation is complete only when the required behavior has evidence. A state transition in a mocked database does not establish that Shopify shoppers received the new policy. An automated test count is not evidence of product-market fit.

Produce and maintain `docs/26-mvp-v2-implementation-status.md` during implementation. For each requirement record NOT_STARTED / IN_PROGRESS / VERIFIED / BLOCKED_EXTERNAL, changed paths, test evidence, migration/release version and any external dependency. Do not mark blocked functionality complete because an adapter or placeholder exists.

## 1. Objective and customer value

**Value proposition:** Turn your best ad promise into a clearer product page—and measure whether it sells more.

The customer is an established Shopify merchant or its growth operator with a stable hero product, meaningful eligible traffic and supportable product facts. The job is to improve the buying message without becoming a testing-platform operator.

The app MUST deliver three distinct forms of value:

1. Before installation: a concrete product-message diagnosis and source-backed proposed change; no claimed monetary lift.
2. After a qualified test: an experimental estimate for sales of the selected product, with scope, dates and uncertainty.
3. After a decision: keep the approved message, stop it, or evaluate a genuinely different next opportunity. A completed test must not be the end of the product workflow.

Merchant-facing default sequence: **Review → Save in Shopify → Receive a decision**. Catalog syncing, identity, attribution, registration, validation, maturation and deployment versions remain system responsibilities.

No guaranteed uplift, profit claim, fixed result date without evidence, or artificial revenue counter is allowed. Public positioning must accurately reflect whether a feature is enabled and qualified.

## 2. Release scope and fixed decisions

| Decision | MVP-v2 choice | Reason / boundary |
| --- | --- | --- |
| Surface | Shopify Online Store, one hero product and one app block | Reuses current integration and bounds checkout QA |
| Active experiments | One effect experiment per merchant; one active deployment pointer per product | Prevents unmodeled overlap and attribution ambiguity |
| Language | English customer content and UI initially | Other languages get explicit unsupported status; strings remain localizable |
| Reporting currency | One frozen shop currency per experiment; initial allowlist USD, EUR, GBP, TRY, ILS | All use two decimal minor units; no runtime FX. Additional currencies need reviewed exponent/money tests |
| Assignment | Consented, persistent anonymous visitor; 50/50 fixed allocation | No pooled visitor/session fallback for v2 |
| Primary metric | Net selected-product merchandise sales per eligible assigned visitor | Precisely scoped revenue and stable denominator; not total-store revenue or profit |
| Secondary metric | Net selected-product sales per eligible session, visitor-clustered | Retains RPS diagnostic; cannot replace primary after launch |
| Experiment sequence | Instrumentation A/A, then Original vs Universal; optional separately approved Universal vs Matched | Proves improvement before claiming matching's incremental benefit |
| Runtime authority | Product-scoped server deployment pointer; no merchant experiment-ID entry | One theme save can survive all lifecycle changes |
| Content generation | Deterministic sourced extraction/composition first; optional offline generator interface | No new model account or data transmission required to implement a useful baseline |
| Campaign input | Optional pasted ad copy and explicit mapping/link | No Meta/Google account connector or automatic ad changes in this release |
| Billing | Existing offers preserved, billing off until approved configuration; implement Shopify App Pricing integration | A result cannot authorize a charge |
| Hosting | Keep Fly application hosting and modular monolith | No AWS/Azure/GCP rewrite |
| Database | Single supervised test/pilot writer while SQLite; managed PostgreSQL before multiple unattended live stores | Store count alone is not a capacity guarantee |

### Explicit change from earlier measurement drafts

New registrations use `FOCAL_NET_REVENUE_PER_ASSIGNED_VISITOR_V2` as the primary endpoint. Earlier documents prioritized RPS and sometimes implied whole-store revenue. This change makes the product's first causal claim narrower and implementable; display it honestly. Existing RPS experiments retain their original metric and cannot be migrated in place. If the business later requires whole-store incremental revenue, implement and validate cohort-level linkage for purchases across products as a separate protocol version.

### Required vs deferred

Required: audit repairs A01–A18; complete supported merchant journey; exact sources and real preview; feasibility calculator; outcome and money semantics; keep/revise/stop; billing lifecycle integration; operational evidence; launch gates.

Deferred: automatic ad ingestion, unlimited products, visual page builder, pricing/discount changes, checkout changes, image generation, subscriptions/selling plans, headless/vintage themes, contextual bandits, cross-store model training, performance fees, multi-currency analysis, agency portfolio UI and a native Shopify Rollouts integration.

An unsupported path MUST be visible during qualification. It must never pass through an internal override meant for disposable test stores.

## 3. Requirements and traceability

| Requirement | Required outcome | Audit / workstream |
| --- | --- | --- |
| R01 | Source-grounded diagnosis, useful and distinct proposed change | A11/A12, E07 |
| R02 | Baseline identity, real exposure window and feasible forecast | A08/A12/A13, E04/E05 |
| R03 | Exact review, edit, approval and selected-template enablement | A09/A18, E08 |
| R04 | Server-controlled deployment lifecycle | A01, E01 |
| R05 | Immutable experiment, unit and cohort policy | A02–A04/A07, E02/E04 |
| R06 | Idempotent financial ledger and eligible attribution | A05/A06/A14, E03 |
| R07 | Calibrated analysis and reproducible report | A02–A08, E02/E10 |
| R08 | One accurate status and working next action | A09, E09 |
| R09 | Keep/revise/stop and continued approved serving | A10, E11 |
| R10 | Verified subscription lifecycle, separate from test result | A10, E14 |
| R11 | Durable jobs, alerts, backups and bounded workload | A15/A16, E12/E13 |
| R12 | Consent, tenant isolation, privacy and safe client evidence | A07/A17, E04/E06 |
| R13 | Browser-backed supported-theme/commerce proof | A01/A14/A18, E06 |
| R14 | Release traceability and market learning instrumentation | A08–A10/A15/A16, E14 |

## 4. Domain model and invariants

Reuse existing `Merchant`, `Product`, `EvidenceObject`, content versions, approval, experiment, assignment, notices and audit structures. Extend them rather than building a parallel app. New names below are logical models; physical table names may differ if all contracts and migration mappings are documented.

All business records MUST be tenant-scoped. A globally unique ID is not a substitute for checking `merchantId`. Use compound relations/constraints where practical and transactional tenant checks everywhere else. Verify both SQLite and PostgreSQL implementations of uniqueness and leases.

| Model | Minimum fields | Constraints / indexes |
| --- | --- | --- |
| `MessageDiagnosis` | id, merchantId nullable before install, productRef, sourceVersion, adEvidenceRef?, mode CLARITY/CAMPAIGN, gapType, rationale, sourceSpans, status, rulesVersion, createdAt | Public previews use a separate opaque lookup; never query another tenant's diagnosis |
| `QualificationSnapshot` | merchantId, productId, observationStart/End, dataSource, eligibleVisitors, eligibleSessions, paidPurchasers, revenueMean/Variance, currency, coverage, targetEffect, targetVisitors, forecastRange, status, version | Immutable; index merchant/product/createdAt |
| `DeploymentVersion` | id, merchantId, productId, planId, revision, policy, contentSetHash, experimentId?, state, approvedAuthorityHash, createdAt | Immutable configuration; unique merchant/product/revision |
| `ActiveDeployment` | merchantId, productId, deploymentVersionId, revision, updatedAt | Unique merchant/product; compare-and-swap revision |
| `ExperimentLifecycle` or Experiment fields | enrollmentStart/Close, attributionClose, financialMaturityAt, finalizedAt, stopReason, lifecycleVersion | None of these dates are inferred from UI state; final cohort dates immutable after close |
| `AssignmentV2` or Assignment fields | experimentId, visitorHash, assignedAt, expiresAt, arm, eligibilityVersion, consentPolicyVersion | Unique experiment/visitorHash; no renewed attribution window on repeat visit |
| `VisitorOutcome` projection | merchantId, experimentId, assignmentId, eligibleSessionCount, netFocalRevenueMinor, paidOrders, sourceWatermark | Unique experiment/assignment; derived/rebuildable from ledger, includes zero outcomes |
| `WebhookInbox` | merchantId, Shopify event ID, topic, sourceOccurredAt?, receivedAt, sanitized payload/encrypted restricted source, processingState, attempts | Unique merchant/event ID; index processingState/nextAttemptAt; receipt precedes acknowledgment |
| `OrderLedger` + line items | merchantId, Shopify order/line IDs, product/variant IDs, paymentState, sourceUpdatedAt, shopCurrency, merchandiseAfterDiscountMinor, test, cancellation, reconciliationState | Unique merchant/order and merchant/order/line; immutable received facts plus canonical projection |
| `RefundLedger` | merchantId, Shopify refund/transaction/line IDs, orderRef, amountMinor, currency, source timestamps, allocation status | Duplicate transactions/lines deduped; can exist before canonical order |
| `AttributionV2` | orderLineId, assignmentId, experimentId, joinMethod, signedRefHash?, validAt, reason, status | One line credited at most once across incompatible cohorts; reassociation requires audited deterministic correction |
| `QaEvidence` | merchant/product/theme/template/deployment IDs, checkKey, status, applicability, capturedAt, verifiedBy, evidenceRef, expiresAt | Evidence is per check/version, not one shared text field |
| `Job` / `Outbox` | merchantId, type, idempotencyKey, payloadSchemaVersion, status, attempts, nextRunAt, leaseToken/Until, resultRef?, lastErrorCode | Unique scoped idempotency key; index runnable time and lease expiry |
| `SubscriptionState` | merchantId, external subscription identity, offerVersion, authoritativeStatus, verifiedAt, periodEnd?, cancellationAt? | Server verified; never populated from redirect state alone |
| `ActionReceipt` | merchantId, actor, action, idempotencyKey, inputHash, responseRef, createdAt | Same key + different input is conflict; exact retry replays prior result |

Money is integer minor units. PostgreSQL may use BIGINT; serialize API money as base-10 strings, never JSON BigInt. SQLite operations must remain within safe integer bounds; reject amounts outside supported bounds. Source decimal values are parsed with decimal arithmetic and currency exponent, never `Number(amount) * 100` rounding. Analysis may use floating point only after bounded conversion of the already exact ledger.

Every immutable snapshot hashes canonical sorted JSON with an explicit schema version. Do not hash unordered object/DB iteration output. Store canonical payload plus hash so it remains reviewable.

## 5. Deployment and runtime contract — R04/R12

### 5.1 Normal storefront path

The app block MUST carry product and block context, with `mode=autopilot` for v2. Existing legacy settings remain backward compatible for existing QA deployments until explicitly migrated. Runtime policy/experiment ID/proxy-path fields must not appear in the ordinary merchant workflow.

Sequence:

1. Read Shopify consent state; if loading/unknown/denied, use Original with no analytics identity or measured assignment.
2. Once analytics and preferences are both allowed, create/read a shop-scoped random visitor token with a fixed 90-day expiry from creation, and a session ID (30-minute inactivity boundary). Do not silently renew that expiry. Do not infer identity from email/customer ID/fingerprinting. Token loss/expiry cannot be repaired through fingerprinting; disclose this identity limitation and track consented storage failures without reconstructing people.
3. Send product, visitor/session token, consent-policy version, approved campaign reference and request ID through authenticated Shopify app proxy.
4. Resolve merchant from verified Shopify proxy context, product within merchant, active deployment, content authority and experiment status.
5. Validate eligibility before assignment. Assign once using server-held experiment salt and HMAC bucket; persist assignment and first decision atomically before exposure.
6. Return the exact deployment/experiment/content revisions and signed measurement reference. Client renders only a supported schema and current response.
7. Send render and subsequent commerce events with bounded signed context; reconcile sales through verified Shopify financial facts.

Shopify allows one proxy root and proxies child paths; use the existing `/apps/adaptive-storefront` root, mapped to `/storefront/experience`, rather than introducing a second configured root. App proxies strip `Set-Cookie`, so the architecture cannot rely on setting visitor cookies through the proxy response. [Official proxy documentation](https://shopify.dev/docs/apps/build/online-store/app-proxies).

Use POST on a versioned child route for identity-bearing requests where the verified current Shopify proxy transport supports it. Add a transport integration test before release. Do not put visitor tokens into logging, monitoring or external telemetry URLs. If the installed proxy transport cannot carry the contract, record an adapter blocker; do not silently downgrade privacy behavior.

### 5.2 API shape

Logical app route: `POST /storefront/experience/v2/decision`; Shopify-facing child route: `/apps/adaptive-storefront/v2/decision`.

```ts
type ApprovedPanelV2 = {
  schemaVersion: 2;
  contentVersionId: string;
  contentHash: string;
  headline: string;
  benefits: Array<{ text: string; evidenceIds: string[] }>;
  reassurance: { text: string; evidenceIds: string[] } | null;
  headlineEvidenceIds: string[];
};
type DecisionRequestV2 = {
  schemaVersion: 2;
  requestId: string;           // random opaque ID; unique per page/product attempt
  productId: string;           // canonical Shopify product GID
  visitorToken: string;        // random opaque token; never a customer identifier
  sessionId: string;
  consent: { analytics: true; preferences: true; policyVersion: string };
  campaignRef?: string;        // approved reference, not arbitrary content
  blockVersion: string;
};
type DecisionResponseV2 = {
  schemaVersion: 2;
  serving: "ORIGINAL" | "UNIVERSAL" | "MATCHED";
  reason: string;              // enum, no stack/error text
  deploymentId: string | null;
  deploymentRevision: number | null;
  experimentId: string | null;
  assignmentId: string | null;
  decisionId: string | null;
  measurementReference: string | null;
  expiresAt: string | null;
  content: ApprovedPanelV2 | null;
};
```

Bound request at 8 KiB, opaque fields at 160 chars and campaignRef at 128. Reject unknown schema, malformed IDs and unauthorized merchant/product combinations. Idempotent retries of one request return the original assignment/decision, with no duplicated observation. Same request ID with different material input is 409.

Panel strings are plain text, never executable HTML. Headline ≤160 characters, each of 2–4 benefits ≤220 characters, optional reassurance ≤220 characters; each factual element requires at least one valid scoped evidence ID. These are v2 copy limits, not a mandate to fabricate enough facts. Insufficient supported material produces an abstention. Render through escaped text nodes and reject unsupported response schemas. Merchant preview uses this same schema and renderer.

Fallback is a successful explicit Original response where possible. Authentication/malformed input gets 401/400; capacity gets 429 with Retry-After. The client always retains usable Original on non-success. A client timeout must never remove native purchase controls. Stale/out-of-order responses from earlier product requests cannot replace current content.

Signed measurement reference binds merchant, product, deployment, experiment, assignment, decision, issuedAt and expiresAt. It is a tamper-evident context, not proof a shopper is human or a sale happened. Verify signature, TTL and referenced tenant records before accepting it. Expiry is not extended by replay. A client-visible pixel key is not sufficient authority to create financial facts.

TTL for a new browser event is checked at receipt with the permitted event-time skew frozen in the event schema (initially 5 minutes). Financial replay is different: verify the signature and canonical Shopify `order.createdAt` against the original assignment window, not against the webhook's late delivery time. An in-window purchase does not become out of window because Shopify retries later. A late refund updates its previously verified order linkage; it cannot create or renew an assignment. Include all three cases in AT08/AT09/AT12.

### 5.3 Runtime and pause invariants

- At most one active serving pointer per merchant/product. Concurrent start/keep/pause uses transactional revision compare-and-swap.
- Missing pointer, stale approval, unsupported product or absent consent → Original.
- Each A/A/A/B transition changes the pointer in the same transaction as lifecycle state and outbox. Failure rolls back all three.
- A paused/invalidated deployment cannot be revived by a stale job or retry. Return 409 for stale merchant actions and request current review.
- Global kill switch beats product pointers. Pause MUST stop new treatment responses after the pause transaction commits.
- Existing open pages MUST recheck a lightweight deployment revision lease at most every 30 seconds while visible, on focus/visibility return, and before rendering a newly returned response. On lease expiry or observed revocation hide only Pagnetic's panel. Runtime JS may not block cart submission to wait for this check.
- No persistent caching of shopper-specific responses. Immutable content can be cached by approved version, but server authority/kill-switch status cannot be assumed indefinitely.

## 6. Lifecycle, enrollment and exact time rules — R05

Separate the merchant plan from experiment phases and deployment serving state. Do not overload one enum to mean all three.

### 6.1 Plan transitions

| From | Action / guard | To | Serving consequence |
| --- | --- | --- | --- |
| PREPARING | Useful eligible proposal ready | REVIEW_REQUIRED | Original |
| PREPARING | Insufficient source/traffic | PREVIEW_ONLY / BASELINE_REQUIRED | Original |
| REVIEW_REQUIRED | Current content/protocol approved | ENABLEMENT_REQUIRED | Original |
| ENABLEMENT_REQUIRED | Exact published deployment verified | VALIDATING | Original A/A |
| VALIDATING | Validation finalized and all gates green | TESTING | Registered Original/Universal allocation |
| TESTING | Enrollment closed | MATURING | Existing cohort keeps assigned policy until expiry; new visitors receive baseline |
| MATURING | Financial cutoff and analysis complete | RESULT_READY | Baseline, no continued test enrollment |
| RESULT_READY | Merchant chooses eligible approved content | SERVING_APPROVED | Approved content, no experiment attribution |
| RESULT_READY | Merchant requests a revision | REVISION_PREPARING | Baseline; a new draft/approval is required |
| Any serving state | Merchant pause / safety event | PAUSED / REPAIR_REQUIRED | Original |
| Any state | Material source/authority drift | REAPPROVAL_REQUIRED | Original |
| Any state | Uninstall | STOPPED | Original; jobs disabled |

“Baseline” means Original for first effect test and the explicitly approved reference message for a later Universal/Matched comparison. On an actual safety incident or global pause always use Original.

### 6.2 Frozen defaults for new v2 effect experiments

```text
protocolVersion = pagnetic-effect-v2
primaryMetric = FOCAL_NET_REVENUE_PER_ASSIGNED_VISITOR_V2
randomizationUnit = CONSENTED_PERSISTENT_VISITOR
allocation = 50 / 50
alpha = 0.05; desiredPower = 0.80
minimumWorthwhileRelativeEffect = 0.05
minimumEnrollmentDays = 14
maximumEnrollmentDays = 42
visitorAttributionDays = 7
financialReviewDaysAfterLastEligibleOrder = 7
targetVisitors = calculated from baseline; never defaulted to 1000
```

These are product defaults, not universal statistical or Shopify requirements. Operator changes before approval create a different frozen plan. No edit after enrollment. A 5% target may make many products infeasible; show that instead of silently increasing the effect threshold.

Rules:

- `assignedAt` is the first eligible assignment time. Revenue window is `[assignedAt, assignedAt + 7 days)`. Repeat visits do not extend it.
- An expired assignment cannot re-enroll the same known visitor in that experiment. Return the registered baseline without a new measured decision; retain the original cohort outcome. Consent revocation deletes local analytics identity and stops measured serving; never resurrect it from a signed cart reference.
- Close new enrollment when both target total assigned visitors and minimum elapsed enrollment duration are satisfied, or at the hard 42-day deadline, whichever stopping condition occurs first. Enforce the deadline in the decision service even if the scheduler is down.
- `enrollmentClosedAt` is recorded once. Include all assignments already committed before close, including bounded concurrent overshoot; use deterministic transaction ordering and disclose actual cohort size.
- `attributionClosesAt = max(expiresAt of enrolled assignments)`; an empty cohort uses close time and cannot produce a valid effect result.
- `financialMaturityAt = attributionClosesAt + 7 days`. This is a defined seven-day financial review horizon, not a claim all lifetime returns have finished.
- Freeze cohort membership at enrollment close. Continue capture/reconciliation for that cohort without enrolling new visitors. No crossover of an enrolled visitor's treatment before its assignment window ends, except safety rollback which must be logged.
- Finalize only after financialMaturityAt and complete source-watermark reconciliation. Late refunds produce a dated revision; never overwrite prior evidence.
- At maximum duration without target: result is `INSUFFICIENT_EVIDENCE`, with descriptive totals and no winner. No automatic extension.
- A new effect experiment cannot enroll a merchant while prior effect attribution is open. Do not overlap one product's sequential experiments in this release.

Merchant pause during enrollment closes the cohort and marks stopReason `MERCHANT_PAUSE`; default outcome after maturation is `INTERRUPTED`, not a winner. “Resume” creates a reviewable new test if enrollment had begun. During preparation a pause can resume after ordinary gate checks. During approved nonexperimental serving, resume can reactivate unchanged valid authority. This deliberately avoids unmodeled pause-window restarts.

### 6.3 Instrumentation A/A

New v2 A/A is an instrumentation validation phase, never a test proving zero economic difference. It uses the same identity, assignment, observation and order pathways as A/B; both policies serve Original. Report label: **Measurement checks passed**, not “zero lift proved.”

Initial frozen validation policy: minimum 7 full enrollment days, at least 1,000 total independent visitors, at least 400 per arm, maximum 14 enrollment days. Require at least 20 reconciled paid focal-product orders and per-path controlled QA including a refund. These are conservative engineering evidence floors, not power claims. Test-only financial orders remain separate from live efficacy totals.

A/A closes and matures using the same explicit attribution/financial dates. If required health/order evidence is missing at the deadline, validation is incomplete; do not start A/B. A non-significant revenue difference cannot override a health failure. Show diagnostic revenue parity but do not call it equivalence without a separately specified/calibrated equivalence protocol.

The earliest two-stage result under these defaults can take 49 days (7+7+7 for A/A; 14+7+7 for A/B), excluding setup/baseline. Forecast that honestly. The previously proposed 45-day trial is not automatically suitable; commercial configuration MUST account for actual expected duration or clearly offer a bounded diagnostic evaluation. Do not shorten statistical windows to fit a trial.

Reuse of a prior instrumentation validation requires same merchant, product/template, checkout capabilities, identity/runtime/ledger versions and consent policy, with evidence no older than 30 days and no material change. Otherwise revalidate. A validated reuse rule must be tested before enabled; default is revalidation.

## 7. Financial metric and attribution — R06/R07

### 7.1 Exact primary metric

For eligible assigned visitor i, define `Y_i` as the sum of selected-product line-item merchandise revenue for eligible paid orders created in that visitor's fixed seven-day attribution window, after allocated discounts and recognized merchandise refunds through the frozen financial cutoff. Include every assigned eligible visitor, including zero-purchase and failed-render visitors.

```text
arm mean = sum(Y_i) / number of eligible assigned visitors in arm
effect = treatment arm mean - control arm mean
estimated in-test additional focal-product sales = effect * treatment visitor count
```

Frontend label: **Estimated additional sales of [product] during this test**. Display net merchandise definition, currency, scope, 95% interval from frozen alpha, dates and financial as-of cutoff. Do not call it total-store profit, lifetime lift or directly observed causal money.

Revenue details:

- Include focal product variants only. Use Shopify line-level discounted merchandise values in shop currency. Never attribute unrelated line-item dollars to the hero product.
- Exclude tax, duties, tips, shipping, gift-card product sales and unpaid monetary promises. Fulfillment state is not a substitute for payment state: paid unfulfilled merchandise remains eligible under the captured-payment/refund policy. Discounts are subtracted exactly once.
- Require verified successful captured payment covering the order's financial policy; authorized/pending/voided orders do not become revenue merely because checkout completed. Partially paid/ambiguous orders are quarantined for this release.
- Later partial/full merchandise refunds reduce their corresponding focal lines, even though final payment status becomes PARTIALLY_REFUNDED/REFUNDED. A simplistic current-status `PAID` filter must not drop previously paid refunded orders and their residual revenue.
- Cancellation alone is not an instruction to delete already captured sales; use actual captured/refunded financial facts. Canceled unpaid orders contribute zero. A captured canceled order awaiting refund remains a reconciliation issue until the frozen cutoff or an explicitly recorded settled state.
- Gift-card tender is a payment method, not a new line of revenue. Exclude sale of a gift-card product, not ordinary product sales paid using a gift card.
- Unallocated/manual adjustments affecting merchandise are `UNRESOLVED_FINANCIAL_ALLOCATION`; do not silently apportion them. The report cannot be finalized while material focal revenue is unresolved.
- No FX conversion in v2. Quarantine a record when it cannot be expressed in the registered shop currency.

Canonical financial computation is versioned and uses current authoritative Shopify fields for the configured API version. Sol must document the exact GraphQL/webhook field mapping and fixtures in `docs/27-v2-financial-field-contract.md` before marking R06 complete. Current order totals alone are insufficient. This field mapping is engineering work, not a reason to pause for the owner.

### 7.2 Join rules

Permitted joins, in deterministic precedence:

1. Verified signed assignment reference scoped to target product/variant and line item.
2. Verified checkout/order linkage already associated with that same visitor/assignment through the supported consent-aware pixel bridge.
3. Otherwise unresolved; do not guess from customer email, IP, last merchant-wide decision or order proximity.

If references disagree, quarantine and show a health failure. The first tagged line does not own all order revenue. Credit a focal order line once. Multiple focal lines may belong to the same valid assignment; sum them once each. Later corrections follow deterministic precedence and append an audit record.

Attach product-specific references to native form submissions synchronously from the current verified context. Do not add a hero reference to unrelated quick-add forms. If a shopper submits before an assignment response returns, do not delay checkout: track that unsupported/missing observation and prevent a final claim if coverage is inadequate.

Preserve a signed context in the supported checkout/line path even when the thank-you page never loads; reconcile server-side. An arbitrary client amount never changes the ledger. The pixel's “latest decision” must have product, experiment, assignment-window and expiry checks.

### 7.3 Inbox and replay

Receive → authenticate Shopify webhook → durably record event identity and minimally required payload → acknowledge → process asynchronously. Preserve necessary encrypted source until processing/recovery succeeds under retention limits. Never acknowledge successful durable acceptance if persistence failed.

Duplicate event IDs are no-ops; source financial timestamps and canonical fetch watermarks govern state precedence, not delivery arrival order. Refund-before-order stays pending and triggers order fetch/replay. Failed fetches retry via jobs; they are visible in readiness and cannot disappear as successful runs.

### 7.4 Coverage denominators

Do not divide experiment joins by all store orders. Maintain distinct counters:

- Assignment bridge coverage: unique eligible server decisions with expected pixel acknowledgment / unique eligible server decisions.
- Render coverage: unique treatment decisions with one final render outcome / unique treatment decisions expected to render.
- Checkout linkage coverage: eligible observed checkout/order identities with verified assignment linkage / all eligible observed checkout/order identities.
- Ledger reconciliation coverage: linked eligible orders financially reconciled / linked eligible orders expected to reconcile.
- Store-level focal orders without assignable context: displayed separately with explicit UNKNOWN/OUT_OF_SCOPE reason. This population may include denied-consent and nonexperimental shoppers; never label its entire size “missing experiment orders.”

Some entirely unobserved losses cannot be inferred from existing events. State that measurement scope is observed, consented eligible visitors. Controlled fault-injection and per-path QA must validate observable loss detection. Do not claim 100% complete capture from a denominator constructed only from successfully joined events.

Provisional live claim gates: bridge/render acknowledgment ≥95%, ledger reconciliation 100% of linked in-window orders, no unresolved contradictory joins, absolute arm difference in observable linkage failure ≤2 percentage points with at least 100 observable checkout outcomes per arm. Below the latter information floor show INSUFFICIENT_HEALTH_EVIDENCE; this can delay conclusions. Version/calibrate these rules in simulation and record any prelaunch adjustment. Never adjust a live gate to recover a win.

For A/A validation, the same integrity and capture gates apply. The 20-order floor in section6.3 is necessary but not sufficient: it does not waive the per-arm observable-checkout information floor or any controlled-path check. Include this requirement in qualification and forecast; do not present 1,000 visitors alone as enough to finish validation.

## 8. Analysis, power and validation fixtures — R02/R07

### 8.1 Feasibility

A `QualificationSnapshot` MUST preserve actual observation dates, source and effective sample. Baseline requires at least seven full days of observation, mature seven-day visitor outcomes, and enough financial/visitor data to estimate variability. Initial estimation floor: 2,000 distinct eligible baseline visitors and 50 paid purchasers. Failing the floor gives BASELINE_REQUIRED or PREVIEW_ONLY, not a precise forecast.

Estimate visitor-outcome variance including zero revenue. For an initial fixed-size planning approximation:

```text
delta = baselineMean * desiredRelativeEffect
nPerArm = ceil(2 * (z(1-alpha/2) + z(power))^2 * baselineVariance / delta^2)
```

Baseline mean ≤0 or invalid variance → insufficient baseline. Validate this approximation with seeded visitor-level bootstrap simulation reflecting sparse/heavy-tailed baseline revenue. Choose the greater of the analytic target and a calibrated conservative simulation target; do not reduce the sample based on test outcomes. Store computation/version/seed summary, not private visitor records in public reports.

Predict enrollment days using eligible visitor rate over actual observed days and a conservative observed daily-rate band. Add validation, attribution and financial review time. Display a range, data dates and whether campaign/consent restrictions were applied. If target cannot be reached within maximumEnrollmentDays, PREVIEW_ONLY. Never substitute total store traffic for eligible focal-product visitors.

### 8.2 Primary estimator

For each arm, calculate mean and unbiased variance of per-assigned-visitor net focal revenue. Difference interval uses Welch standard error and degrees of freedom with a tested numeric implementation; do not handwave sparse cases. Normal approximation can be supported only in a documented/calibrated large-sample regime. All floating-point analysis inputs derive from the exact money ledger.

Keep RPS as a declared secondary ratio with visitor-clustered uncertainty. Do not label purchaser-visitors divided by sessions as session conversion rate. Show paid purchaser rate per assigned visitor separately.

Result precedence:

1. Interrupted protocol → INTERRUPTED, no winner.
2. Material validity or financial failure → INVALID, no monetary lift claim.
3. Incomplete cohort/maturity → COLLECTING/MATURING, no final claim.
4. Deadline under target or insufficient statistical/health information → INSUFFICIENT_EVIDENCE.
5. Valid and mature, interval lower bound >0 and point relative effect ≥registered worthwhile effect → POSITIVE. Copy must not claim the lower bound proves the full worthwhile threshold.
6. Valid and mature, interval upper bound <0 → NEGATIVE.
7. Otherwise INCONCLUSIVE; retain the signed estimate/interval without a winning label.

No test with missing arms or zero estimated variance from sparse/degenerate observations may produce automatic VALIDATED/POSITIVE. Report insufficient statistical information and include a diagnostic reason. Keep both arms and all qualified assigned units in the estimator despite render failures.

Economic positive, statistically positive but economically small, and financially profitable are different labels. If positive statistical effect is below the worthwhile threshold, final result remains INCONCLUSIVE with the explanatory subreason `BELOW_ECONOMIC_THRESHOLD`.

### 8.3 Required statistical verification

- Reproduce and fix every read-only audit probe; preserve the old script output as historical evidence.
- Seeded null simulations at zero inflation, baseline conversion 1%/3%/10%, AOV dispersion and repeated session patterns; at least 2,000 simulated experiments per documented regime. Use an independent reference implementation in a development-only environment. No new production Python dependency.
- Check empirical interval coverage and false-positive rate against binomial Monte Carlo uncertainty; document discrepancies and constrain supported regimes. Do not accept a regime with clear systematic nominal-alpha inflation.
- Positive-effect power simulations at the registered MDE must support the planned ≥80% power within simulation uncertainty; otherwise increase target or classify infeasible before launch.
- Include negative effects, no orders, one arm, tiny independent sample, all-zero variance, currency mismatch, omitted financial events and asymmetric render/missingness.
- Bootstrap or reference code must resample independent visitors, never individual sessions from repeated visitors as independent units.
- No significance-based early stopping or segment winner selection. Exploratory segments remain descriptive and do not determine subscription/serving authority.

## 9. Diagnosis and content quality — R01

### 9.1 Inputs and persistence

Public input: one HTTPS Shopify product URL, optional pasted ad text ≤2,000 chars. Public preview uses current SSRF protections, response limits and bounded timeouts. Do not scrape logged-in accounts or fetch arbitrary private documents.

Without ad evidence output `CLARITY_REVIEW`. With ad evidence output `CAMPAIGN_MESSAGE_REVIEW`. The app must not infer the actual ad from generic UTM names. Unknown/private/locked page offers an example and post-install catalog path.

Authenticated product evidence comes from Shopify catalog, explicitly provided merchant facts and permitted source fields. Keep source span, source version, expiry, product scope and risk category. Source content is data, not instructions to a generator or tool.

If the visitor elects to carry preview into installation, store a short-lived random preview reference for up to 24 hours; keep sensitive ad text out of funnel telemetry and browser URLs. Bind only after store/product ownership verification. Otherwise keep preview ephemeral. Update public disclosures to match persistence.

### 9.2 Deterministic baseline algorithm

Normalize sentences and supported product attributes; extract exact supported factual spans. Build at most one primary candidate plus one material alternative. First supported gap categories: `BENEFIT_NOT_PROMINENT`, `OBJECTION_UNANSWERED`, `CAMPAIGN_PROMISE_NOT_REFLECTED`.

Evidence of prominence must come from observed page order/layout. If only product text is available, say “not prominent in the product description”; do not claim to know an above-the-fold layout that was not inspected.

Propose a headline/lead benefit plus 2–4 short benefits and optional one sourced reassurance. Existing 3–4 benefit validators must be versioned for v2. The deterministic composer may promote an exact meaningful source sentence as a lead; it must not merely copy the product title and relabel it. Deduplicate normalized factual bodies; normalized exact duplicates cannot be distinct treatments. Near-duplicate token-set similarity ≥0.90 is a review signal, not a claim of semantic equivalence.

Rank candidates lexicographically: eligible evidence and category first; explicit campaign relevance next; demonstrated missing prominence next; distinctness and brevity last. Store component explanations. Do not display heuristic totals as predicted probability of lift.

Reject a candidate without a materially useful difference. Output `NO_SUPPORTED_OPPORTUNITY` with one specific source request or preview-only exit. The merchant may provide an alternative factual sentence and source; it undergoes the same validation.

### 9.3 Optional model adapter

Implement an interface `proposeMessage(evidence, campaign, constraints) -> Candidate[]` with deterministic adapter default. Model adapter is disabled until provider, credentials, data scope and spend cap are configured. Model generation occurs in a background preparation job and never in shopper runtime. Record provider/model/prompt/version and traceable evidence IDs. A model cannot approve itself; all text follows validators and merchant approval.

Do not claim general semantic understanding or automatic optimization when the deterministic baseline cannot support it. This is an acceptable abstention, not a reason to silently introduce a paid provider.

### 9.4 Content acceptance

Maintain 50 representative product/ad fixtures, including irrelevant ads, short sources, contradictions, excluded categories, markup/script injection, unsupported language and identical outputs. Required automated invariants: every factual sentence linked, prohibited claims blocked, no unauthorized source fetch, no exact duplicate treatment bodies. Human review target before customer launch: zero fabricated claims/evidence, ≥80% useful/clear drafts in the declared supported subset, all rejected cases categorized. These are internal launch targets, not market benchmarks.

## 10. Merchant UI/UX — R03/R08/R09

Use the existing visual style as a base. Reuse components/styles where possible. Main app navigation is **Overview**, **Messages**, **Results**, **Settings**; technical governance/setup/measurement/operations routes remain under Advanced/operator access. They cannot be the default way merchants resolve ordinary setup.

### 10.1 One presentation contract

```ts
type MerchantStatusV2 = {
  state: string;
  title: string;
  detail: string;
  severity: "neutral" | "success" | "attention" | "critical";
  serving: "ORIGINAL" | "TEST" | "APPROVED_MESSAGE";
  owner: "MERCHANT" | "PAGNETIC" | "WAITING_FOR_DATA" | "NONE";
  primaryAction: { id: string; label: string; href?: string; intent?: string } | null;
  secondaryAction?: { id: string; label: string; href?: string; intent?: string };
  nextCheckAt: string | null;
  blockers: Array<{ code: string; customerText: string; evidenceRef?: string }>;
};
```

Server derives status and actions together from current deployment, plan, health and entitlement. The UI must not independently infer `No action needed` from a raw enum. MERCHANT owner requires a real action; PAGNETIC owner shows repair status and support, not a generic merchant checklist. Unknown internal reason maps to safe plain text plus a reference code under Details.

### 10.2 Screens and required interactions

| Screen | Required information | Primary action | Error/empty state |
| --- | --- | --- | --- |
| Public preview | Product URL, optional ad, one useful diagnosis, source and example | See my page opportunity | Invalid/locked/no-source/no-opportunity; entered values preserved |
| Preparation | Product sync/job progress and next check | None during healthy work | Retry failed step; resumable across reload |
| Qualification | Can measure / Need baseline / Preview only, real dates and forecast | Review proposed change or choose product | No invented score, traffic, money or date |
| Review | Actual product, current/proposed difference, context, sources, trial/price status | Approve this test | Edit, reject, choose; stale approval returns to review |
| Enable | Exact product template, two instructions, current verification | Open product template | Already installed / Save inactive / wrong template / unsupported capability |
| Validating | Measurement checks, actual progress and applicability | None unless an owned blocker | Actionable per-check failure; no fake stage completion |
| Testing | Which message, start/end forecast, visitors and health, visible Pause | None while healthy | Missingness/stop explained without a provisional winner |
| Maturing | Enrollment closed date, purchase window and financial cutoff | None | Reconciliation delay names responsible party |
| Result | Primary scoped money estimate/interval, result, dates, source/version | Keep / baseline / repair depending result | Invalid suppresses lift; insufficient evidence explains why |
| Serving approved | Which message is live, historical result dates, next useful opportunity | Review next opportunity if one exists | No artificial money counter; no-opportunity is legitimate |
| Settings | Pause, subscription, supported surfaces, notices, export | Context-specific | Billing status server-verified; cancellation explicit |

### 10.3 Review and true preview

Show current product image and actual description alongside the proposed message. Plain source reconstruction must be labeled as such; do not label it a screenshot of the live page. Provide product/theme preview for placement at mobile and desktop widths. If theme cannot be embedded because of CSP/password, use a working separate preview link rather than a blank iframe. A generated mock is not published-theme proof.

Sources appear inline on demand near each fact. Editing creates a new draft/version and reruns validations. Approval stores exact content, evidence, mapping/compiler policy, test metric/windows, rollback authority, actor and timestamp. Product choice materially tied? Offer at most three credible choices without internal scores.

The app obtains one bounded approval of the proposed first comparison. Matching-stage content is not silently added later; it needs its own approved plan if not originally included. Billing approval remains separate.

### 10.4 Theme enablement and QA applicability

Deep link includes selected product preview path and actual template suffix. Detect existing block; do not duplicate it. Verification requires authenticated app activation evidence plus product-specific current runtime acknowledgment. A public untrusted event alone cannot certify the published theme.

Per check: PASS, FAIL, PENDING, NOT_APPLICABLE. Required evidence fields include theme/version, product/template, block/runtime version and observation time. Theme/config changes invalidate affected checks; app release changes invalidate checks through an explicit impact map. Default QA freshness 30 days, current runtime acknowledgment ≤15 minutes at activation. Do not expire a live test merely due to a calendar boundary without a recheck job; schedule revalidation before expiry.

Shop Pay is applicable only if enabled on the supported store flow. Not applicable must have evidence; unknown is PENDING. Do not require a Turkish merchant to invent a supported Shopify Payments business or bypass country restrictions. Unsupported selling plans/headless/vintage themes must be excluded before test activation.

### 10.5 Pause, result and recurring work

Pause remains visible wherever serving is active. Explain that pausing an enrolled effect test interrupts that test. Normal pause is immediately effective; avoid a confirmation maze.

`Keep this message` verifies result/approval/entitlement and atomically installs a nonexperimental serving version. `Keep current page` restores baseline. `Review a new idea` creates a separate draft and preserves previous report. Invalid/negative/inconclusive states cannot trigger “winner kept” without explicit manual non-causal adoption clearly labeled and separately authorized; omit manual adoption from v2 if it would confuse the outcome.

Every result displays actual interval confidence derived from alpha. Invalid/interrupted results show no causal dollar headline. Insufficient evidence may show arm-level descriptive sales under Details but no winning conclusion. Projected monthly value is optional and secondary, with eligible traffic assumptions and interval; it is never mixed into historical measured totals.

### 10.6 Accessibility and interaction requirements

Support 320, 375, 768, 1024 and 1440px widths; 200% zoom; keyboard-only review/edit/approve/pause/export; one screen-reader pass. Semantic headings/forms, explicit labels, visible focus, contrast-compliant text/controls, inline errors plus summary, announced async completion without focus jumps. No status communicated by color alone. Respect reduced motion. Long titles/ad text must not hide primary actions or cause primary-flow horizontal scrolling.

Use local merchant timezone for displayed action times, ISO UTC internally, explicit currency on amounts and separate sales/profit terminology. During background refresh, preserve edits and do not reset user selection. Disable duplicate submit while retaining server idempotency.

## 11. Application actions and job contracts

Keep existing authenticated route conventions. New logical commands may use React Router form intents or dedicated action routes; implement one typed command service per action to prevent route-specific duplicate rules.

| Command | Inputs beyond authenticated tenant/actor | Required guard / response |
| --- | --- | --- |
| Prepare diagnosis | productId, adText?, idempotencyKey | Return 202/job; no synchronous long loader work |
| Edit draft | draftId, expectedRevision, patch, idempotencyKey | Source validation; stale revision 409; invalid claim 422 |
| Approve plan | planId, expectedRevision, planHash, acknowledgment | OWNER or authorized approver; no changed snapshot |
| Verify deployment | planId, expectedRevision, observation reference | Product/template/capability proof; never trust client PASSED flag |
| Pause | deploymentId, expectedRevision, reason?, key | Authorized role; pointer/lifecycle/outbox transaction |
| Keep message | resultId, contentVersion, expectedRevision, key | Current valid result/approval/entitlement; new serving revision |
| Revise | resultId, proposed reason, key | Creates one draft; no experiment reset or free-extension reset |
| Stop | deploymentId, expectedRevision, key | Original pointer and stopped state; financial reconciliation continues |
| Select plan | offerVersion | Redirect to Shopify-hosted pricing; no local paid activation |
| Verify subscription | callback context | Authoritative external status, tenant binding, idempotent reconciliation |
| Export report | reportId | Tenant authorization; exact immutable report version |

Common error envelope: `{ok:false, code, customerMessage, retryable, nextAction?, requestId}`. Never expose stack traces, tokens or third-party raw error payloads to merchant UI. Common codes include STALE_REVISION, SOURCE_CHANGED, UNSUPPORTED_SURFACE, BASELINE_REQUIRED, INSUFFICIENT_TRAFFIC, CONSENT_UNAVAILABLE, LEDGER_PENDING and EXTERNAL_CONFIGURATION_REQUIRED.

Queue types: CATALOG_SYNC, DIAGNOSIS_PREPARE, BASELINE_PROJECT, VERIFY_DEPLOYMENT, RECONCILE_ORDER, RECONCILE_REFUND, EVALUATE_HEALTH, CLOSE_ENROLLMENT, FINALIZE_RESULT, NOTIFY, BACKUP_VERIFY. Jobs have bounded retries, backoff, leases and dead-letter state; no unbounded chain of immediate retries.

## 12. Commercial configuration and billing — R10

Existing $49 founding offers remain their existing versions. Implement a configurable offer catalog; draft new-cohort $99/month and bounded evaluation offers may exist with `publishable=false`. Do not activate a 45-day clock by default when the computed result horizon exceeds it. UI displays the exact approved offer and what the evaluation covers.

Default `SHOPIFY_BILLING_ENABLED=false` until approved configuration. A positive experiment does not change subscription status. A negative or inconclusive result does not create unlimited free revisions. Entitlement stores a consumed evaluation/revision ledger that persists across reinstall and repeated reports; no fresh allowance from a new snapshot ID.

Use Shopify App Pricing integration. Merchant chooses a plan on the Shopify-hosted page; backend verifies active subscription through the current authoritative provider interface. Configure/test private/no-charge dev plans as supported. Do not infer paid state from `plan_handle`, `charge_id`, a success URL, a local flag or the experiment result. [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing).

Canonical statuses: FREE_EVALUATION, PENDING_APPROVAL, ACTIVE, FROZEN, CANCEL_AT_PERIOD_END, EXPIRED, CANCELED. Map actual provider states explicitly and preserve raw source event versions for audit. Decline/cancel/freeze/reinstall/duplicate/out-of-order events have fixtures.

On cancellation, show access end date, what happens to served messages, and report export. At entitlement expiry stop new tests and return to Original unless the approved offer expressly permits continued serving. Allow historical report access/export under retention policy. Continue required financial reconciliation for already closed cohorts without charging for it.

Provider credentials/plan IDs are external configuration. Sol MUST implement the adapter, configuration validation and no-charge test path without claiming the live paid flow is complete before provider verification.

## 13. Reliability, performance and security — R11/R12

### 13.1 Operational baseline

- Keep modular monolith. Move preparation/report work out of loaders and shopper requests. Serve from indexed deployment/approval records and persist minimum assignment evidence.
- Use transactional outbox and leases; retries cannot duplicate transitions, reports, allowances or charges.
- Reports project outcomes in bounded batches (default 500 records/batch) and use watermarks. No full-lifetime event hydration per request or maintenance tick.
- Return healthy Original if serving authority is unavailable. Record fallback/missingness so failure is not mistaken for successful treatment exposure.
- Apply limits per tenant and request class; validate forwarded addresses only from trusted proxy configuration. Global abuse cannot starve unrelated stores.

### 13.2 Prospective performance budgets

Initial engineering budgets for v2 only: server decision p95 ≤150 ms under accepted mixed load; client end-to-end decision p95 ≤1,000 ms; absolute client render deadline ≤1,500 ms from decision attempt; deterministic Original after deadline. These are candidate release limits and must be validated on mobile devices/geographies. Old registrations retain old limits.

Measure before/after LCP, INP and CLS with an appropriate supported-theme baseline. Proposed change budgets: p75 LCP degradation ≤100 ms, p75 INP degradation ≤20 ms and CLS increase ≤0.02, alongside absolute quality and confidence/sample reporting. A tiny synthetic run cannot certify these population metrics. No late insertion that blocks or displaces native purchase controls. Performance QA remains pending without enough relevant evidence.

Test twice the forecast cohort peak with storefront, webhook replay and reporting concurrently. Record p50/p95/p99, fallback percentage, DB waits, queue age, RSS and errors. Do not accept arbitrary 25-store capacity from an environment variable. Adopt a cohort-specific request/event cap based on evidence.

### 13.3 Database and backup

Implement/migrate PostgreSQL before multiple unattended stores or replicas. Prisma provider changes require distinct migration histories and a data transfer rehearsal; do not replay SQLite migrations against PostgreSQL. Keep exact IDs, money, approvals and historical reports. Validate counts, FK relations and canonical hash checksums before cutover.

A supervised single SQLite store may continue while this is prepared, with one writer and a verified off-volume backup. Backup artifact must include consistent DB snapshot, checksum, manifest, schema/application versions, creation time and encrypted off-volume destination. Readiness checks freshness/checksum plus last successful restore, not a filename or configured path.

Pilot RPO ≤24 hours / RTO ≤4 hours; paid multi-store proposed target RPO ≤1 hour / RTO ≤1 hour with managed PITR and measured restore. External vendor choice/spend is configuration, not authority to purchase from this PRD. Implement an adapter and dry-run/restore tests while pending.

### 13.4 Alerting and privacy

Deliver external alerts only to owner-configured destinations; 2xx response required to mark delivered. Dedupe per incident, exponential retry, dead-letter and external scheduler/uptime dead-man check. Separate internal in-app notice from delivered email/webhook. Do not send real messages to invented recipients during testing.

Privacy tests cover unknown/denied/late grant/revocation, schema allowlists, event replay, forged references, bounded timestamps, tenant spoofing, Shopify webhook authentication, source prompt injection and uninstall. Denied-consent shopper events must not be stored as analytics; operational aggregate failure counts must not smuggle identity back in.

Raw event retention defaults remain 90 days, and approved existing aggregate/legal retention policy remains until explicitly changed. Include new inbox, projections, preview references, ledger and backup expiry in the retention/deletion inventory. Reconcile a retained report's lawful scope with privacy deletion requirements; do not use immutability as a reason to keep disallowed personal data. Use privacy-preserving aggregate/report evidence where appropriate.

## 14. Migration and safe rollout

Perform expand → backfill → shadow-read → selected test-store cutover → verify → retire compatibility later.

1. Record baseline source/schema/extension versions and active experiment registrations. Existing worktree is user-owned and may be untracked; preserve it.
2. Add v2 tables/fields and feature flag `PAGNETIC_V2_ENABLED=false`. Code must coexist with v1 without reclassifying old reports.
3. Backfill only facts directly derivable from stored evidence. Mark missing historical payment/cohort data UNKNOWN. Never synthesize historical validity or paid states.
4. Build v2 projections in shadow mode and compare exact financial totals and join reasons against independent fixtures. No duplicate shopper experiment enrollment in shadow mode.
5. Selected internal test-store cutover uses an explicit migration receipt, Original baseline and a fresh v2 plan. Close/retain old QA experiments; do not rewrite their 150 ms or metric registration.
6. Deploy compatible backend before client extension. During mixed versions, legacy clients retain supported Original/legacy behavior; new clients fail to Original if protocol unsupported.
7. Test one-save lifecycle, all supported checkout paths and rollback. Rollback disables v2 pointer serving, retains collected evidence and stops new enrollment. Never drop new tables to roll back application behavior.
8. PostgreSQL cutover separately freezes writes, exports/transfers, verifies, switches configuration and verifies webhook catch-up. Keep rollback plan until data parity/health is established. Never write both databases without an explicitly implemented consistency protocol.

Do not publish a new paid offer or recruit stores as a side effect of technical deployment. Those are separate owner/provider and market gates.

## 15. Acceptance test matrix

Each test needs executable or browser evidence stored in the implementation status record. Existing test names are not sufficient if they mock the behavior under test.

| Test ID | Given / when | Required outcome |
| --- | --- | --- |
| AT01 | Fresh supported install and one Shopify save | Product-specific v2 deployment acknowledged; no ID/config entry |
| AT02 | A/A finalized; backend advances | Same saved block receives new A/B deployment and experiment ID |
| AT03 | Concurrent advance/retry | One pointer revision, experiment and outbox event |
| AT04 | Pause during live treatment and stale response/lease | New requests Original; open visible page removes only app panel within lease bound |
| AT05 | Zero orders / health collecting A/A | No validation or automatic A/B launch |
| AT06 | Enrollment open after minimum duration+lag | No final result |
| AT07 | Deadline reached below target / scheduler stopped | Runtime stops enrollment; insufficient-evidence result after maturation |
| AT08 | Last visitor orders just inside/outside seven-day boundary | Inside counted once; outside excluded by frozen window |
| AT09 | Duplicate/reordered order/refund events; refund before order | Correct stable ledger, pending recovery, no lost/double refund |
| AT10 | Paid, authorized, unpaid, canceled-paid, partial refund and QA orders | Exact declared financial policy; no test/unpaid inflation |
| AT11 | Multi-product cart and unrelated quick-add | Focal revenue only; correct product reference; no hero dollars from other lines |
| AT12 | Cross-tenant, expired or contradictory reference | Reject/quarantine, no attributed financial outcome |
| AT13 | First product_viewed before decision; repeated views | Baseline correct; duplicates do not reduce capture metric |
| AT14 | Denied/unknown consent, missing API, late grant, revoke | Declared identity/storage/Original behavior; no hidden session-mode mixing |
| AT15 | One arm missing, sparse/degenerate variance, null simulation | No false validity; calibrated method/reasons |
| AT16 | 2 days baseline; target5% at low traffic | No assumed28days/1000-sample power; explicit infeasible path |
| AT17 | Same bodies with different angle labels | No separate treatment; abstain or revise |
| AT18 | Unsupported source claim, category, locale or injected instructions | No unapproved content/tool action; clear correction |
| AT19 | Custom template, duplicate block, disabled Save, wrong published context | Correct deep link/recovery; cannot false-pass activation |
| AT20 | Enabled Shop Pay vs absent/unknown capability | Enabled tested; absent evidenced N/A; unknown pending |
| AT21 | Blocking notice in VERIFYING | No “No action needed”; exact CTA and responsible party |
| AT22 | Positive/negative/inconclusive/invalid results | Correct scoped money/interval/label and action; invalid suppresses lift |
| AT23 | Keep then revise then stop | Real approved serving, new draft/approval, Original; old report preserved |
| AT24 | Declined/frozen/canceled subscription, replay/reinstall | No unauthorized paid access or repeated free allowance |
| AT25 | Job crash after state commit; alert500; stale backup filename | Safe retry, no fake delivery/backup pass |
| AT26 | Restore and SQLite→PostgreSQL rehearsal | Counts/FKs/money/hashes match; measured RPO/RTO |
| AT27 | Mixed runtime load at2x forecast and mobile latency faults | Budgets/Original/coverage behavior evidenced, no cross-store starvation |
| AT28 | Keyboard, screen reader, small widths, long copy, background update | Usable primary actions, visible focus, edits retained |
| AT29 | Legacy protocol/client/report during migration | No metric/threshold/history rewrite; documented compatibility |
| AT30 | Uninstall and later financial/privacy/billing events | Serving/jobs disabled; allowed reconciliation/deletion and correct entitlements |

Required commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm shopify app build`; use project-supported Node ≥22.12. Add targeted financial, protocol, integration and browser checks as needed. Rebuild theme assets through the supplied build command; do not hand-edit generated/minified assets. Production readiness checks must execute against actual intended environment, not merely local placeholders.

## 16. Sol work packages and dependency order

| Package | Scope | Paths to start with | Depends on | Exit tests |
| --- | --- | --- | --- | --- |
| S01 | Baseline record, regressions, schema/flags, presentation contradiction fix | docs status, audit probes, prisma/schema, autopilot-presentation, app._index | None | AT21/AT29 and captured baseline failures |
| S02 | Consent identity/baseline and v2 deployment service | storefront/adaptive-panel, pixel, runtime/measurement services, Liquid | S01 | AT01–04/AT13–14 |
| S03 | Inbox, canonical financial ledger and attribution | webhook routes, measurement-reliability, measurement, projections | S01/S02 identity contract | AT08–12 |
| S04 | Cohort lifecycle, analysis, feasibility and report | experiment-analysis/report, autopilot/orchestrator/preparation | S02/S03 | AT05–08/AT15–16/AT22 |
| S05 | Diagnosis, quality gates, explicit campaign mappings | public-preview, governance, preparation, public page | S01 | AT17–18 and content evaluation |
| S06 | Real review/enablement and complete merchant screens | app._index, setup, presentation, styles, preview | S02/S04/S05 | AT19–22/AT28 |
| S07 | Keep/revise/stop and subscription adapters | orchestrator, entitlement, serving pointer, settings | S03/S04/S06 | AT23–24/AT30 |
| S08 | Durable jobs/outbox, telemetry, backups/alerts | automation, job services, scripts, readiness, Fly config | Foundation in S01; complete by S07 | AT25 |
| S09 | Postgres migration path, capacity and release CI | Prisma migration tracks, data transfer, scripts, release configs | S03/S08 | AT26–27/AT29 |
| S10 | Full Shopify rehearsal and final evidence | supported browser fixtures, current docs, release report | S01–S09 relevant capability | All applicable AT tests and gate record |

Sol may reorder independent tasks to reduce rework, but must not skip dependencies, substitute mocks for integration gates, or deploy incomplete measurement claims. Build single-writer prototype compatibility first; PostgreSQL provision can remain externally blocked while migration code/rehearsal proceeds. Keep packages small enough to review and restore.

Default execution sequence: S01 → S02 → S03 → S04 → S05 → S06 → S08 → S07 → S09 → S10. S01 includes the transactional outbox schema and minimal enqueue/lease primitives required by S02/S03; S08 completes workers, operational delivery, monitoring and recovery before lifecycle/billing completion. Package numbers are identifiers, not permission to postpone a prerequisite.

## 17. Completion states and market gates

Report three separate conclusions:

**Engineering complete:** all code-controlled requirements and local/integration fixtures pass, v2 lifecycle works end to end, docs and migrations are current. Any provider-bound integration remains explicitly pending real verification.

**Design-partner deployable:** supported real-store compatibility, external services/secrets/backup/alerts, approved distribution/legal identity and nominated incident owner are verified; qualification predicts a responsible test. No unresolved P0. One supported test-store purchase is not enough.

**Public acquisition ready:** assisted cohort supports repeatable activation, meaningful decisions, paid continuation and manageable support. Require actual market observations; no automated test can satisfy this gate.

Carry forward the audit's proposed learning cohort: 8–10 discovery interviews, 5–8 qualified assisted stores, 4/5 unprompted usability completion, ≥70% forecast-window decision completion, three independent paid continuations and two still paying/using another useful cycle at day60. These are learning targets, not statistical proof of PMF. Record negative/null/invalid outcomes and reasons for rejection. Do not message/recruit stores without owner authorization.

## 18. External decisions and safe defaults

| Pending choice | Default while missing | Engineering work that proceeds |
| --- | --- | --- |
| New price/trial offer | Preserve existing offer; billing disabled | Offer versioning, UI, provider adapter/no-charge tests |
| Managed PostgreSQL provider/account | Single supervised writer only | Migration tracks, schema compatibility, transfer/restore rehearsal |
| Off-volume storage and alert endpoint | Explicit readiness BLOCKED | Adapter contracts, fixtures, delivery checks, local restore tests |
| Optional model provider | Deterministic composer and abstention | Evaluation set, interface, source validation and UX |
| First partner/vertical | No public acquisition; test fixtures use low-risk accessories | Full internal implementation and demo |
| Legal effective date/support owner/DNS/review | Existing truthfully labeled draft/config | Prepare exact fields and validate configuration |

Do not ask for these repeatedly while unrelated engineering remains. When a provider or owner decision is the actual last dependency for a capability, report the exact missing value, completed preparation and the one required action. Do not invent founder identity, payment eligibility, legal approval, credentials or model quality results.

## 19. Handoff definition

The implementation handoff MUST contain: status per R01–R14 and S01–S10; evidence per AT01–AT30; current release/schema/extension identifiers; fresh audit regression outcomes; production/readiness results where accessible; list of actual external blockers; remaining customer-learning work; and a rollback procedure tested in proportion to deployment risk.

Do not say “MVP launch-ready” when only the code compiles, the test counter is green or owner configuration remains unverified. Say exactly which completion state in section17 has been achieved.

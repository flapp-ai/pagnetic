# Adaptive Storefront Autopilot Product Requirements

Status: Proposed implementation baseline  
Version: 0.1  
Prepared: 2026-09-04  
Owner: Product  
Target: Founding-beta productization before public acquisition

## Executive decision

Adaptive Storefront should become a **zero-configuration, one-consent** product.

The merchant should not operate an experimentation platform. The merchant should:

1. approve one source-grounded opportunity and bounded test plan;
2. save the pre-staged Adaptive Panel in Shopify's theme editor; and
3. return to a result expressed as estimated incremental revenue.

The system performs catalog analysis, candidate ranking, content preparation, instrumentation validation, A/A, experiment launch, monitoring, result classification and safe rollback. The existing seven technical stages remain as internal gates and audit evidence; they are no longer the primary merchant navigation.

This is not a promise of fully unattended publishing. Shopify requires the merchant to save the theme extension, and storefront claims require informed merchant approval. Adaptive Storefront removes configuration work without removing consent, auditability or the original-storefront fallback.

## Problem

The current MVP can produce a trustworthy causal result, but its merchant experience exposes the operating model of the system:

- select a hero product;
- approve a brand profile;
- create drafts;
- approve content;
- qualify traffic;
- activate the theme block and pixel;
- complete QA;
- register and monitor A/A;
- register and monitor a real experiment.

These are legitimate system responsibilities, not merchant jobs. Requiring a shop owner to understand and coordinate them increases time to value, support burden and abandonment before the product can demonstrate economic benefit.

The product also risks presenting an empty or methodology-first dashboard during the period when no mature result exists. A merchant needs to know what Adaptive Storefront is doing, whether it is safe, when an answer is expected, and whether attention is required.

## Product objective

Enable a qualified Shopify merchant to move from installation to a safely running first experiment in one active session with no manual configuration beyond one bounded approval and Shopify's theme-save action.

After sufficient data matures, show a defensible estimate of incremental revenue and a clear recommendation without requiring the merchant to interpret experiment mechanics.

## Success definition

Autopilot succeeds when it increases the share of qualified installs that reach a valid result while preserving the current measurement, claims, privacy and rollback guarantees.

Initial product targets are hypotheses to validate during the first 25 stores:

| Outcome                                                          |                    Founding-beta target |
| ---------------------------------------------------------------- | --------------------------------------: |
| Public preview completed                                         |                 under 60 seconds median |
| Merchant active setup time                                       |                  under 5 minutes median |
| Install to opportunity approval                                  |                            at least 60% |
| Qualified install to live measurement in the same session        |                            at least 50% |
| Qualified live store to valid result within its predicted window |                            at least 70% |
| Positive result to USD 49/month continuation                     |                            at least 30% |
| Manual support interventions                                     | fewer than 1 per activated store median |
| Attributable Severity 1 storefront incidents                     |                                       0 |

These targets are learning gates, not external marketing claims.

## Product principles

- **One recommendation, not a configuration canvas.** Autopilot proposes the best eligible product and one complete plan.
- **Consent without busywork.** One approval covers an immutable content, mapping, experiment and safety snapshot.
- **Internal complexity stays internal.** A/A, registration, joins, maturity lags and statistical diagnostics remain available under Advanced details.
- **Outcome before methodology.** Lead with estimated incremental revenue, its uncertainty and the recommended action.
- **No-data honesty.** Display an evidence-based time band or `Not enough data yet`; never manufacture precision.
- **No-runtime AI.** Runtime selection remains deterministic among approved immutable versions.
- **Original is the failure state.** Missing, stale, ambiguous or unsafe inputs render the original storefront.
- **Automation earns authority.** The system advances only through explicit, recorded gates included in the merchant-approved plan.
- **Exceptions receive attention.** The merchant is interrupted only for consent, the Shopify save action, a decision-changing source update, a safety issue or a mature result.

## Scope

### P0 — required before Autopilot founding-beta acquisition

- Automatic post-install catalog sync.
- Deterministic candidate-product ranking with explanations and qualification bands.
- Automatic source-derived brand profile and draft library preparation.
- Automatic low-risk claim validation and evidence binding.
- Automatic campaign-signal coverage analysis and conservative mapping proposal.
- One immutable Autopilot plan containing product, content, mappings, experiment protocol and granted authority.
- One bundled merchant approval for all shopper-visible text and the bounded launch sequence.
- Shopify theme-editor deep link that pre-stages the app block on the selected product template.
- Published-theme, Web Pixel, checkout, fallback and performance verification.
- Automatic A/A registration, launch, monitoring and validation.
- Automatic transition from passing A/A to the approved first real experiment.
- Automatic pause and original-storefront rollback on an existing hard safety condition.
- Five merchant-facing states and one primary action per state.
- Outcome-first dashboard with verified and projected value clearly separated.
- Honest insufficient-traffic path.
- Merchant-visible pause control on every live state.
- Merchant and operator audit trail for every automatic transition.
- Founding-beta entitlement behavior aligned to result state.
- Funnel telemetry for every important Autopilot transition and exception.

### P1 — after the first cohort demonstrates activation

- Direct campaign ingestion from supported advertising platforms.
- Automatic re-ranking after a product becomes ineligible.
- Suggested replacement content after source drift.
- Merchant-configured notification channels.
- Multiple sequential products per store.
- Vertical-specific scoring and content policies.
- Predictive duration estimates calibrated from completed experiments.
- Portfolio dashboard for merchants running repeated experiments.

### Non-goals

- Editing Shopify theme source files.
- Silently saving or publishing a theme extension for the merchant.
- Publishing content the merchant has not approved.
- Automatically approving medium- or high-risk claims.
- Inferring sensitive traits or protected identity.
- Runtime generative decisions.
- Bandit allocation or outcome-responsive assignment.
- Changing price, discount, shipping, inventory, checkout or product imagery.
- Claiming certain revenue that cannot be observed as a counterfactual.
- Launching low-traffic stores into experiments with no credible completion path.
- Removing the existing governance, setup, measurement or operations workspaces; they remain Advanced views and operator tools.

## Merchant experience

### Merchant-visible state model

The home page displays exactly one of five states:

| State              | Merchant question answered                  | Primary action                   |
| ------------------ | ------------------------------------------- | -------------------------------- |
| `PREPARING`        | What is the app preparing?                  | Review opportunity when ready    |
| `NEEDS_ENABLEMENT` | What must I do in Shopify?                  | Open theme editor                |
| `MEASURING`        | Is it working, and when will I know?        | No action; optional pause        |
| `RESULT_READY`     | How much did it help, and what should I do? | Continue, revise or stop         |
| `NEEDS_ATTENTION`  | What prevented safe progress?               | Resolve the single blocking item |

The UI may show a short sub-status such as `Checking measurement` or `Waiting for data`, but it must not turn the internal technical stages into merchant tasks.

### Moment 1 — Opportunity

After installation, the application automatically prepares one recommendation.

Required screen content:

- selected product and product image;
- why it was selected;
- source-readiness and traffic-qualification band;
- Original and proposed Universal panel preview, with optional angle tabs;
- every proposed statement with its source available inline;
- what will change and what will never change;
- estimated completion band: `under 14 days`, `14–30 days`, `more than 30 days`, or `not enough data yet`;
- explanation that some eligible shoppers will remain on the original experience;
- bundled authority statement;
- one primary action: **Approve and prepare test**;
- secondary action: **Choose a different product** only when more than one candidate is credible.

The approval language must state that the merchant approves the exact immutable content and authorizes the app to run A/A and, only after A/A passes, the frozen first real experiment. It must also state that the app may pause and return to Original when a safety gate fails.

Acceptance criteria:

- No proposed claim appears without a valid evidence link.
- The approval action records the approver, all content hashes, evidence snapshot, mapping snapshot, protocol hash, policy version and granted actions.
- Any material change to the approved snapshot invalidates the relevant authority and returns the plan to `NEEDS_ATTENTION`.
- Medium-risk content is individually highlighted and requires an additional acknowledgement inside the same review; high-risk and prohibited content cannot enter an Autopilot plan.
- If the top two eligible candidates are materially tied, the merchant chooses between at most three recommendations; Autopilot does not make an arbitrary hidden choice.

### Moment 2 — Enable

After approval, the application opens a Shopify theme-editor deep link with the Adaptive Panel pre-staged on the chosen product template.

Required screen content:

- a two-step instruction: `1. Preview the panel. 2. Click Save in Shopify.`;
- a button to open the exact theme-editor destination;
- automatic published-theme verification after the merchant returns;
- one recovery instruction if verification fails.

Acceptance criteria:

- The app never reports activation from a preview or unpublished theme.
- Theme verification uses the selected product's published template.
- No treatment experiment begins before the published block, pixel, checkout, fallback and performance checks pass.
- Successful verification requires no further merchant action.
- Failure names the single failing check in plain language and preserves Original.

### Moment 3 — Measure and result

Once technical gates pass, the application validates measurement and runs the approved experiment without requiring the merchant to operate either stage.

During collection, show:

- `Checking measurement` while A/A is running;
- `Measuring additional revenue` after A/A passes;
- a completion band and progress based on eligible sessions and minimum duration;
- measurement-health status;
- `No action needed` when healthy;
- a persistent Pause control.

Do not show a winner, final uplift or celebratory revenue counter before the registered maturity rule is satisfied. A directional estimate may be shown only under Advanced details, labeled `Early estimate — not final`, with its interval and without changing the stopping rule.

At maturity, the primary result card shows:

```text
Estimated incremental revenue: +$1,240
Observed during this test · 95% interval: +$340 to +$2,110
12,480 eligible sessions · 2026-09-10 to 2026-09-30
Recommendation: Keep the improved message
```

Required result fields:

- result state: Positive, Negative, Inconclusive or Invalid;
- estimated incremental revenue during the experiment;
- difference in net revenue per eligible session;
- uncertainty interval;
- eligible sessions and dates;
- winning or tested message;
- refund and cancellation maturity note;
- recommended next action;
- separate projected monthly upside at full rollout, when calculable;
- expandable methodology and health diagnostics.

The core estimate remains:

```text
(treatment net revenue per eligible session
 - control net revenue per eligible session)
× treatment-eligible session count
```

Acceptance criteria:

- The result label follows the frozen measurement specification.
- Verified in-test incremental revenue and projected future upside are visually and semantically distinct.
- Negative values are displayed as estimated loss, not hidden.
- Inconclusive and Invalid never show a winning claim.
- Revenue definition, currency and maturity date are accessible within one interaction.
- Downloadable evidence retains the immutable registered report.

## Automatic preparation requirements

### Catalog sync

Autopilot starts catalog sync after authenticated installation and retries bounded transient failures.

Eligibility filters:

- active and published product;
- available product template;
- non-excluded product category;
- sufficient source text for a grounded panel;
- stable canonical product identity;
- no existing incompatible experiment detected.

### Candidate ranking

Rank only eligible products. The initial score is deterministic and versioned:

| Signal                                | Purpose                                     |
| ------------------------------------- | ------------------------------------------- |
| Recent eligible PDP sessions          | likelihood that a test can finish           |
| Recent net product revenue and orders | economic materiality                        |
| Source-readiness score                | ability to create useful, supported content |
| Acquisition-signal coverage           | ability to test message matching later      |
| Product availability and stability    | risk of interruption                        |
| Existing conflicting experiment       | exclusion or penalty                        |

Order/revenue history may be used only when the installed scopes and protected-data approval permit it. If historical traffic or order data is unavailable, Autopilot must label its recommendation `Source-based` and must not present a precise test-duration estimate.

The score record must contain:

```text
scoring_version
lookback_window
input_availability
component_scores
exclusions
total_score
duration_band
created_at
```

### Traffic qualification

Qualification must produce one of:

- `READY`: expected to reach the registered target within 30 days;
- `LIMITED`: test may run, but the result is likely to be inconclusive or take more than 30 days;
- `INSUFFICIENT`: no responsible completion path based on current observations;
- `UNKNOWN`: required history is unavailable; collect a bounded baseline before deciding.

An `INSUFFICIENT` product cannot start a revenue experiment. A merchant may preview the content, collect a baseline, choose a better candidate or exit without being pushed into a meaningless test.

### Content and evidence

Autopilot reuses the existing governed generation pipeline.

- Build Universal first; angle variants are prepared only when the source has distinct supported material.
- Reject content that merely paraphrases the Original without a meaningful presentation change.
- Preserve numbers, qualifications, market, locale, variant and policy scope.
- Low-risk content may enter the bundled approval after automated checks.
- Medium-risk content is highlighted for explicit review.
- High-risk and prohibited content is excluded.
- Review text is never generated or materially rewritten.
- Content cannot be served after its source becomes materially stale.

### Acquisition mapping

P0 mapping is deterministic and conservative.

- Use explicit supported parameters and exact normalized UTM/referrer rules.
- Store every proposed rule in the approved plan snapshot.
- Ambiguous or unknown traffic defaults to Universal or Original according to the registered plan.
- Do not use runtime model classification.
- Do not create an angle variant when eligible traffic coverage is too low to support it.
- Mapping changes during an experiment require a new version and must not rewrite history.

## Autopilot plan and authority

An Autopilot plan is the atomic unit the merchant approves. It contains:

```text
plan_id
merchant_id
product_id
plan_version
state
candidate_score_snapshot
content_version_ids[]
content_hashes[]
evidence_snapshot_hash
mapping_versions[]
unknown_traffic_policy
aa_protocol_snapshot
real_experiment_protocol_snapshot
safety_policy_version
authorized_transitions[]
approval_record optional
expires_at
created_at
updated_at
```

Allowed plan states:

```text
PREPARING
READY_FOR_APPROVAL
APPROVED
WAITING_FOR_THEME
VERIFYING
AA_RUNNING
AA_FAILED
REAL_TEST_RUNNING
PAUSED
RESULT_READY
INVALIDATED
```

Every transition must be idempotent and recorded with:

```text
from_state
to_state
actor_type: MERCHANT | SYSTEM | OPERATOR
actor_id
reason_code
gate_snapshot_hash
occurred_at
```

Autopilot may execute only the transitions listed in the approved plan. It may always take a safety transition to `PAUSED` or `INVALIDATED` and return the storefront to Original.

## Orchestration rules

The existing scheduled automation becomes the only system actor allowed to advance approved plans.

### Required gate sequence

1. Confirm approved immutable plan.
2. Confirm selected product remains active and published.
3. Confirm approved content and evidence are current.
4. Confirm theme block is active on the published product template.
5. Confirm Web Pixel, checkout join, consent, fallback and performance checks.
6. Register the frozen A/A protocol.
7. Start A/A and monitor its registered minimum duration and sample target.
8. Snapshot the mature A/A result.
9. If A/A passes, register the frozen real experiment from the approved plan.
10. Start Original-versus-Universal Stage 1.
11. Monitor safety, order recovery, data maturity and protocol validity.
12. Snapshot the first mature real result and stop or continue only as predeclared.
13. Present the result and reconcile founding-beta entitlement.

### Failure behavior

- A transient job failure retries with bounded backoff and does not duplicate a transition.
- A stale content, mapping or protocol hash invalidates the plan before launch.
- Failed A/A pauses progression and displays one measurement issue; it never silently starts the real test.
- Runtime safety rollback stops new treatment rendering within five minutes.
- An invalid experiment preserves its evidence but cannot produce a commercial uplift claim.
- Operator override requires a reason, named actor, scope and expiry; it cannot override prohibited claims or missing merchant approval.

## Merchant attention policy

Create a merchant-facing interruption only when one of these is true:

- the opportunity is ready for approval;
- Shopify theme save is required;
- two or more credible product candidates are tied;
- medium-risk text needs explicit acknowledgement;
- a material source change invalidated approved content;
- theme, measurement or safety verification needs merchant action;
- traffic remains insufficient after the bounded baseline window;
- a mature result is ready;
- a paid-continuation decision is due.

Internal recovery, ordinary data collection, A/A progression, report maturity and passing checks must not create merchant tasks.

P0 delivery is in-app. Optional email or external messaging requires an explicit merchant-provided destination and consent and is P1.

## Dashboard information architecture

### Home

The home page contains:

1. current merchant-facing state;
2. one primary action or `No action needed`;
3. selected product and current storefront policy;
4. completion band or result;
5. safety status and Pause;
6. compact activity history.

### Advanced details

The following remain available but are collapsed by default:

- content and evidence;
- product score and qualification assumptions;
- theme and checkout QA evidence;
- A/A health and sample-ratio diagnostics;
- experiment registration;
- arm metrics, mappings and confounders;
- audit and operator controls.

Merchant-facing navigation must not require visiting Governance, Setup, Measurement and Operations to complete the happy path.

## Entitlement and billing behavior

The current free-until-result entitlement must be changed to reflect result quality:

| Mature outcome          | Founding-beta behavior                                            |
| ----------------------- | ----------------------------------------------------------------- |
| Positive                | Offer USD 49/store/month continuation, locked for 12 months       |
| Negative                | Keep access free for one revised experiment or 30 additional days |
| Inconclusive            | Keep access free for one revised experiment or 30 additional days |
| Invalid                 | Free period continues; the failed result does not trigger billing |
| A/A Validated or Failed | Free period continues                                             |

Billing remains disabled until the owner confirms pricing, Shopify billing is implemented and the paid path passes review. No merchant may be charged solely because a result snapshot exists.

Acceptance criteria:

- Entitlement transition is idempotent and references the triggering immutable snapshot.
- Negative, Inconclusive and Invalid do not enter a payable state.
- A merchant sees the continuation price before accepting a charge.
- Declining continuation stops treatment and returns the storefront to Original without deleting result evidence.

## Data and implementation requirements

### New persistence

Add these entities or equivalent normalized records:

- `AutopilotPlan` — immutable recommendation/authority snapshot and current state.
- `ProductCandidateScore` — versioned score inputs, result and duration band.
- `AutopilotTransition` — append-only transition audit.
- `MerchantNotice` — deduplicated in-app attention item with resolution state.

Existing `ExperienceVersion`, `EvidenceObject`, `Approval`, `ExperimentRegistration`, `ExperimentResultSnapshot`, `SafetyEvaluation`, `OperationalAlert`, `AuditLog` and `BetaEntitlement` remain authoritative for their current domains. Do not duplicate their payloads when stable identifiers and hashes are sufficient.

### Service boundaries

- `autopilot-preparation.server` — sync, eligibility, ranking and plan construction.
- `autopilot-orchestrator.server` — idempotent gate evaluation and state transitions.
- `autopilot-presentation.server` — converts technical state into the five merchant states.
- `incremental-value.server` — verified in-test estimate and separate projection formatting.
- Existing governance, measurement and pilot-safety services remain authoritative and must be called rather than reimplemented.

### User actions

The merchant-facing application needs only these P0 commands:

```text
approve_plan(plan_id, plan_hash)
open_theme_editor(plan_id)
verify_theme(plan_id)
pause_plan(plan_id)
resume_or_revise(plan_id)
accept_paid_continuation(plan_id)  // unavailable while billing is disabled
```

Commands must be authenticated, merchant-scoped, CSRF-protected where applicable, idempotent and audit logged.

### Background execution

- The five-minute automation job evaluates approved plans and live experiments.
- Per-plan locking prevents two workers from advancing the same plan.
- Each transition has a stable idempotency key.
- Shopify API calls use bounded retries and respect rate limits.
- Automation emits operational alerts separately from merchant notices.
- One writer and the 25-store cap remain mandatory while SQLite is used.

## Telemetry and learning plan

Record the following events with merchant, plan version, source and timestamp but no unnecessary customer PII:

```text
autopilot_preparation_started
autopilot_preparation_completed
autopilot_preparation_failed
opportunity_viewed
candidate_changed
plan_approved
theme_editor_opened
theme_verified
activation_blocked
aa_started
aa_passed
aa_failed
real_experiment_started
experiment_auto_paused
result_ready
result_viewed
continuation_offer_viewed
continuation_accepted
continuation_declined
manual_intervention_started
manual_intervention_resolved
```

Required funnel reporting:

- install to prepared opportunity;
- opportunity view to approval;
- approval to published-theme verification;
- verification to valid A/A;
- valid A/A to real experiment;
- real experiment to valid result;
- result to paid continuation;
- elapsed calendar time and active merchant time at every step;
- block reason and recovery rate;
- manual interventions per activated store.

The first cohort must separately classify failures as acquisition, qualification, onboarding, instrumentation, experiment completion, economic result or willingness-to-pay failures.

## Security, privacy and compliance

- Request only the minimum Shopify scopes required by enabled features.
- Product scoring must not use customer name, email, address or phone.
- Store only order and session fields required for measurement and declared retention.
- Honor Shopify mandatory privacy webhooks and documented deletion windows.
- Do not expose raw order or customer data in merchant notices or telemetry.
- Keep content approval, launch authority and billing consent separate audit events.
- Do not enable a vertical or jurisdiction excluded by the claims policy.
- Public language must say `estimated incremental revenue`, not guaranteed or certain extra earnings.

## Accessibility and performance

- Happy-path actions are keyboard accessible and meet WCAG 2.2 AA.
- Status is conveyed by text, not color alone.
- Progress and result updates use appropriate live-region behavior without excessive announcements.
- Theme extension budgets and rollback thresholds in the MVP PRD remain unchanged.
- The simplified dashboard must meet current Built for Shopify performance targets before submission.

## Delivery plan

### Increment 1 — Autopilot foundation

- Add plan, score, transition and notice persistence.
- Implement deterministic candidate eligibility/ranking.
- Build an immutable plan from existing content, mapping and protocol records.
- Add state presentation and transition tests.

Exit gate: a development store can produce a reproducible `READY_FOR_APPROVAL` plan, and identical inputs create the same recommendation and hashes.

### Increment 2 — Three-moment merchant experience

- Replace the seven-stage home and get-started happy path with the five-state home.
- Add Opportunity review and bundled approval.
- Add theme-editor deep link and published-theme verification loop.
- Retain all technical workspaces under Advanced.

Exit gate: a new merchant completes all required active setup in under five minutes in an observed clean-store usability test.

### Increment 3 — Automatic experiment progression

- Extend scheduled automation with plan orchestration and locking.
- Auto-register/start A/A after verification.
- Auto-register/start the frozen real experiment only after passing A/A.
- Add merchant notices, pause, invalidation and rollback behavior.

Exit gate: an end-to-end simulated clock test advances a store from approval to mature result without operator actions and fails safely at every injected gate failure.

### Increment 4 — Value and commercial decision

- Build the outcome-first result card.
- Add verified incremental-revenue and separate projection service.
- Correct entitlement behavior by result state.
- Implement Shopify billing only after owner approval.
- Add Autopilot funnel dashboard and first-cohort operator view.

Exit gate: Positive, Negative, Inconclusive and Invalid fixtures produce the correct language, entitlement and allowed actions.

### Increment 5 — Launch verification

- Run full unit, integration, type, lint and production builds.
- Run browser QA on clean install, opportunity, theme save, A/A, result and pause paths.
- Verify accessibility and storefront performance budgets.
- Complete production hosting, backups, restore drill, monitoring and Shopify review gates.

Exit gate: all P0 acceptance criteria and the public-beta launch checklist pass against the production origin.

## Required test scenarios

At minimum, automated coverage must prove:

1. a single clear product is selected deterministically;
2. a material tie requests a merchant choice;
3. missing historical data cannot produce a precise duration promise;
4. an excluded product never becomes approvable;
5. unsupported text cannot enter a plan;
6. approval freezes content, evidence, mappings and protocols;
7. changing any frozen hash invalidates authority;
8. an unpublished theme never passes verification;
9. A/A cannot start before every technical gate passes;
10. a failed A/A cannot start a real experiment;
11. a passing A/A advances exactly once;
12. a safety failure pauses treatment and serves Original;
13. early results cannot be labeled final;
14. Negative and Inconclusive remain eligible for the free extension;
15. Invalid does not end free access;
16. repeated automation calls do not duplicate experiments, transitions, notices or charges;
17. one merchant cannot read or mutate another merchant's plan;
18. pause remains available and effective throughout live measurement;
19. verified value and projected value cannot be confused in screen-reader or visual output;
20. uninstall disables storefront behavior and stops plan automation.

## Launch gates

Autopilot acquisition remains blocked until:

- all P0 requirements in this PRD are traceable to passing tests;
- the original-storefront fallback is verified on the production origin;
- the theme extension is verified on at least one clean published development-store theme;
- order/refund reconciliation and A/A pass with production configuration;
- external monitoring, alerting, backups and an isolated restore drill pass;
- Shopify protected-data and App Store review requirements are satisfied;
- legal terms, app name, support hours, listing assets and pricing are owner-approved;
- no result or revenue language implies certainty beyond the registered estimate.

## Decisions still required from the owner

- Public app name.
- Final acceptance or revision of the USD 49 founding-beta continuation price.
- Whether billing launches with the first acquisition cohort or remains disabled until the first results.
- Governing law and final terms approved with counsel.
- Production Fly.io account, app hostname and Flapp subdomain.
- Support hours and operational incident destination.
- Final icon, screenshots and Shopify listing approval.

These decisions do not block implementation of the Autopilot foundations, interface or experiment orchestration. They do block paid public launch or App Store submission where applicable.

## Relationship to existing specifications

- [MVP PRD](./03-mvp-prd.md) remains authoritative for runtime behavior, performance, accessibility and core functional scope.
- [Measurement specification](./04-measurement-specification.md) remains authoritative for eligibility, randomization, maturity and result classification.
- [Claims and safety policy](./06-claims-safety-policy.md) remains authoritative for evidence, risk and approval eligibility.
- [Public-beta product strategy](./13-public-beta-product-strategy.md) remains authoritative for funnel framing and capacity boundary.
- [Hosting and pricing recommendation](./18-hosting-and-pricing-recommendation.md) supplies the current commercial and deployment assumptions.

Where this PRD changes merchant-visible activation and entitlement behavior, it supersedes the corresponding UI sequence and result-trigger wording in the MVP PRD and public-beta strategy. It does not weaken any technical or governance gate.

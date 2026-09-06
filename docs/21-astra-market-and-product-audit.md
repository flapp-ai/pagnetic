# Pagnetic: market, product, architecture and measurement audit

Date: 2026-09-05  
Status: audit and recommended direction; implementation changes are not approved releases  
Companions: [experience specification](./22-pagnetic-value-and-experience-prd.md), [execution and validation plan](./23-pagnetic-improvement-execution-plan.md), [reproducible probes](./audit-2026-09-05/reproduce-findings.ts)

## 1. Verdict

**Keep the product, narrow the customer, strengthen the intervention, and repair the evidence engine before public acquisition.**

Pagnetic has a useful foundation: approved source material, deterministic runtime assignment, Shopify extensions, a merchant pause control, order reconciliation, and experiment snapshots. Those are worthwhile assets. They do not yet establish that the app is commercially differentiated or that its automated revenue conclusions are reliable.

The largest risk is the combination of a small intervention, a broad low-traffic audience, a long wait for evidence, and a subscription that only becomes payable after a positive result. Each weakens the others. More onboarding polish alone will not fix that model.

The recommended customer promise is:

> **Turn your best ad promise into a clearer product page—and measure whether it sells more.**

Supporting explanation: Pagnetic identifies a specific gap between a campaign and its landing product page, proposes a source-backed message, handles a controlled test, and explains whether to keep it. One approved change, one Shopify save, one clear decision.

This is a proposed positioning, not a claim that the current implementation already reads advertisements or optimizes profit. Success must be established with paying merchants and defensible results. No audit can guarantee market success.

## 2. What was actually inspected

- Current source: public preview, merchant dashboard, setup and activation, preparation, orchestration, runtime, extension JavaScript/Liquid, pixel, attribution, analysis, health, entitlement, roles, automation, database schema, deployment and backup configuration.
- Current public page and signed-in Shopify merchant dashboard, including a rendered screenshot. The observed merchant state is blocked verification, not a mature result.
- Existing automated suite: **79/79 passed** on 2026-09-05 using bundled Node 22. No production deployment was performed for this audit.
- Additional read-only synthetic probes: result maturity, empty A/A, maximum duration, missing arm, duplicate variants, misleading duration estimate, expired attribution.
- Current official Shopify, Fly, research and competitor sources linked below. Competitor features/prices are vendor claims, not independently tested product quality.

Scope limits: no merchant interviews; no real partner conversion dataset; no fresh high-load benchmark; no full keyboard/screen-reader/mobile matrix; no adversarial production traffic; no production privacy/payment/settings changes. Source findings are distinguished from reproduced failures and live UX observations.

## 3. Market challenge: the platform is becoming a competitor

Shopify announced theme and checkout A/B testing in Rollouts on June 5, 2026. Experiments are available on Grow and higher plans; basic rollout functionality is available on Basic and higher. This undermines differentiation based only on providing Shopify A/B testing. It does not prove Shopify offers Pagnetic's proposed campaign-message workflow. [Announcement](https://changelog.shopify.com/posts/schedule-publish-and-a-b-test-new-themes-and-checkout-and-customer-account-configurations), [plan requirements](https://help.shopify.com/en/manual/markets/rollouts/requirements-and-considerations).

| Alternative | Current advertised offer | Implication for Pagnetic |
| --- | --- | --- |
| Shopify Rollouts | Native theme/configuration testing on eligible plans | An embedded test engine is infrastructure, not sufficient differentiation |
| Intelligems | Smart Content from $69/month; content/audience tests and profit metrics | “AI + personalization + measurement” is already occupied |
| Visually | $15/month up to 100 orders; $80 up to 600; broader testing and personalization | Being cheaper than $69 does not create a durable position |
| Shoplift | Core $99/month; theme/template/URL tests and applying winners | Keeping a winner is a basic expectation |
| Replo | Starter $119/month, page creation and a testing allowance | Creating a visibly better landing experience competes for the same budget |

Sources checked 2026-09-05: [Intelligems](https://apps.shopify.com/intelligems), [Visually](https://apps.shopify.com/visually-io), [Shoplift](https://apps.shopify.com/shoplift), [Replo](https://apps.shopify.com/alchemy). Prices are entry points with different limits, not equivalent bundles. The market table is evidence of alternatives, not proof of willingness to pay for Pagnetic.

Shopify also markets AI shopper simulations through SimGym. Simulated shopper feedback must not be presented as actual revenue lift. Pagnetic should not spend its next sprint replicating a generic AI website grader. [Shopify Test & Launch](https://www.shopify.com/test-and-launch).

### Defensible focus

Own the decision workflow connecting **ad promise → page evidence → approved intervention → measured outcome → next action**. Specific differentiation to earn:

1. A diagnostic that identifies a visible, correctable mismatch, with actual evidence on both sides.
2. A useful proposed change in the merchant's real theme, not five renamed copies of the same description.
3. Less merchant work than configuring a general testing platform.
4. A trustworthy record of what worked, for which product/campaign, and under which conditions.
5. Continued useful decisions after the first result.

None of these is an established moat today. Proprietary, permissioned outcome records and effective workflows may become defensible through repeated use. A keyword list and one generated headline will not.

## 4. Customer and business model

### First customer hypothesis

Start with an established DTC merchant or its performance-marketing operator: one stable, in-stock hero product; meaningful paid traffic to that PDP; several identifiable advertising promises; source material supporting a concrete benefit; no overlapping page test. Begin with one language and one reporting currency. Prioritize low-claims-risk home accessories or everyday outdoor accessories as discovery candidates, not a final market decision.

Qualification should be driven by the detectable economic effect within a bounded window, not store revenue or total sessions alone. A store can have 100,000 site visits and only a few hundred consented visits to the target product/campaign. The latter population determines feasibility.

Exclude from the initial promise: brand-new stores, sparse traffic, unsupported headless/theme flows, rapidly changing offers, unverifiable claims and campaigns with no recoverable message signal. Give these merchants a useful preview and an honest readiness path. Do not sell them a near-term statistically conclusive revenue test.

### The traffic arithmetic

The implementation records 80% power and a 5% meaningful relative lift but uses a fixed target of 1,000 sessions. These are not interchangeable assumptions. Under an illustrative 3% baseline conversion rate, independent sessions, fixed AOV, 50/50 allocation, two-sided 5% significance and 80% power:

| Relative conversion improvement | Baseline → treatment | Approximate total sessions | Days at 1,000 eligible sessions/day |
| --- | --- | ---: | ---: |
| 5% | 3% → 3.15% | 415,876 | 416 |
| 10% | 3% → 3.3% | 106,422 | 107 |
| 20% | 3% → 3.6% | 27,828 | 28 |

Calculated by the included probe. This is an illustration of scale, **not** a production RPS power calculator. Variable order value, repeated visitors, consent coverage and returns alter the required sample; uncertainty must be estimated on the actual randomization unit and metric. General experimental power and cluster-aware metric design are covered by [Microsoft Research](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/06/ftir-online-evaluation-final-journal.pdf).

Therefore: target merchants where a materially stronger intervention can be measured, show minimum detectable effect before approval, and decline infeasible experiments. Do not quietly replace the revenue endpoint with clicks to manufacture a win.

### Why the current free-until-positive offer is fragile

- It selects for merchants with little traffic who may never reach a decision.
- It makes revenue depend on statistical significance, while the company pays acquisition and support costs for every installation.
- It creates pressure to overstate noisy positive results and disregard useful negative findings.
- A merchant can copy a static winning message into the theme and uninstall. Recurring value must come from the next useful decision.
- The current entitlement service offers a revision, but the Autopilot journey does not complete that revision/paid-continuation loop.

An illustrative cohort of 100 installs, 60% qualified, 70% activated, 60% reaching a valid result, 30% positive and 40% accepting $49 yields about **3 paying stores / $148 MRR**. These are assumptions, not forecasts. Even excellent infrastructure economics cannot rescue an expensive support funnel.

### Recommended commercial experiment

Keep existing commitments intact. For a new, explicitly limited discovery cohort, test a free preview plus one bounded assisted evaluation. Show the price before approval. After that evaluation, ask for an explicit paid continuation based on ongoing campaign-message operations, not a “positive result unlocks billing” switch.

Use **$99/store/month as a new-cohort price hypothesis**, alongside a small sequential $49 cohort if needed to distinguish price resistance from lack of value. Do not call either validated. One hero product and one active test keep the offer intelligible. Do not charge a percentage of estimated incremental revenue in the MVP; counterfactual estimates and refunds make such invoices contentious.

Define the trial in days **from verified activation**, with the exact end date and included support visible. A proposed 45-day evaluation can accommodate some qualified tests; do not promise every test will mature within it. If the forecast exceeds the allowed window, offer preview/diagnostic mode or decline the experiment. Any extension is explicit and bounded.

At $99, a hypothetical $10 direct service cost plus 30 minutes monthly support at a loaded $50/hour leaves $64 before acquisition and overhead (about 65%). At $49 it leaves $14 (about 29%). These are unit-economics sensitivities; measure actual support minutes and costs. Raise value and reduce recurring support before scaling acquisition.

Use Shopify's current **Shopify App Pricing** flow for the eventual implementation. Its subscription state must be verified server-side; URL parameters and a positive result are not payment authorization. [Official billing documentation](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing).

### Go-to-market sequence

Use a small assisted cohort to learn, while keeping the merchant UI simple. Begin with 5–8 qualified stores, recruited through a few performance-marketing operators/agencies and direct discovery. The App Store can become an acquisition channel after the install-to-value flow works; it is not a replacement for customer discovery.

An agency is a possible distribution partner, not a reason to build a portfolio dashboard now. Show a sample mismatch report, observe whether the merchant agrees with it, and ask for a paid continuation. Measure activation, useful decisions, support time and retention rather than install counts alone.

## 5. Engineering and algorithm findings

Severity: P0 blocks unattended merchant testing or trusted revenue conclusions; P1 blocks credible self-serve commercialization; P2 is later improvement. “Source” means verified in code but not reproduced on a live store. Findings below are not claims that past QA orders suffered these effects.

| ID | Severity / evidence | Finding and customer consequence | Required correction |
| --- | --- | --- | --- |
| A01 | P0 / source | Theme Liquid binds `experiment_id`; JS sends that fixed key; resolver requires exact active key. Autopilot creates a different key at A/A → A/B. Default block mode is `original`. No automatic active-plan resolver was found. The database can advance while shoppers never enter the new test. | Resolve a server-owned active deployment by shop/product; remove merchant experiment IDs from the normal path; test both stages through the real storefront without another theme save |
| A02 | P0 / reproduced | `analyzeExperiment` validates zero-order A/A with `healthReadiness: COLLECTING`; absence of a detected difference is treated as validation. | Require healthy instrumentation and sufficient information; use an explicit validation/equivalence criterion; no empty-revenue equality proof |
| A03 | P0 / reproduced | When `endedAt` is null, maturity is minimum duration + lag from start. New orders near the cutoff have not received that lag. | Separate enrollment close, attribution close, refund maturity and final analysis; freeze the cohort before finalization |
| A04 | P0 / reproduced | `maximumDurationDays` is accepted but not enforced in analysis; insufficient samples can collect indefinitely. | Stop enrollment at the registered deadline; produce an insufficient-evidence outcome after maturation |
| A05 | P0 / source | Report health divides experiment-attributed orders by **all merchant orders** in the date range. A one-product experiment can appear broken because unrelated products sell. | Use an explicitly defined eligible order population, show off-scope orders separately, and compare missingness by arm |
| A06 | P0 / source + mocked attribution probe | Report maps attributed orders without checking payment status or the stored test marker. Attribution accepts an expired assignment; no order-window check occurs there. | Normalize financial state, test eligibility and attribution windows into a ledger; reject/quarantine stale joins; replay edge cases |
| A07 | P0 / source | Visitor and session randomization are mixed in one registration; report discards randomization-unit type. | Freeze one unit or explicitly stratify; carry unit/cohort through reporting and stop when identity behavior violates the design |
| A08 | P1, before real qualification / source + probe | Fixed 1,000-session protocols; assumed 28-day history; `UNDER_14_DAYS` can mean 10 collection days despite current sequential stage floors totaling at least 35 days. | Calculate feasibility from baseline variance and exposure coverage; show complete calendar duration with uncertainty |
| A09 | P1 / live UI | Dashboard says “paused before making an unsafe change”, “one item needs attention” and “no action needed” together. Two raw keys appear under a single-step heading; there is no notice action button. | Derive status and CTA from one presentation model; distinguish ordinary setup from incidents; route the precise blocker |
| A10 | P1 / source | `RESULT_READY` has no transition to a serving-winner state. Home actions lack keep-winner, revised-plan and paid-continuation flows. | Implement a complete decision/serving/revision/billing lifecycle before charging for recurring value |
| A11 | P1 / reproduced + source | Three angle previews can be identical. Draft headline is the existing title; benefits are reordered source excerpts; supporting line/proof/reassurance are empty. | Add a real mismatch diagnostic, distinct intervention requirement and abstention; preserve grounding while allowing useful composition |
| A12 | P1 / source | Candidate scoring hardcodes acquisition coverage to 0.5 whenever any active mapping exists; scores source length and stock fraction; omitted category input does not establish candidate-level exclusion. | Measure actual covered traffic, currency-aware economics and observed stability; wire exclusions explicitly; label heuristics honestly |
| A13 | P1 / source | Baseline “eventCoverage” is unique sessions / product-view events. Repeated product views lower this even when capture is perfect. Early baseline sessions depend on a decision bridge that may arrive after product_viewed. | Independent consent-aware session identity and matched reference counts; baseline event-order tests; use actual observation start |
| A14 | P1 / source | Native form attribution attaches the hero decision to all `/cart/add` forms; pixel stores one latest decision without TTL/product scope. First tagged line wins the order join. | Scope forms by product/variant and define cross-product policy; use bounded, product-aware references; test quick-add, multiple tabs and delayed checkout |
| A15 | P1 / source | Runtime makes synchronous DB reads/writes; reports load all events/orders into memory. One SQLite writer shares the serving and reporting workload; shop-wide limiter is 600 decisions/min. | Keep modular monolith; bound reports, add durable jobs, benchmark by request volume and migrate to managed Postgres before multi-store scale |
| A16 | P1 / source | Fly backup path is `/data/backups`, beside the database. “Verified backup” check only finds a `.sqlite` filename. Alert delivery does not check HTTP success. | Off-volume verified backup, restore/age/checksum evidence; confirmed delivery, retry/outbox and external dead-man monitoring |
| A17 | P1 / source | Privacy API absence returns analytics/preferences allowed; session identity is created before denied preflight; server trusts consent strings; pixel key is client-delivered. | Explicit unknown/denied behavior, consent-gated identity/storage, bounded signed context and event validation; do not treat pixel token as shopper authentication |
| A18 | P1 / source | Theme verification checks extension activation, not actual selected product render/configuration. QA checkboxes share one evidence string; all stores require Shop Pay regardless of applicability. | Product/template/runtime acknowledgment; evidence per check/version; PASS/FAIL/PENDING/NOT_APPLICABLE with justified applicability |

### Source locations

- A01: `extensions/adaptive-panel/blocks/adaptive-panel.liquid:7`, `storefront/adaptive-panel.js:282`, `app/services/measurement.server.ts:474`, `app/services/autopilot-orchestrator.server.ts:557`.
- A02–A04: `app/services/experiment-analysis.ts:229`; automation finalizes through `app/services/automation.server.ts:203` and `autopilot-orchestrator.server.ts:595`.
- A05–A07: `app/services/experiment-report.server.ts:33`, `measurement.server.ts:515`, `measurement.server.ts:975`, `measurement.server.ts:1123`.
- A08/A12/A13: `app/services/autopilot.ts:83`, `autopilot-preparation.server.ts:55`, `autopilot-preparation.server.ts:166`, `autopilot-preparation.server.ts:600`.
- A09/A10: `app/routes/app._index.tsx:320`, `app/services/autopilot-presentation.ts:39`, `autopilot.ts` transition table, `beta-entitlement.server.ts`.
- A11: `app/services/governance.server.ts:764`, `app/services/public-preview.ts:100`.
- A14/A17: `storefront/adaptive-panel.js:84`, `storefront/adaptive-panel.js:333`, `extensions/adaptive-measurement/src/index.ts`, `measurement.server.ts:802`.
- A15/A16: `storefront.experience.ts:24`, `experiment-report.server.ts:19`, `fly.toml`, `scripts/backup-sqlite.sh`, `scripts/partner-readiness-check.ts:106`, `automation.server.ts:78`.
- A18: `app/services/pilot-setup.ts:160`, `pilot-setup.server.ts` (`savePilotQa`), `autopilot-orchestrator.server.ts:449`.

### Measurement nuance and additional review items

The ratio-of-total-revenue-to-total-sessions estimator uses visitor-cluster residual variance, which is a sensible foundation. Do not replace it casually with an unclustered t-test. Repair the sampling, eligibility, windows and readiness rules, then calibrate intervals using simulated heavy-tailed/zero-inflated data and an independent implementation.

The single-arm probe is a defense-in-depth defect: report-level allocation health should catch a large imbalance, but the analysis function itself only adds a reason and still labels the A/A validated. A zero-order but otherwise balanced A/A is the more direct pipeline risk.

No blanket accusation of optional-stopping significance inflation is warranted: automation generally snapshots at the first mature opportunity. The demonstrated problems are an open cohort, ambiguous finalization, unused maximum duration and inadequate information gates. If future dashboards allow repeated winner selection, use a predeclared sequential method or retain a fixed-horizon rule.

Order totals currently mix “gross”, current totals and refund updates without a fully declared merchandise/tax/shipping policy. Reordered webhook delivery may overwrite newer totals; refund-before-order returns without durable pending processing. These require realistic integration replay fixtures. Currency is checked for heterogeneity but not normalized; restrict the launch currency or build an audited conversion policy. Formatting minor units with `/100` cannot cover all currencies.

Assignment-to-order linkage through a selected line item can miss purchases of another product by an eligible visitor. Choose an estimand honestly: whole-store revenue for the eligible cohort needs cohort-level order linkage; focal-product revenue needs item-level accounting. It is not enough to name a metric “intent to treat” while conditioning observable revenue on a tagged product purchase.

Case-insensitive token matching is not semantic understanding of an advertisement. Inferred angle mappings without a version also weaken reproducibility. Freeze the resolver version, precedence, approved mappings and ambiguity policy; use explicit campaign IDs/links before inference.

## 6. Architecture direction

Keep TypeScript, React Router, Shopify extensions, and a modular monolith. Moving to AWS, Azure or Google Cloud does not address the dominant algorithm or product risks. Fly can remain the application host. Avoid a microservice rewrite.

Recommended boundaries inside the application:

1. **Preparation:** catalog/ad evidence ingestion, source extraction, candidate generation and approval. Slow work runs in durable jobs.
2. **Serving:** product-scoped active deployment, consent eligibility, sticky assignment, immutable approved content, bounded response and fallback. UI never configures experiment identifiers.
3. **Evidence:** versioned events, order/refund ledger, timestamped reconciliation, cohort projection and analysis snapshots.
4. **Lifecycle:** atomic deployment transitions, pause/resume, maturation, result, keep/revise/stop and subscription entitlements.
5. **Operations:** job leases/retries, audit, alert delivery, backup evidence, telemetry and capacity limits.

Introduce a transactional `ActiveDeployment` pointer and an outbox. Keep the identity/routing contract stable while stage IDs change. Capture one durable assignment before exposure. Reports should read bounded projections, not deserialize a store's lifetime events during each five-minute maintenance run.

For unattended multi-store operation, recommend managed PostgreSQL with PITR, then multiple application instances once session/lease/limiter behavior is safe. Until then use one supervised store and a verified off-volume recovery process. A 25-store numeric cap is not a load benchmark. Fly volumes have no built-in replication and platform snapshots should not be the primary backup. [Fly volume documentation](https://fly.io/docs/volumes/overview/).

Performance should protect the shopper, not merely satisfy a server timer. The current split telemetry is useful, but a 1,000 ms network allowance does not prove acceptable mobile rendering or absence of layout shift. Retain old registrations as historical records; prospectively validate deadline, visual stability, errors and added latency before choosing new limits. Shopify assesses before/after performance across storefront surfaces. [Shopify performance testing](https://shopify.dev/docs/apps/build/performance/storefront).

Security work should include tenant-scoped foreign-key invariants, concurrent installation/owner-role bootstrap, role delegation, forged/replayed client events, uninstall/reinstall entitlements, logged identifier minimization, retention across projections/backups, and theme-source/ad-content prompt injection if a generator is introduced. Existing safeguards reduce risk; a test-store smoke pass is not a complete security audit.

## 7. UX judgment

The current visual design is clean enough for a pilot. The priority is state correctness, credible previews, and a useful next action. Increasing visual decoration would not solve the observed friction.

The public page leads with “a safer adaptive PDP experiment” and exposes A/A before the merchant sees a business diagnosis. The headline promises campaign matching while the input contains only a product URL. Request one campaign/ad text when needed and show an immediate specific gap. Avoid claiming to know why shoppers arrived from generic page text alone.

The blocked dashboard visually resembles an incident, though the observed cause is incomplete setup. Replace alarming “unsafe change” copy with a neutral, owned task. Reserve critical styling for actual shopper-impacting failures. “One clear next step” must include a working button.

The approval view uses a generic Original placeholder instead of the actual page, and exposes opportunity scores, risk IDs and methodology language. A merchant must be able to see the exact intended difference in context, approve or edit it, and understand its source. Move internal scores and experiment notation to details.

The result must say “Estimated additional sales during this test,” with uncertainty and scope beside it. “Verified” can imply certainty about an unobservable counterfactual even when paired with “estimate.” Do not label revenue as profit. Show a concrete keep/revise/stop action and a useful next opportunity.

The full screen/state/error/accessibility requirements are in the [experience PRD](./22-pagnetic-value-and-experience-prd.md).

## 8. What changes the launch decision

Prior 7/9 QA progress and 79 tests are valid historical engineering evidence. **They are not a launch certificate.** This audit supersedes earlier claims that only owner actions remain.

The first work is A01–A07 plus the blocked-state UI and complete baseline/routing contract. Then validate the quality of proposed changes with merchants before building many integrations. Only expand acquisition after the complete install → real storefront test → mature result → next action has been demonstrated.

Do not require Shopify Payments to finish all Pagnetic development or to serve stores that do not use Shop Pay. Build a conditional compatibility gate: Shop Pay must pass on the supported paths where it is enabled; a disabled/unavailable path is documented as not applicable. Never turn an untested enabled path into a pass. Native payment-provider business requirements belong to the merchant's supported payment configuration.

Uncertainty will remain about market demand until merchants choose the product, accept its proposals, receive useful decisions and keep paying. The execution plan specifies those learning gates and what to do if the thesis fails.

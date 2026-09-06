# Pagnetic: ordered improvement and market-validation plan

Date: 2026-09-05  
Status: proposed execution backlog; no production code, price or merchant authorization changed by this audit  
Inputs: [audit](./21-astra-market-and-product-audit.md), [experience PRD](./22-pagnetic-value-and-experience-prd.md)

## 1. Operating decision

Treat the current deployment as an internal release candidate. Preserve test-store evidence and frozen registrations. Stop representing the remaining work as only Shopify Payments and owner paperwork: the audit found missing product behavior and measurement defects.

Repair the complete value-delivery path before buying installations. Validate the usefulness of the message intervention alongside engineering with a small assisted cohort. A narrowly useful product that customers repeatedly pay for is the goal; the number of implemented PRD bullets is not the market outcome.

No new platform rewrite is required. Keep Fly for application hosting. Database resilience, jobs, storefront routing and statistical integrity are the architecture priorities.

## 2. Sequencing and dependencies

| Phase | Outcome | Effort estimate | Exit gate |
| --- | --- | --- | --- |
| 0 — Baseline | Reproducible audit and honest launch status | Completed in this audit | Documents, probes and 79-test run recorded |
| 1 — Trust and delivery | Storefront follows approved lifecycle; results respect financial/cohort rules | 8–12 engineering days | E01–E06 acceptance cases pass |
| 2 — Immediate customer value | Specific diagnosis, useful intervention and actionable setup | 6–10 engineering/design days | E07–E10 plus observed usability gate |
| 3 — Complete operating product | Keep/revise/stop, resilience, real entitlements | 5–8 engineering days | E11–E14 and release rehearsal |
| 4 — Assisted market test | Feasible real-store tests and willingness-to-pay evidence | Traffic-dependent, usually several additional weeks | Cohort learning gates below |
| 5 — Broader acquisition | Repeatable activation and acceptable economics | Not scheduled before evidence | Public-launch gate passes |

Estimates are planning ranges for experienced implementation and review, not commitments. Expect roughly 4–6 engineering weeks with sequencing and rework, then statistical collection/maturation time. Do not compress the experiment window to meet a marketing date. Discovery can run while engineering progresses, but live merchant treatment waits for the relevant technical gates.

## 3. Engineering backlog

### E01 — Product-scoped deployment routing

Priority P0; findings A01/A18. Owns the first implementation milestone.

- Add `ActiveDeployment(merchantId, productId, planId, experimentId?, servingPolicy, contentSetVersion, revision, status)` with one authoritative active pointer per merchant/product.
- Resolve a product's current deployment on the server. Validate merchant, approval, evidence, consent and runtime state there. The theme block sends product context, not a manually maintained experiment key.
- Preserve the explicit legacy QA path separately. Make transitions atomic, compare-and-swap on revision, and safe under retries.
- Return deployment/experiment/content versions in the decision response; verify the actual published product acknowledgment before treating setup as complete.

Acceptance: fresh install plus one theme save; validate A/A decision; advance A/A to A/B; new page request observes the new approved experiment; pause shows Original; keep winner serves approved content without active test; no duplicate block or second save. Repeat using a custom product template. A database-state test alone does not pass this item.

### E02 — Bounded cohort and maturity engine

Priority P0; A02–A04.

- Version lifecycle fields: `enrollmentStartedAt`, `enrollmentClosedAt`, `attributionClosesAt`, `financialMaturityAt`, `finalizedAt`, `stopReason`.
- Enforce minimum duration, planned sample rule and hard maximum enrollment date. Under-target expiry has an explicit insufficient-evidence result.
- Finalize only a closed cohort after its attribution/returns policy, healthy diagnostics and sufficient independent information.
- Refuse validation for empty sales evidence, one missing arm or unresolved health. Separate instrumentation acceptance from revenue equivalence.
- Preserve old snapshots. New analysis versions can explain why an old candidate result is invalid; do not rewrite registered thresholds or historical reports silently.

Acceptance: turn all audit probes into meaningful regression tests; order on the final enrollment minute matures correctly; no conclusion at day 21 merely because a still-open experiment began 21 days earlier; no run collects forever at day 120; late corrections produce an explicit report revision. Simulate null effects, sparse sales, repeat visitors, variable AOV and heavy tails; compare against an independent statistical implementation.

### E03 — Financial ledger and attribution contract

Priority P0; A05/A06/A14.

- Decide and version whole-eligible-cohort vs focal-product revenue. Document the linkage evidence each requires.
- Add canonical order/payment/refund records with Shopify event IDs, source timestamps, received timestamps, version precedence, currencies, test flag and financial eligibility.
- Replay duplicate, stale, reordered and refund-before-order events without silently losing refunds or restoring stale gross/net values.
- Enforce attribution window, permitted assignment/cohort and tenant scope. Quarantine ambiguous references and enumerate exclusion reasons.
- Correct order-join denominator; unrelated products must not create a false 90%-join failure. Separate pixel coverage, eligible linkage and financial completeness.
- Scope native forms and latest-decision context by product/variant/time; handle rapid add-to-cart and multi-tab ordering.

Acceptance: duplicate paid webhook counts once; unpaid/test orders cannot inflate live results; refunds reduce the chosen revenue definition once; stale order update cannot reverse refund; expired and cross-tenant decisions fail; unrelated store orders do not fail experiment health; multi-product carts match the registered metric; no double credit across successive experiments.

### E04 — Consent, identity and baseline capture

Priority P0 for unit integrity; P1 for qualification. A07/A13/A17.

- Freeze randomization unit and assignment window. Stop pooling different identity modes without an explicit stratified design.
- Introduce consent-aware independent baseline sessions; remove dependence on a previously stored decision for first product_viewed.
- Define unknown/denied/loading/privacy-API-missing behavior for both panel and pixel. Handle late grant, revocation and cross-page transitions explicitly.
- Bound event timestamps and signed decision context; rate limit/fraud-check client signals. Treat client-visible pixel credentials as transport credentials, not proof that an event is true.
- Replace “unique sessions / page views” with meaningful capture diagnostics against an explicit reference population.

Acceptance: denied and unknown states follow declared policy; first allowed product view receives correct baseline identity; duplicate views do not lower capture completeness; late grant does not reassign an existing unit; stale latest-decision reference cannot leak into a different product/experiment; forged client revenue never overrides verified order ledger.

### E05 — Measurement feasibility and duration

Priority P1, required before real-store qualification; A08/A12.

- Add `QualificationSnapshot` with actual observation interval, data source, currency, eligible traffic and consent coverage, revenue distribution, independent units, feasible MDE and forecast interval.
- Calculate sample requirements from the registered metric and baseline variance; use a conservative uncertainty allowance for sparse baselines.
- Forecast the entire calendar sequence. Separate collection progress, elapsed minimum duration and financial maturation.
- Measure real campaign coverage and stock stability; preserve unknowns rather than assigning invented 50% coverage.

Acceptance: 1,000 sessions never implies 80% power for 5% RPS lift by default; two days of data are not treated as 28 days; 10 collection days cannot yield an under-14-day final-result promise when stage floors exceed it; an infeasible product gets a useful preview-only path.

### E06 — Runtime and financial path regression matrix

Priority P0; cross-cutting.

Run browser-backed tests on supported published themes: default/custom templates, desktop/mobile, variants, quantity, quick-add, standard/accelerated checkout, applicable Shop Pay, returning visits, two tabs, consent transitions, slow/offline proxy, missing content, evidence changes, pause/resume, uninstall/reinstall and full A/A → A/B transition. Include native form submission before a slow decision arrives.

Use test orders and explicit QA cohorts only. Persist per-check evidence with theme/product/deployment version and timestamp. PASS/FAIL/PENDING/NOT_APPLICABLE must be distinct. A checkbox or generated script output without the corresponding observation is not sufficient.

### E07 — Specific campaign diagnosis and proposal quality

Priority P1; A11/A12.

- Implement product-plus-ad evidence ingestion with optional ad input; label product-only output accurately.
- Support one vertical's actual objections/promises before generalizing the taxonomy.
- Add distinctness, source validity and abstention gates; draft one substantive intervention with a useful rationale.
- Build the 50-case evaluation set and record human acceptance/rejection reasons. Evaluate any model proposal offline; no runtime generation.

Acceptance: merchant can point to the product/ad evidence behind the suggestion; renamed identical variants are rejected; unsupported claims cannot enter approval; generic product-title repetition does not count as a useful intervention.

### E08 — Real preview, approval and enablement

Priority P1; A09/A18.

- Show actual Original vs proposed placement at mobile/desktop widths.
- Add edit/reject/choose actions, preserve source linkage on edits, and avoid asking for approval of variants that will not be used.
- Deep link to selected product/template; explain disabled Save and already-installed cases.
- Keep operator configuration off the merchant path.

Acceptance: five target users can explain what changes, what stays native, what approval authorizes and what the trial costs; at least four complete the supported setup without a spoken hint. Record time/errors; five users are qualitative evidence, not a statistically stable activation-rate estimate.

### E09 — Unified status and action model

Priority P1; A09.

- Add typed presentation fields: state, title, detail, severity, serving truth, responsible party, primary action, optional secondary action, next-check time.
- Render notice actions; resolve one highest-priority blocker and collapse the others.
- Separate normal setup, low traffic, merchant pause and real incidents. Remove internal keys and misleading “unsafe change” phrasing from routine checks.

Acceptance: no state combines blocked attention with “no action needed”; every merchant blocker has an executable correct destination; provider/operator failures do not send merchants through irrelevant settings; empty/error/loading/paused/result states pass keyboard and responsive review.

### E10 — Customer metric and trustworthy result UI

Priority P1, before displaying money; A05–A08/A10.

- Define sales/revenue/profit terms and currency units. Show estimate, uncertainty, cohort and dates together.
- Use registration confidence, suppress invalid money claims, display negative findings, and separate projections.
- Record `ReportSnapshot` versions and expose exports that match the display exactly.

Acceptance: all visible figures reconcile to a known ledger fixture; invalid results display no claimed lift; 90% confidence is not labeled 95%; future monthly projection cannot be mistaken for earned revenue; report and UI use the same denominator and as-of date.

### E11 — Keep, revise, stop and repeat

Priority P1; A10.

- Add `SERVING_APPROVED`, `REVISION_PROPOSED`, `STOPPED` lifecycle behavior and explicit merchant actions.
- Preserve the valid original/winner baseline, create new versions for changed evidence, and avoid overlapping attribution windows.
- Keep historical reports immutable. Add a next opportunity only when justified by new evidence/campaign context.

Acceptance: a positive result can become an actual approved serving deployment; a negative/inconclusive result returns to baseline; one bounded revision can be prepared/reviewed/tested; no silent reset of free allowances; pause and uninstall still restore Original.

### E12 — Reliable jobs, backup and alerts

Priority P1 before unattended pilot; A15/A16.

- Introduce a durable job/outbox model with tenant, idempotency key, state, attempts, next-run timestamp, lease and failure detail. Request loaders should enqueue preparation rather than perform a long install workflow.
- Use transactional outbox entries for transition-related notifications and deployment updates.
- Check alert response status, retry with bounded backoff, avoid repeating the same alert every five minutes, and confirm delivery through an independent monitor.
- Copy consistent backups off the database volume, verify checksum/freshness, encrypt and restore into isolation. Suggested supervised-pilot objectives: RPO ≤24 hours and RTO ≤4 hours; tighten for paid multi-store operation after measuring requirements.

Acceptance: process crash after committed transition can be replayed safely; a webhook 500 is not a delivered alert; stale filename cannot pass backup verification; simulated lost volume has an actual off-volume recovery source; a stopped scheduler triggers external detection.

### E13 — Capacity and managed database

Priority P1 before multiple unattended live stores; A15.

- Move to managed PostgreSQL with tested migrations/PITR before adding writers. Keep a single supervised SQLite store until recovery and capacity are demonstrated.
- Index/report with bounded ranges or projections; avoid loading every render/pixel event for each maintenance cycle.
- Benchmark at least twice the forecast peak for the accepted cohort, including reporting, recovery and webhook replay. Choose limits using requests/events, not only number of stores.
- Review process-local rate limits and leases before adding replicas. Define original-serving behavior during database unavailability and ensure measurement records remain interpretable.

Acceptance: record p50/p95/p99 decisions, fallback share, DB waits, queue age, memory and error rate under mixed load; backup/restore and rollback rehearsal pass; no account-specific noisy neighbor can invalidate unrelated stores' results.

### E14 — Paid continuation and complete release controls

Priority P1 before public paid offer.

- Implement Shopify App Pricing plan selection and authoritative subscription verification, including declined/pending/frozen/canceled/no-charge dev plans and reinstall handling.
- Preserve existing offers; a new pricing hypothesis needs explicit commercial configuration before use. Never infer charge acceptance from content approval.
- Add CI regression gates, deterministic release artifact identity, dependency/security checks and migration/rollback rehearsal. Current repository files are untracked; release traceability needs a real version-control workflow. Do not make commits or publish branches as part of this audit.
- Finalize domain, legal effective date, support/incident ownership, scopes, review assets and merchant notices. These are owner/provider decisions; engineering prepares the forms/artifacts but does not invent facts.

Acceptance: real production charges remain off until owner-approved offer and Shopify review/distribution conditions are satisfied; no-charge development plan tests pass; each deployed artifact maps to tested code/schema/extension versions.

## 4. Proposed data/API boundaries

These are implementation contracts to refine in E01–E05, not endpoints added by this audit.

| Contract | Minimum fields/invariants |
| --- | --- |
| Deployment resolver | authenticated shop, canonical product, consent/identity mode → immutable deployment revision and approved policy; one active revision per product |
| Decision | decision ID, deployment revision, experiment/cohort, unit type/hash, session, eligible reason, assignment, intended/actual render policy, source/mapping version, timestamps |
| Experiment lifecycle | sample/metric/unit/currency/maturity policy hashes; enrollment and financial cutoffs; stop reason; no post-launch mutation |
| Order ledger | Shopify order/refund/event IDs, financial/source timestamps, amount units/currency, eligibility/test flags, provenance and reconciliation status |
| Attribution | order/cohort decision, join method, window validity, product scope, confidence/failure reason; unique according to registered attribution policy |
| Evidence/diagnosis | claim text, source span/version, campaign promise, mismatch type, proposed intervention, reviewer outcome, model/compiler version where used |
| Merchant action | tenant, actor authorization, current revision, action and idempotency key; conflicting revision yields re-review |
| Billing | authoritative Shopify subscription identity/status, approved offer version, effective dates; independent from experiment result |

## 5. Product and market learning plan

### Discovery before broad installation

Interview 8–10 target merchants/operators. Ask for the last campaign whose landing page they changed, what blocked the change, the current tool/service cost, who authorizes it, and what result would justify keeping Pagnetic. Ask to observe a real task; do not ask only whether they “like AI personalization.”

Use an actual ad/product pair to present a diagnosis. Capture whether the diagnosis is correct, novel, actionable and commercially meaningful. If merchants consistently value page creation but not matching, adjust the wedge before building connectors.

### Assisted cohort

Invite 5–8 qualified stores with documented feasibility and supported checkout paths. These numbers are a learning cohort, not PMF proof. Build one real intervention per store and run its prospectively registered experiment. Log every operator intervention and merchant minute.

Proposed learning thresholds, to be treated as decision targets rather than industry benchmarks:

- At least 6 of 8 discovery participants correctly explain the use case after seeing the example.
- At least 4 of 5 usability participants complete the supported setup without spoken guidance; median active setup under five minutes.
- At least 70% of qualified activated cohort members reach a usable final decision within the forecast band. Count insufficient evidence and invalid results separately.
- At least 3 independent stores accept a paid continuation, with no hidden discount, and can explain their next recurring use.
- At least 2 of those 3 remain paying and use another meaningful decision cycle at day 60. Larger cohorts and longer retention are needed before claiming PMF.
- Record all null/negative outcomes. Require repeatable evidence of value across independent stores before claiming general uplift. Do not select only winners for aggregate claims.
- Aim for less than 30 minutes recurring support/store/month after onboarding. Measure initial assisted setup separately.

### How efficacy is judged

Each store retains its own registered primary endpoint. For a cross-store conclusion, prospectively specify a hierarchical synthesis including all eligible completed studies, comparable currency-free effect measures or consistently normalized outcomes, and heterogeneity. Do not pool raw dollars across currencies/stores or treat several store wins as a formal meta-analysis.

Separate four questions: did the proposal improve page quality; did the combined intervention improve sales; did matching improve over a universal message; will the buyer keep paying? Different data answers each.

### Decision branches

| Evidence | Decision |
| --- | --- |
| Helpful proposals, frequent infeasible experiments | Tighten ICP; provide preview/implementation value separately; no near-term lift promise for low-traffic stores |
| Universal messages help, matching adds little | Position around evidence-backed page improvement; do not retain personalization as the main promise |
| Matching works for clear campaign-rich stores | Prioritize campaign ingestion and reusable mapped templates |
| Merchant likes output but will not pay | Investigate recurring need and buyer ownership before discounting |
| Merchants copy winner and leave | Test a bounded paid project/agency-assisted model; improve repeat workflow only if new demand exists |
| Too many invalid joins or incompatible themes | Narrow supported surfaces and fix instrumentation before collecting more stores |
| Support cost exceeds recurring margin | Improve automation or price/scope; pause broad acquisition |
| No useful interventions or credible economic gains | Stop adding features; reconsider the core intervention and category |

## 6. Public launch gate

Public paid acquisition needs all of the following:

1. E01–E14 required acceptance evidence, supported-theme/checkout matrix, no unresolved P0 findings.
2. Full install → one save → real treatment → closed/mature result → keep/revise/stop demonstration.
3. Feasibility-based admission, calibrated statistical engine, financial ledger replay and report reconciliation.
4. Correct blocked/paused/result UX, accessible primary flows and plain money claims.
5. Production recovery, external alerts, bounded workload and appropriate database resilience.
6. Authorized distribution/review, approved public identity/terms/price, authoritative billing and reachable support.
7. Early paid continuation/retention and manageable support evidence from the assisted cohort.

Shopify review readiness, technical correctness, statistical efficacy and PMF are separate milestones. Passing one does not imply the others.

## 7. Audit reproduction record

Run from the project directory:

```sh
node --import tsx docs/audit-2026-09-05/reproduce-findings.ts
node --import tsx --test tests/*.test.js tests/*.test.ts
```

Use Node ≥22.12 as required by the project. The audit used the bundled Node runtime. Probes use synthetic in-memory data and one mock DB; no production network or database calls.

Observed on 2026-09-05:

| Probe | Current output | Interpretation |
| --- | --- | --- |
| Zero orders, collecting health, 1,000 sessions | VALIDATED / MATURE / interval [0,0] | A/A gate can accept no sales evidence |
| Day 120, insufficient sample, max 42 days | COLLECTING | Deadline not enforced |
| Open enrollment, minimum duration + 7 days | MATURE | Finality not tied to closed cohort |
| All sessions in one arm | VALIDATED with missing-arm reason | Pure analysis lacks a hard invariant; report-level SRM may catch this separately |
| Neutral source, three angle cards | 1 unique body | Labels can imply nonexistent differentiation |
| 2,800 assumed monthly eligible sessions | 10 days / UNDER_14_DAYS | Estimate omits sequential floors and maturation |
| Expired assignment returned to attribution | Upsert requested | Attribution function does not check expiry/order window |
| Existing full test suite | 79 passed / 0 failed | Existing coverage does not exclude the demonstrated defects |

The probes intentionally describe current defects rather than asserting that defects are desirable. Once fixed, convert them to negative-case regression tests; update the audit record with fix versions rather than erasing historical observations.

## 8. Owner input, when needed

No additional input was required to perform this audit. Implementation can begin with the internal P0 repairs. Before a new commercial cohort, the owner chooses the offer and initial vertical, introduces or approves recruitment of design partners, and supplies legal/support/billing/account facts. Before an ad/model connector is enabled, choose the authorized provider/data scope. Those decisions do not block source-level fixes, simulated statistical evaluation or reviewable UX implementation.

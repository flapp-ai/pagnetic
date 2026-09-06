# Pagnetic: customer value and complete experience specification

Date: 2026-09-05  
Version: proposed 0.2, arising from the [audit](./21-astra-market-and-product-audit.md)  
Status: recommended product specification, not implemented behavior or a change to existing merchant terms

## 1. Product contract

**Promise:** Turn your best ad promise into a clearer product page—and measure whether it sells more.

**Customer job:** “I am paying for visits to this product. Help me make the page deliver what the ad promised, without hiring a developer or running the experiment myself.”

**First release boundary:** one stable hero product, one language, one reporting currency, one experiment at a time, Shopify-hosted Online Store and supported product forms. The merchant approves the specific visible content. The product preserves native variant, quantity, checkout, pricing and inventory behavior.

**Immediate value:** a concrete mismatch diagnosis and a preview the merchant would use. This is not a revenue estimate.

**Measured value:** a randomized estimate of additional sales under a declared metric and population, with uncertainty.

**Recurring value:** useful next message decisions, campaign coverage, source-change monitoring and a controlled serving lifecycle. Repeating a dashboard counter is not a retention strategy.

Do not promise every install a win, a fixed completion time, profit improvement without cost data, or zero effort. Aim for under five minutes of active merchant setup among qualified supported stores; validate that target in observed tasks.

## 2. Customer journey and responsibilities

| Stage | Merchant sees and does | Pagnetic does | Exit evidence |
| --- | --- | --- | --- |
| Discover | Sees one specific use case and sample before/after | Explains suitability, preview, scope and eventual price | Merchant understands what changes |
| Diagnose | Adds product URL; optionally pastes one ad headline/body or campaign landing URL | Extracts product facts; distinguishes known ad content from guesses; finds a specific mismatch | A traceable diagnosis, or explicit abstention |
| Install | Reviews Shopify scopes and connects store | Retrieves only required data, resumes the prior preview where possible | Authenticated tenant and resumable preparation job |
| Qualify | Sees “Can measure”, “Need a baseline”, or “Preview only” | Computes eligible traffic, source readiness, compatibility and measurement feasibility | Supported opportunity and bounded forecast |
| Review | Compares actual page with proposed panel; edits/rejects/approves | Validates source support, distinctness and immutable authority | Approved version and experiment plan |
| Enable | Opens exact product/template, previews placement and saves | Verifies product-specific runtime acknowledgment, pixel and applicable commerce paths | Supported published deployment |
| Validate | Sees “Checking that sales are recorded correctly” | Runs instrumentation checks; separates missing data from parity evidence | Qualified technical validation |
| Measure | Sees progress, dates, health and Pause | Assigns, renders, reconciles, monitors and closes enrollment by policy | Closed cohort awaiting maturation |
| Decide | Sees effect, uncertainty and keep/revise/stop | Finalizes a reproducible report; prepares one bounded next action | Recorded merchant decision |
| Continue | Sees next opportunity and explicit plan offer | Serves approved winner, handles next version, verifies subscription | Actual recurring useful work |
| Leave | Pauses/cancels/uninstalls with clear consequences | Stops serving, reconciles billing and applies retention/deletion policy | Confirmation and original experience |

## 3. Acquisition and first preview

Landing-page headline: **Make your product page deliver on your ad.**

Subhead: **Pagnetic finds a message gap, prepares a source-backed improvement, and tests its effect on sales. You approve the change.**

Primary CTA: **See my page opportunity**. Secondary CTA: **See an example**.

Request one product URL first. After reading it, offer a compact optional field: “Paste the ad that sends shoppers here.” Campaign-aware diagnosis requires evidence of the campaign message. If no ad is supplied, label the output “Product-page clarity review”; do not pretend personalization has been assessed.

Example diagnosis, clearly illustrative:

> Your ad leads with easy cleaning. The product description confirms a removable washable cover, but that information is hard to find. Proposed change: put that supported benefit near the purchase controls.

Show the observed source passage and proposed placement. Never assert conversion loss or “money left on the table” from a text scan. If sources are insufficient, explain the missing fact and allow a merchant to provide a source.

Preview must work without an email gate. Provide an example for locked/unpublished stores, preserve entered text after recoverable errors, and explain URL errors inline. Rate limiting should name the retry time. Do not transmit private ad/account data to external models without the intended data-processing arrangement.

### Preview-to-install continuity

Persist a short-lived opaque preview reference if the user chooses to continue; bind it to the authenticated merchant only after ownership/context checks. Revalidate sources after catalog sync. Do not silently save full scraped pages as funnel analytics. If preservation changes retention requirements, update disclosures and implementation before enabling it.

## 4. Qualification and cold start

Replace the merchant-facing numeric “opportunity score” with three factual questions:

1. Is there a useful, supportable change?
2. Can the page safely serve it?
3. Can enough eligible traffic answer the question within the allowed period?

Do not show a heuristic score as a predicted probability of lift. Internally rank feasible candidates using traffic coverage, effect plausibility, margin sensitivity where available, source quality, stock stability and compatibility. Preserve unavailable values as unavailable.

### Data acquisition

- Shopify catalog and orders help establish source quality and order-value distribution. Historical product sessions are a separate capability; do not assume `read_orders` provides them.
- Use an explicitly supported analytics source/import when available, or collect a dated consent-aware baseline. Label estimates based on partial days or merchant-supplied aggregates.
- Track independent eligible visitor/session counts before experiment decisions, with consent semantics and race-safe identity propagation.
- Account for actual observation days, consent allowance, target-product share, campaign coverage and seasonality. Do not divide two days of observed traffic by 28.
- Keep readiness forecast live; keep the approved experiment assumptions frozen. Explain material forecast drift without rewriting the registered protocol.

### Paths

**Can measure:** “At your observed eligible traffic, this test can detect roughly X% improvement in Y–Z days.” Include baseline dates and a plain explanation of uncertainty. The displayed horizon includes validation, enrollment, attribution and refund maturity.

**Need a baseline:** “We are learning how much usable traffic this page receives. Your page is unchanged.” Show capture health and the next assessment time. Permit preview review, but do not start an underqualified revenue test.

**Preview only:** “You can use this page review now. There is not enough traffic for a reliable sales comparison within our test window.” Offer a saved/exportable approved draft, select another feasible product, or exit. Adoption of a draft is a usefulness signal, not lift proof.

## 5. Content and matching algorithm

### Preparation pipeline

1. Normalize merchant product facts and supplied ad content into versioned evidence objects with provenance, locale, timestamps and scope.
2. Identify a small number of purchase objections/promises grounded in the supplied material. The starting product should not force every business into comfort/performance/value.
3. Rank gaps by prominence in the ad, absence/visibility on the page, quality of supporting evidence and addressability by the allowed panel.
4. Propose **one** meaningful intervention. One alternative is allowed when the tradeoff is material. Do not generate six bundles because the data model permits six.
5. Validate every factual statement, banned claim class, source expiration, language, length and duplicate content. Reject unsupported urgency, ratings, discounts, guarantees or shipping promises.
6. Show the exact result in context and collect merchant approval. Any copy edit reruns validation and creates a new version.

Generation may use an offline model for bounded drafting after provider/cost/data decisions are made. Runtime selection stays deterministic. A model can compose supported facts into clearer language; it must not certify its own factual correctness. Use deterministic checks plus explicit evidence links and human review, with an offline evaluation set.

### Quality and uniqueness gates

- A variant must make a visible, useful change relative to the current page; different labels do not establish different interventions.
- Exact duplicate bodies are prohibited from counting as separate treatments. Detect near-duplicates and send weak differentiation to review.
- Explain “why this change” using observed evidence. Never translate source-text length into expected money.
- Pilot evaluation: at least 50 representative product/ad pairs, independently rated for grounding, specificity, clarity and useful differentiation. Include short sources, contradictory statements, multilingual text, sensitive categories and malicious source instructions. Proposed threshold: 100% source linkage for displayed factual claims, zero fabricated evidence, and at least 80% acceptable drafts in the declared supported subset. These are internal targets to validate.
- Use abstention when the product data cannot support a good intervention. Asking one relevant question is better for retention than presenting meaningless automation.

### Routing

Use approved campaign ID/UTM-to-message mappings first. Match priority, normalization version, model/compiler version and unknown-traffic policy belong in the approved snapshot. Ambiguous campaign names use the generic approved message or Original according to the experiment's frozen policy. Do not infer sensitive shopper characteristics.

Start with a pasted ad and generated campaign link, then add a read-only supported ad connector only after interviews confirm the recurring mapping workload. Validate that query parameters survive the merchant's actual redirects. No automatic ad-account mutations are in scope.

### Learning model

During a test, retain fixed assignment and immutable content. Learn between completed tests by recording intervention, supporting evidence, campaign, product, eligible population, effect/interval, outcome and reason for rejection. Prefer within-store learning first.

Do not introduce contextual bandits, repeated opportunistic segmentation or cross-merchant model training in the initial release. A Bayesian label does not eliminate sparse data. Any later pooled learning needs explicit data permissions, comparable metrics, hierarchical treatment of store differences and out-of-sample evaluation.

## 6. Review and approval screen

Display the real product image, current product title, campaign message, diagnosis and mobile/desktop preview. The Original preview must represent the actual page content and placement, not a generic empty card.

Default layout: “What shoppers see today” alongside “Proposed improvement.” Highlight the changed text. Collapse sources behind a clearly labeled disclosure beside each claim. Technical hashes/risk enums belong in operator details.

Primary action: **Approve this test**. Secondary actions: **Edit message**, **Choose another product**, **Not useful**. Capture rejection reasons with an optional one-click category and free text; do not block exit with a survey.

Approval text: “You approve the message shown here and the described test. Some eligible visitors see your current page. You can pause at any time.” Expandable details contain allocation, primary metric, full window, exclusions, rollback and approved transition authority.

Price/trial scope is visible before approval. Content approval is distinct from Shopify charge approval. Store approver, timestamp, content/evidence versions and policy hash; reapproval is required when material content or authority changes.

## 7. Enablement and storefront behavior

The normal theme configuration has no experiment ID, runtime policy menu, app-proxy path or QA override. Those can exist in an operator-only diagnostic path. The block identifies the product; the server resolves the active approved deployment.

Deep link to the exact product template and include selected product preview context. Existing custom templates must not be treated as the default template. Verify more than extension presence: selected product, published theme, applicable variant form, deployment version and a current runtime acknowledgment.

The merchant saves once. A/A → A/B → approved winner → pause must not require another theme save or expose an unrelated experiment. Reopening a theme editor should not add duplicate blocks.

Use theme typography, spacing and color tokens with readable contrast. Keep the intervention short and near a relevant buying decision. Preserve native controls. Avoid a blank above-the-fold panel while waiting for the network; define a stable insertion strategy and measure layout impact. Do not hide the merchant's original description to fake speed.

If Shopify Save is disabled: detect no pending change, explain whether the block is already installed, and offer **Check installation**. If verification fails, identify the exact missing step and link back to that product template. Do not send the merchant repeatedly to generic settings.

Compatibility checks are versioned by theme/product/checkout capability. If Shop Pay is enabled, test it. If it is absent, record **Not applicable** with evidence; this is not a pass for a future enabled Shop Pay flow. Recheck on capability changes.

## 8. Measurement state machine

Recommended internal sequence:

```text
Approved → Verifying → Instrumentation validation → Enrolling
         → Enrollment closed → Attribution pending → Returns pending
         → Result ready → Keep / Revise / Stop
```

Pause, source changes and incidents have explicit transitions with recorded authority. A pause must not erase elapsed exposure or silently reset a frozen deadline. A materially changed experiment gets a new version.

### Validation policy

Keep technical validation before a merchant effect claim. Replace a ritual identical 1,000-session A/A for every store with a versioned validation policy, informed by platform-level A/A calibration and store-specific event/order/consent/checkout checks. A no-order A/A cannot validate revenue capture. A non-significant difference is not affirmative equivalence. Do not shorten validation until the alternative policy is itself proven.

### Experiment sequence

For the first product-efficacy cohort, compare Original against a materially improved universal message. In a powered campaign-rich subset, compare that same universal message against the matched policy. This isolates whether matching adds value. Do not require both full tests for every subsequent merchant.

A direct Original-versus-matched policy comparison may later be used for customer value if declared prospectively, but it establishes the combined policy's effect, not the incremental contribution of personalization. No three-arm default, and no switching estimands after inspecting results.

### Statistical contract

- Define eligible traffic before assignment; freeze randomization unit, session boundary, metric, source/campaign coverage, currency, sample and deadlines.
- Define net merchandise revenue with explicit inclusion of payment status, tax, shipping, discounts, refunds, gift cards and cancellations. Profit requires actual cost inputs and a separate label.
- Close enrollment at a bounded sample/time rule. Continue observing the fixed cohort through the registered attribution and return windows. Prevent repeat visitors from entering a new experiment while their old attribution window overlaps unless the protocol explicitly handles that contamination.
- Produce immutable snapshots with as-of timestamps. Later financial adjustments produce revisions, not invisible edits to a historical report.
- Require balanced/healthy coverage, minimum independent units, both arms, and calibrated uncertainty. Keep negative results visible.
- Analyze visitors/sessions consistently with assignment. If session frequency can be changed by treatment, predeclare revenue per assigned visitor as a robustness metric and explain the RPS interpretation.
- Treat missing linkage as missing data requiring diagnostics, not automatically as zero sales. Report capture/attribution coverage by arm and supported path.
- End an infeasible test as insufficient evidence, not endless collection. A significance test cannot create data that does not exist.

## 9. Screen states and exact next actions

| State | Primary text | Primary CTA | Secondary / recovery |
| --- | --- | --- | --- |
| Preparing | “Reading your product and campaign” | None while healthy | Retry after bounded failure; preserve inputs |
| Needs baseline | “Checking whether this page has enough traffic” | View proposed change | Next assessment date; choose another product |
| Preview ready | “One message improvement to review” | Review change | Not useful / choose product |
| Needs save | “Save the message panel in Shopify” | Open product template | I saved it—check now |
| Checking setup | “Checking that this page records sales correctly” | None while checks run | Show progress and owned blocker if one fails |
| Merchant action needed | “Finish [specific action]” | Exact actionable destination | Support; list other blockers collapsed |
| Pagnetic repair needed | “We are fixing a recording issue; your page is unchanged” | View status | Contact support; no merchant checklist |
| Measuring | “Testing your approved message” | None | Pause; preview current treatment; expected decision band |
| Maturing | “Visits are complete; waiting for purchases and returns” | None | Show dates and why they matter |
| Positive | “The improved message increased estimated sales” | Keep this message | View evidence / decline; explicit plan offer |
| Negative | “The proposed message performed worse” | Keep current page | Review one different hypothesis |
| Inconclusive | “The test did not give a clear answer” | Keep current page | Explain interval and whether another test is feasible |
| Invalid | “We cannot use this result” | See repair status | Reason, owner, next check; no lift figure |
| Paused | “Your test is paused” | Resume eligible plan | Original active; explain any need for new approval |
| Serving winner | “Your approved message is live” | Review next opportunity | Pause; historical estimate dates stay visible |
| Trial ending | “Your evaluation ends on [date]” | Review plan | Export report / stop; no surprise charge |

One presentation object must own headline, severity, CTA, serving truth, owner and next-check time. Do not infer “no action needed” from the raw plan state while a notice says otherwise. Notices contain executable action destinations and never expose keys such as `shop_pay`.

## 10. Results, retention and billing

Result card, illustrative only:

```text
Estimated additional sales during this test: +$420
95% interval: +$80 to +$760
Net merchandise sales · USD · eligible campaign visitors
Test dates and finalized-as-of date

Recommendation: Keep the improved message
[Keep this message]   [See calculation]
```

Put projected future value in a separate optional section with its traffic and stability assumptions. If the interval crosses zero, show uncertainty before any optimistic projection. For invalid data, suppress the monetary point estimate. Compute displayed confidence from registration; do not hardcode 95% if alpha is configurable.

Keeping a winner creates a deployment version and an audit record. It does not keep an ended experiment artificially active. Historical measured revenue stops at the registered window. Any post-test counter must be labeled as observed sales under the deployed message, without a causal uplift claim. A continuing holdout requires separate authorization and protocol.

The next opportunity must reflect an actual new campaign, supported objection or source change. If none exists, say so. Do not generate a churn-prevention task merely to imply activity.

Paid conversion: redirect to Shopify's pricing page, verify the subscription server-side, then reconcile plan entitlements. Support accepted, declined, pending, frozen, canceled and reinstated states, duplicate events and uninstall/reinstall. Cancellation must explain when serving stops and provide report export. Do not hold historical evidence hostage.

Notification defaults: only opted-in critical attention, mature results and trial events. Provide frequency/channel control. In-app notices exist regardless of email consent. Do not claim a person was notified until delivery is confirmed.

## 11. UX quality, accessibility and instrumentation

- Use semantic forms, explicit labels, visible keyboard focus, error summaries and announced async status. Do not move focus on background refresh.
- Verify 320–1440px layouts, 200% zoom, keyboard-only approval/pause, one screen reader, empty/long product titles and translated strings. No horizontal scrolling for the primary action.
- Use color plus text/icon for statuses. Critical red is for incidents, not missing setup or negative test outcomes.
- Display local timezone for action dates, explicit currency for money, and currency-specific exponents. Customer copy distinguishes sales, revenue, refunds and profit.
- Show a report's denominator: eligible visits, assigned visitors, consent coverage and excluded traffic. The main view uses plain language; technical details remain accessible.
- Every long operation has a resumable job ID, progress, safe retry, timeout/error state and retry ownership. Duplicate taps must not duplicate plans, deployments or subscriptions.

Versioned funnel events: `diagnosis_viewed`, `diagnosis_rejected`, `install_completed`, `qualification_decided`, `opportunity_reviewed`, `content_approved`, `theme_enablement_started`, `deployment_verified`, `validation_passed`, `enrollment_started`, `enrollment_closed`, `result_finalized`, `winner_kept`, `revision_requested`, `plan_offer_viewed`, `subscription_verified`, `paused`, `uninstalled`.

Include merchant/plan/version identifiers, timestamps, reason codes, source channel and experiment cohort where permitted. Keep emails, full URLs, ad copy, tokens and customer content out of funnel payloads. Separate operator effort from merchant active time. Measure distributions and failure reasons, not just totals.

## 12. Acceptance boundary

The journey is complete when a new merchant can install, see a useful sourced intervention, approve it, save once, reach a correctly measured result and choose a next action without editing experiment IDs or understanding A/A mechanics. Test all branches above with real supported storefront paths before claiming self-serve readiness.

A functioning journey still does not prove demand or product efficacy. Those decisions use the separate [execution and learning plan](./23-pagnetic-improvement-execution-plan.md).

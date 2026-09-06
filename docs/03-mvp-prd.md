# Adaptive Storefront MVP Product Requirements

Status: Proposed  
Version: 0.2  
Owner: Product  
Target: Design-partner MVP

## Product objective

Enable a qualified Shopify merchant to launch a controlled experiment on one hero-product PDP that compares an original or universal experience with a claim-safe, acquisition-message-matched persuasion panel.

The MVP succeeds when it produces a trustworthy economic answer with acceptable merchant effort, storefront performance and brand risk. It does not succeed merely because content was generated or the app was installed.

## MVP principles

- One product and one adaptive panel before multiple surfaces.
- Explicit campaign-angle mapping before inferred multidimensional intent.
- Human-approved content before autonomous publishing.
- Fixed randomized experiments before bandits.
- Server-reconciled revenue before polished insight generation.
- Failure returns the visitor to the original PDP.

## Personas and jobs

### Ecommerce owner

Needs to understand what will change, approve it, launch safely, pause immediately and see incremental economic impact.

### Growth marketer

Needs to map campaign messages to approved experiences without creating new landing pages or manually operating continuous tests.

### Pilot operator

Internal role for V0. Qualifies stores, prepares mappings and experiences, runs QA and investigates data quality. Repeated operator tasks become candidates for later automation.

## Scope

### P0

- Shopify app installation and authentication.
- Catalog read for selected products.
- Published-theme and extension activation detection.
- One theme app block: Adaptive Panel.
- One-product experiment configuration.
- Explicit campaign/referrer/acquisition-angle mapping.
- Original, universal and matched policies.
- Three to six approved experience bundles.
- Grounded content generation and evidence display.
- Merchant preview and approval.
- Visitor-level randomized assignment with sticky persistence where permitted.
- Decision and render logging.
- Shopify Web Pixel event collection.
- Server-side order reconciliation.
- RPS, conversion and AOV reporting with uncertainty.
- Technical health display.
- Merchant kill switch and automated technical rollback.
- Consent-aware processing and deletion workflow.
- Audit log for material changes.

### P1 after economic validation

- Multiple products per merchant.
- Direct Meta and Google campaign ingestion.
- Automated campaign-angle suggestions.
- Review-provider integrations beyond the first supported provider.
- Additional supported-theme placements.
- Automated experience refresh proposals.
- Automated insight summaries.
- Experiment portfolio management.
- Experience-level contextual bandit.

### Explicit non-goals

- Five independently placed adaptive modules.
- Arbitrary modification of native theme elements.
- Entire-page generation.
- Runtime LLM decisions.
- Component-level optimization.
- Cross-merchant learning.
- Price, discount, inventory, scarcity or shipping changes.
- Product-image replacement.
- Checkout modification.
- Medical or disease claims.
- Uncapped, completely unattended App Store onboarding beyond the guided founding-beta path.
- Percentage-of-uplift billing.

## Primary merchant journey

### 1. Install

The merchant installs the Shopify app and grants only documented scopes.

Acceptance criteria:

- Authentication completes using Shopify's supported flow.
- The app records shop identity, scopes, installation time and API version.
- Missing required scopes produce a specific remediation path.
- Uninstall revokes active storefront behavior and queues required deletion work.

### 2. Qualification

The app and pilot operator select a candidate product and assess experimentability.

The merchant sees one of:

- **Ready:** sufficient eligible traffic and data quality.
- **Limited:** test is possible but expected to be inconclusive within the normal window.
- **Not eligible:** traffic or data cannot support a responsible revenue claim.

Acceptance criteria:

- Qualification uses eligible PDP traffic, not whole-store traffic alone.
- The estimate displays its historical window and assumptions.
- A not-eligible store cannot launch without an internal override and recorded rationale.

### 3. Connect the storefront

The merchant follows one deep link to add the Adaptive Panel to the selected product template and saves the theme.

Acceptance criteria:

- The app detects whether the block is active in the published theme.
- A preview explains the intended location.
- The app never edits theme source files.
- Unsupported placement produces a guided fallback or pilot-operator escalation.
- Activation is not reported complete until the published theme is verified.

### 4. Define acquisition angles

The merchant or pilot operator maps campaign identifiers to approved angles.

Example:

```text
utm_source=meta
utm_campaign=run_q3
utm_content=knee_video_02
=> comfort
```

Acceptance criteria:

- Each active mapping resolves to one angle.
- Ambiguous mappings are rejected.
- Unknown traffic behavior is explicitly configured: exclude, universal or original.
- Mapping changes are versioned and do not rewrite historical decisions.
- The system displays recent traffic coverage for every mapping.

### 5. Build experiences

The system ingests selected merchant-owned product content, policies and supported reviews. It proposes a universal bundle and one bundle per acquisition angle.

Acceptance criteria:

- Every factual statement cites one or more evidence objects.
- The UI shows evidence beside the proposed statement.
- Unsupported or conflicting evidence blocks approval.
- Review text is never generated or materially rewritten.
- Prices, specifications, inventory and shipping promises cannot be edited in the experience builder.
- The generation model, prompt version and source snapshot are recorded.

### 6. Approve and preview

The merchant reviews each bundle in realistic mobile and desktop previews.

Acceptance criteria:

- No bundle can be activated without explicit approval.
- Approval records user, timestamp, content hash and evidence version.
- Editing approved content creates a new unapproved version.
- Preview can select product, device and acquisition angle.
- The merchant can reject or replace individual statements.

### 7. QA and launch

The app runs readiness checks and presents the frozen experiment configuration.

Acceptance criteria:

- Launch is blocked when the panel is inactive, required events are absent, content is unapproved or a conflicting experiment is detected.
- Launch records experiment version, allocation, inclusion rules, bundles, mappings and metric plan.
- The default pilot allocation is equal between active arms.
- The merchant can download or view the launch configuration.

### 8. Runtime experience

An eligible visitor is assigned to an experiment arm. The assignment remains stable for the configured attribution window where persistence is permitted.

Acceptance criteria:

- Original-arm visitors see no empty panel or layout gap.
- Treatment visitors see the assigned approved version only.
- No language model call occurs in the request/render path.
- Failure hides the adaptive panel and never blocks product purchase.
- The decision and rendering outcome are recorded separately.
- The system does not change assignment based on post-exposure behavior.

### 9. Monitor

The merchant sees experiment and technical status without needing an analytics workflow.

Required fields:

- state: draft, QA, live, paused, completed or invalid;
- eligible sessions by arm;
- assignment/render/event health;
- RPS, conversion and AOV estimates;
- uncertainty interval and result state;
- active incidents or confounders;
- start date and progress toward the analysis target.

Acceptance criteria:

- The dashboard uses **inconclusive** when evidence is insufficient.
- It never labels a result a winner based only on a point estimate.
- It distinguishes assigned sessions from successfully rendered sessions.
- Currency and revenue definition are visible.

### 10. Pause or complete

The merchant can pause immediately. Completion follows the measurement plan.

Acceptance criteria:

- A pause stops new treatment rendering within five minutes.
- Existing assignments remain in the audit record.
- Resume creates a recorded experiment phase; long or material interruptions require a new version.
- Completion freezes the primary analysis dataset and configuration.

## Functional requirements

### Catalog and evidence ingestion

- Read selected product title, description, variants, metafields, media metadata and publication state.
- Read merchant policies required for approved reassurance statements.
- Import reviews only through a supported source with stable review identifiers.
- Snapshot evidence used by each content version.
- Detect relevant source changes and mark dependent content stale.

### Experience model

Each bundle contains:

```text
headline
supporting_line optional
benefits[3..4]
proof_items[0..2]
reassurance optional
```

Each bundle has:

```text
merchant_id
product_id
angle_id or universal
experience_version
locale
market_scope
status
content_hash
source_evidence[]
approval_record
risk_classification
```

### Traffic context

P0 signals:

- UTM source, medium, campaign, content and term;
- referring origin;
- landing product and URL;
- explicit Adaptive Storefront angle parameter;
- device class;
- market and locale;
- new/returning status only when legitimately available.

P0 does not infer demographics or protected identity.

### Decision policies

- `ORIGINAL`: no adaptive panel.
- `UNIVERSAL`: one configured experience for all eligible contexts.
- `MATCHED`: deterministic mapping from acquisition angle to approved experience.

Unknown, ineligible and error states follow the experiment's recorded fallback policy.

### Events

At minimum:

- `decision_assigned`
- `panel_rendered`
- `panel_render_failed`
- `product_viewed`
- `product_added_to_cart`
- `checkout_started`
- `checkout_completed`
- `order_reconciled`
- `refund_reconciled`
- `experiment_paused`

Event requirements are defined in the [technical RFC](./05-technical-rfc.md).

## Merchant dashboard

### Home

Show:

- current experiment status;
- estimated incremental RPS and revenue;
- interval and result state;
- technical health;
- one primary action: preview, fix setup, pause or view result.

### Experiment detail

Show arm definitions, sample counts, allocation, campaign coverage, dates, confounders and metric definitions.

### Experiences

Show each bundle, evidence, approval state, last source change and affected experiment.

### Audit log

Show installation, activation, content, mapping, experiment and pause changes with actor and timestamp.

## Non-functional requirements

### Performance

- Initial storefront JavaScript target: under 30 KB gzipped; hard pilot ceiling: 50 KB.
- p95 application processing: under 75 ms; hard rollback threshold: 150 ms sustained.
- p95 Shopify app-proxy round trip: under 750 ms; hard rollback threshold: 1,000 ms sustained.
- Panel render success: at least 99.5% for assigned treatment views.
- No material regression in LCP, INP or CLS relative to the agreed baseline.
- For new `pilot-v0.3` registrations, keep server processing and end-to-end round-trip measurements separate. Existing experiment registrations retain their frozen thresholds.
- Space is reserved only for treatment rendering; original must not retain an empty container.

### Reliability

- Storefront operation remains available when the application dashboard or AI provider is unavailable.
- Approved content is edge-cacheable and immutable by version.
- Invalid configuration resolves to original.
- Kill switch does not depend on the AI subsystem.

### Privacy and security

- No fingerprinting.
- No raw PII is required for decisioning.
- Consent signals are honored for storage and analytics.
- Merchant data is logically isolated.
- Secrets never reach storefront JavaScript.
- Deletion and retention behavior is documented and testable.

### Accessibility

- Panel content is keyboard and screen-reader accessible.
- Heading order is compatible with the surrounding page.
- Color contrast meets WCAG 2.2 AA.
- Motion is unnecessary and disabled by default.
- The block remains usable at 200% zoom and narrow mobile widths.

## MVP success criteria

### Economic

- Pilot portfolio meets the matching gate in the pilot protocol.

### Activation

- At least 70% of qualified design partners reach a live experiment.
- Median operator-assisted setup takes less than one business day.

### Technical

- Attributable storefront error rate remains below 0.1%.
- Decision-to-order join rate meets the threshold established during A/A validation.
- No Severity 1 safety or checkout incident occurs.

### Merchant value

- At least 70% of merchants with valid results choose to continue or expand.
- Merchants can accurately explain what changed and how incrementality was measured.

## Release phases

### Phase 0 — Technical proof, weeks 1–2

Development store, one panel, explicit angle parameter, deterministic bundle selection, assignment and basic event path.

### Phase 1 — Pilot operations, weeks 3–5

Catalog/evidence ingestion, experience versioning, approval, campaign mapping and theme QA.

### Phase 2 — Measurement, weeks 6–8

Randomization, Web Pixel events, order reconciliation, A/A validation and analysis output.

### Phase 3 — Design partners, weeks 9–12+

Run experiments according to required sample sizes, not an arbitrary calendar deadline. Record every repeated manual operation.

### Phase 4 — Productization

Begins only after the economic gate. Automate qualification, mapping, content maintenance and supported-theme setup in the order demonstrated by pilot burden.

## Open decisions

- First vertical.
- First supported review provider.
- Visitor persistence mechanism by consent state.
- Pilot attribution window.
- Net versus gross revenue availability for the primary result.
- Exact mobile/desktop performance budgets per design partner.
- Merchant agreement language for approval and claims responsibility.

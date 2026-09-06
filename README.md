# Pagnetic

Pagnetic is a proposed Shopify product that matches paid-acquisition messages with approved product-page selling experiences and measures their incremental revenue impact.

The current repository contains the product-led public-beta build and its operating controls. Start with the [documentation index](./docs/README.md).

## Current phase

The Autopilot MVP release candidate is deployed at `https://pagnetic.fly.dev` on a capped, single-writer Fly.io production profile. All code-controlled P0 scenarios pass. Merchant approval, published-theme and commerce evidence, DNS, external alerting, legal approval, listing assets, and Shopify review remain launch gates. The beta provides value before installation and stays free until the first mature real experiment result.

The immediate validation target is:

> At least 5% aggregate incremental revenue per eligible session from matched experiences versus a universal improved experience, measured under the registered pilot protocol.

## Implementation status

Milestone 1 is complete and connected to the development store:

- Shopify React Router application shell
- authenticated embedded admin home
- one adaptive-panel Theme App Extension block
- deterministic explicit-angle selection
- session-sticky 50/50 original-versus-matched allocation
- original fallback and browser diagnostics
- unit coverage for the decision policy

Milestone 2 is complete:

- Shopify product sync into immutable source snapshots
- evidence records with risk and merchant-review states
- deterministic, evidence-bound draft proposals
- validation-gated immutable approvals
- versioned campaign-to-angle mappings with ambiguity checks
- merchant-scoped governance audit trail
- signed Shopify app-proxy delivery of approved storefront content
- runtime hash, policy, evidence-scope and staleness enforcement

Milestone 3 is complete:

- frozen, merchant-scoped experiment registry
- server-salted visitor or session assignment with immutable reuse
- consent-aware persistence through Shopify's Customer Privacy API
- immutable decision and render records for control and treatment
- Shopify Web Pixel extension with allow-listed, idempotent event ingestion
- opaque decision references attached as private line-item properties
- order and refund reconciliation adapters with explicit join methods
- merchant measurement-health workspace
- explicit frozen A/A and A/B arm policies
- launch-readiness checks for allocation, event, render and order-join quality
- overlapping Admin API order recovery with durable checkpoints
- automatic Web Pixel callback rotation when the public application URL changes
- frozen analysis plans, cluster-aware RPS estimates and downloadable reports
- immutable result snapshots with data and registration hashes

Milestone 4 is complete:

- registered A/A, original-versus-universal and universal-versus-matched stages
- explicit dependency gates between A/A, Stage 1 and Stage 2
- approved universal and matched-bundle readiness checks
- merchant kill switch with original-storefront fallback
- automatic runtime guardrails and immutable safety evaluations
- severity-based incident workflow and experiment confounder log
- privacy-request audit records with one-way identifiers and shop deletion
- embedded pilot-operations workspace for launch, pause and recovery decisions

Design-partner readiness controls are complete:

- automatic source-derived brand profile with explicit merchant approval
- one-action governed draft-library creation plus evidence-constrained editing
- deterministic semantic campaign classification with safe unknown-traffic policy
- product traffic qualification, published-theme detection and nine-check QA evidence
- owner/operator/viewer access, encrypted incident contacts and merchant audit trail
- scheduled order recovery, guardrails, retention, alert delivery and health endpoint
- Docker deployment, durable single-writer pilot storage, verified backup/restore scripts
- executable partner and production readiness checks plus launch/handoff documents

Product-led public-beta controls are complete:

- public Shopify product-page scan with SSRF defenses, response and rate limits
- source-grounded opportunity score and five immediate message previews
- anonymous funnel telemetry that retains neither submitted URL nor product copy
- guided seven-stage embedded activation and one hero product per store
- free-until-first-valid-result entitlement; A/A never triggers payment eligibility
- automatic result reconciliation, funnel retention, and authenticated aggregate metrics
- public privacy, terms, support, and health pages
- explicit founding-beta capacity limit and single-writer SQLite WAL profile

Autopilot MVP controls are complete:

- deterministic zero-configuration product ranking with a merchant choice only for material ties
- source-grounded panel generation and one bounded approval record
- immutable content, evidence, mapping, protocol, safety, and transition authority
- published-theme, product, traffic, Web Pixel, and QA gates before A/A
- idempotent A/A-to-real-test orchestration with locks, notices, audit history, pause, and rollback
- outcome-first verified incremental revenue with projections visually and semantically separated
- result-aware free extension and founding-price offer while Shopify billing remains disabled
- uninstall invalidation of plans, active experiments, pixel delivery, sessions, and automation

See [the current launch-readiness report](./docs/20-autopilot-launch-readiness.md) for production evidence and the remaining owner actions.

The Web Pixel is active on the development store. Protected customer data
access is configured for development, and the order/refund webhook
subscriptions are enabled.

The storefront block defaults to **Original**, so installing it cannot expose
placeholder content until a merchant changes the runtime policy.

## Local setup

Requirements:

- Node.js 22.12 or newer
- pnpm 11
- a Shopify Partner account and development store for storefront preview

Install and verify:

```bash
pnpm install
pnpm prisma generate
pnpm test
pnpm typecheck
pnpm build
pnpm check:partner
```

Connect the local project to a Shopify app and run it:

```bash
pnpm shopify app config link
pnpm dev
```

In the development store's theme editor, add the **Adaptive Panel** app block
to a product template. Keep the block in **Original** mode until its copy is
merchant-approved.

Open **Milestone 2 — Governed content** from the embedded app to sync the
catalog, approve exact source evidence, propose an angle-specific bundle, and
publish an immutable approved version. The pilot proposal engine is deliberately
deterministic and source-bound; no external model receives merchant or shopper
data in this milestone.

The mutating end-to-end governance check is guarded for development stores:

```bash
ALLOW_GOVERNANCE_SMOKE=1 \
GOVERNANCE_SMOKE_SHOP=your-dev-store.myshopify.com \
pnpm smoke:governance
```

The theme block requests governed content through `/apps/adaptive-storefront`.
Only an unchanged `APPROVED_ACTIVE` version can render. Missing mappings,
unapproved content, stale evidence, invalid payloads, timeouts and server errors
all leave the native product page untouched with the panel hidden.

Readable storefront runtime source lives under `storefront/` (outside the
Shopify extension package, which only permits extension asset directories).
`pnpm dev`, `pnpm test`, and `pnpm check`
minify it into the Shopify-served asset automatically.

For a technical preview, set the block to **Matched** and open a product URL
with one of:

```text
?adaptive_angle=comfort
?adaptive_angle=performance
?adaptive_angle=value
```

QA arm overrides are disabled by default. They can be enabled in the block's
theme settings for development-store testing.

Open **Milestone 3 — Causal measurement** to register the experiment ID used by
the block and activate or rotate the Web Pixel. Experiment allocation is read
from the frozen server registry; the theme cannot silently change the control
percentage.

Open **Milestone 4 — Pilot operations** to inspect launch dependencies, evaluate
guardrails, activate the merchant kill switch, and record incidents or
confounders. Follow the [pilot operations runbook](./docs/07-pilot-operations-runbook.md)
in order: validate A/A, run Stage 1, then run Stage 2. The system prevents later
stages from launching before their registered dependencies pass.

## Public-beta deployment

Use the included `Dockerfile` and copy `fly.toml.example` to a provider-specific
configuration. The initial public-beta production profile uses one application
writer with SQLite WAL on an encrypted durable volume. Under the v2 PRD this is
limited to one supervised design partner; managed PostgreSQL is required before
multiple unattended partners, regardless of the legacy capacity setting. Set every variable in
`.env.example` through the host's secret/config manager; never deploy the local
`.env` file.

Before deployment, generate independent secrets and configure the stable Shopify
application URL. Run migrations at startup, schedule `scripts/run-automation.sh`
every five minutes. The production supervisor runs `scripts/backup-sqlite.sh`
every six hours. Configure a separately escrowed backup encryption key and an
approved S3-compatible off-volume bucket first. Each run uploads encrypted data,
downloads it, verifies an isolated SQLite restore, and publishes an authenticated
manifest. See [the recovery runbook](./docs/28-encrypted-backup-and-recovery.md).
Missing remote configuration or stale evidence fails the production gate.

Release gate:

```bash
pnpm check
pnpm check:partner
pnpm check:production
```

Follow the [design-partner launch checklist](./docs/08-design-partner-launch-checklist.md).
Move to managed PostgreSQL with point-in-time recovery before running multiple
application writers, removing the founding-beta cap, or exceeding the observed
single-writer capacity envelope.

Development-store activation and event ingestion checks are deliberately gated:

```bash
ALLOW_MEASUREMENT_ACTIVATION=1 \
MEASUREMENT_SHOP=your-dev-store.myshopify.com \
MEASUREMENT_ENDPOINT=https://your-app-host/storefront/events \
pnpm activate:measurement

ALLOW_MEASUREMENT_SMOKE=1 \
MEASUREMENT_SHOP=your-dev-store.myshopify.com \
pnpm smoke:measurement

pnpm check:aa

ALLOW_AA_ACTIVATION=1 \
MEASUREMENT_SHOP=your-dev-store.myshopify.com \
pnpm activate:aa
```

## Documents

- [Strategy memo](./docs/01-strategy-memo.md)
- [Pilot protocol](./docs/02-pilot-protocol.md)
- [MVP product requirements](./docs/03-mvp-prd.md)
- [Measurement specification](./docs/04-measurement-specification.md)
- [Technical RFC](./docs/05-technical-rfc.md)
- [Claims and safety policy](./docs/06-claims-safety-policy.md)
- [Pilot operations runbook](./docs/07-pilot-operations-runbook.md)
- [Design-partner launch checklist](./docs/08-design-partner-launch-checklist.md)
- [Security, privacy, and data operations](./docs/09-security-privacy-and-data-operations.md)
- [Design-partner onboarding guide](./docs/10-design-partner-onboarding-guide.md)
- [Pilot release record](./docs/11-release-record-template.md)
- [Design-partner readiness report](./docs/12-design-partner-readiness-report.md)
- [Public-beta product strategy](./docs/13-public-beta-product-strategy.md)
- [Shopify App Store listing draft](./docs/14-shopify-app-store-listing-draft.md)
- [Public-beta launch checklist](./docs/15-public-beta-launch-checklist.md)
- [Owner inputs for public launch](./docs/16-owner-inputs-for-public-launch.md)
- [Public-beta readiness report](./docs/17-public-beta-readiness-report.md)
- [Hosting and pricing recommendation](./docs/18-hosting-and-pricing-recommendation.md)

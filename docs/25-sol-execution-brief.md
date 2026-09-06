# Sol execution brief — Pagnetic MVP v2

Development update (2026-09-06): the owner authorized the adaptive scope in [doc60](./60-adaptive-storefront-prd.md), with Luna implementing under [doc63](./63-luna-development-brief.md) and milestones tracked in [doc64](./64-adaptive-development-status.md). Earlier contracts and verification below remain historical/implemented baselines, not evidence that the new scope is built. New protocol changes must be versioned and reviewed; no active registrations or production authority change through this notice.

Date: 2026-09-05  
Purpose: ready-to-use implementation handoff; this document does not start a separate task or authorize new vendor spending.

## Implementation instruction

Implement the [MVP-v2 executable PRD](./24-pagnetic-mvp-v2-executable-prd.md) in `/Users/erenyigit/Documents/ChatGPT/ecommerce ai`. Read it completely before editing. Use the [Astra audit](./21-astra-market-and-product-audit.md) for evidence and reproduction context. Documents [22](./22-pagnetic-value-and-experience-prd.md) and [23](./23-pagnetic-improvement-execution-plan.md) explain the proposals; document24 resolves them for new v2 work.

Deliver a useful, source-backed product-message improvement, a trustworthy experiment, and a complete keep/revise/stop journey. The customer must not have to manage experiment IDs, technical stage transitions or attribution repair. Do not interpret “autopilot” as authority to invent product facts, change prices, claim uplift or charge merchants.

Work through all code-controlled requirements. If one capability needs owner/provider configuration, finish its safe implementation and tests, record the exact remaining dependency and continue independent work. Do not declare public launch readiness from passing local tests.

## First work session

1. Inspect applicable repository instructions, the current worktree and active configuration without exposing secrets. Preserve existing untracked/user-owned work. Record source, schema and extension versions; where no commit identity exists, record a reproducible working-tree manifest.
2. Read the [implementation tracker](./26-mvp-v2-implementation-status.md). Verify the current baseline; historical audit results are not fresh test evidence.
3. Run existing supported checks in an isolated local/test environment. Inspect `docs/audit-2026-09-05/reproduce-findings.ts` before executing it; convert audit defects into isolated regression fixtures. Do not point fixture creation or cleanup at production.
4. Complete S01: add new protocol/version flags and additive schema changes; establish minimal transactional outbox/lease primitives; fix contradictory merchant status/CTA presentation. Start with v2 disabled. Capture regression failures before fixing their actual production paths.
5. Continue the sequence below, updating evidence as each package becomes verifiable.

## Execution order

| Order | Package | Deliverable |
| --- | --- | --- |
| 1 | S01 | Baseline, regressions, additive schema, flags, outbox foundation and truthful status |
| 2 | S02 | Consent-aware visitor identity, baseline capture and server deployment pointer |
| 3 | S03 | Durable webhook inbox, exact order/refund ledger and product-scoped attribution |
| 4 | S04 | Closed-cohort lifecycle, calibrated analysis and honest feasibility forecast |
| 5 | S05 | Source-backed diagnosis, distinct drafts, abstention and explicit campaign input |
| 6 | S06 | Actual preview/review, selected-template enablement and complete merchant screens |
| 7 | S08 | Workers, bounded reports, backup/restore evidence, alert delivery and recovery |
| 8 | S07 | Keep/revise/stop, entitlement rules and server-verified subscription adapter |
| 9 | S09 | PostgreSQL migration rehearsal, capacity evidence and release checks |
| 10 | S10 | Supported Shopify browser/checkout rehearsal and gate-specific handoff |

Do not rebuild the app in another framework or cloud. Retain Fly and the modular monolith. Extract testable services as necessary. Build generated storefront assets from their source; do not patch minified outputs manually. Independent work may move earlier, but preserve documented dependencies.

## Decisions already resolved

- New v2 experiments randomize consented persistent visitors, not a mixed visitor/session population. The primary metric is **net selected-product sales per assigned visitor**. Preserve old registrations and reports unchanged.
- Revenue attribution lasts seven days per visitor, followed by the defined financial reconciliation horizon. Close enrollment explicitly; no winner while enrollment remains open, no automatic extension and no “zero-order A/A passed.”
- One saved app block follows backend deployment versions. Pause, drift and uncertainty fail safely to the merchant's Original page.
- Deterministic, source-grounded draft composition is the default. Optional model integration is offline and disabled until configured. Abstain when there is no useful supported change.
- Existing $49 offers are preserved. New $99 offers are unpublished drafts; billing stays off absent approved configuration. A favorable result is never payment authorization.
- Single supervised SQLite writer is temporary. PostgreSQL and verified operational safeguards are required before multiple unattended live stores.

Exact schemas, financial semantics, windows, API errors, status transitions, UX states, performance budgets and AT01–AT30 are in document24. Do not replace those contracts with a vague approximation.

## Verification and evidence

Use project-supported Node ≥22.12 and the package manager pinned in `package.json`. Required checks are `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm shopify app build`. Run appropriate readiness checks separately against the intended environment. Existing `pnpm check` chains the baseline checks but does not replace targeted integration/browser/statistical tests.

Add independent financial reference fixtures, statistical calibration, deployment lifecycle integration, consent and mixed-cart tests. Verify actual Shopify product/template and supported checkout paths; mock state transitions do not prove storefront exposure. Test orders must remain excluded from efficacy data. Do not make real-charge purchases for QA without explicit authorization.

Maintain status per R01–R14, S01–S10 and AT01–AT30. Each VERIFIED entry needs changed paths, command/scenario, timestamp, result and relevant release/environment. Distinguish local fixtures from provider integration, real-store verification and customer evidence. Do not rewrite old audit snapshots to appear current.

## Authority and final handoff

This is scoped engineering work, not approval for a new commercial offer, paid infrastructure purchase, legal representation, public store recruitment or App Store publication. Deployment requires the actual implementation task's authorized environment and release scope; this document alone grants none. Prepare configuration adapters and exact owner instructions while external decisions are pending.

Finish with: what changed; requirement/package/test status; actual verification; migration and rollback evidence; exact external dependencies; and which gate is achieved—engineering complete, design-partner deployable or public acquisition ready. State remaining learning needs plainly. No code can guarantee market success.

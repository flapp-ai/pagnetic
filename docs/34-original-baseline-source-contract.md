# Original-only baseline source contract

Date: 2026-09-05. Internal implementation evidence for R02/S04; not proof that a real merchant has sufficient traffic or that the full merchant plan is integrated.

## Internal API and authority

`snapshotOriginalBaselineV2` in `app/services/original-baseline-v2.server.ts` takes an authenticated merchant/product/experiment scope, exact full-day observation start/end, worthwhile effect and optional controlled clock. It does **not** accept merchant-entered visitor counts, purchase counts, revenue, coverage or a claim of source maturity.

The selected source must be a closed, financially mature v2 registered Original/Original experiment. Its protocol, focal assigned-visitor metric and fixed seven-day attribution must match. Observation dates must be inside its enrollment window. An interrupted protocol, material confounder, open severe incident, wrong product/tenant or treatment cohort cannot masquerade as an eligible Original baseline.

The source reader and qualification snapshot share the experiment-row lock used by enrollment and immutable financial append. It builds:

- Distinct assignment-based visitors, first-eligible daily cohorts and actual per-visitor session identities. Missing sessions are a gap; Shopify client IDs are not substituted for session IDs.
- All visitor outcomes, including verified zero-purchase visitors, from immutable financial facts as of the frozen financial cutoff. Paid test orders are excluded. Missing linked immutable history is an explicit reconciliation gap, not zero revenue.
- A conservative observed checkout rate using at most one verified non-test paid purchaser per visitor, grouped by first eligible day. This undercounts unpaid/abandoned observable checkout activity; it cannot increase feasibility through unverifiable browser claims or repeated orders.
- Actual persisted capture coverage and an evidence hash binding registration, cohort, immutable financial revisions, dates and health. Wholly unobserved losses remain outside what those signals can prove.

The service returns a persisted `QualificationSnapshot` or an explicit baseline/preview blocker. Raw per-visitor money arrays, assignment IDs and source financial payloads do not escape the service boundary. The canonical snapshot contains aggregate fields, distribution/evidence hashes and restrictions, not the private outcome array.

Repeated calls with unchanged source evidence produce the same snapshot ID. New authoritative source evidence can create a separate qualification snapshot; it does not rewrite an already-registered effect experiment or a pinned final result.

## Traffic-only capture is not financial qualification

`loadV2BaselineCapture` still reports consented focal-product view counts, but now labels them `CONSENTED_SHOPIFY_PIXEL_PRODUCT_VIEW_V2_TRAFFIC_ONLY` with `qualificationUsable=false`. It reports missing session events rather than guessing one session per Shopify client ID.

Historical unassigned page views cannot be retroactively attributed by this API. A clean Original-only measurement cohort must be collected. The plan must support explicit baseline/A/A collection before effect qualification; otherwise requiring a qualified effect plan to start that collection creates a circular gate. This orchestration remains an implementation dependency, not a request for the merchant to fabricate historical data.

## Fresh local evidence

`tests/original-baseline-v2.test.ts` migrates a real isolated SQLite database, creates 2,100 synthetic Original-only visitor assignments and real decision/bridge rows, then runs **202 production financial normalizations and signed-reference reconciliations**. Two hundred paid non-test visitors contribute; one repeat order adds money without increasing purchaser/checkout-visitor counts, and the additional paid test order contributes neither.

It verifies complete daily cohort totals, real session counts, paid-purchaser/checkout deduplication, source maturity, idempotent snapshots, absence of raw outcome arrays, cross-tenant and non-Original rejection, material-confounder refusal, missing session authority, capture loss and missing immutable financial history. This is not a live Shopify API or browser test.

The refreshed real PostgreSQL rehearsal also preserves concurrent cohort inclusion after the early-close checkout gate change. Its small two-visitor race now explicitly exercises **hard-deadline closure without the checkout floor**, not early target closure. The separate health-aware early-close tests must pass independently. Database parity, exclusive claims, financial/report interleavings and dump/restore continue to pass across 61 tables; representative production recovery time is still unmeasured.

## Remaining release work

Connect this API to the v2 merchant plan, make baseline collection and subsequent effect registration distinct, freeze the actual snapshot in the approved registration, and show truthful next steps for baseline-required/preview-only results. Validate the intended store, remote services, privacy behavior and operational recovery. No deployment, paid offer, live migration or external resource was changed by this slice.

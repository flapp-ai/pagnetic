# Preparation notice and held-runtime reconciliation

Date: 2026-09-06

## Corrections

- A successful preparation now resolves the exact product-scoped `unsupported-content` notice without deleting the notice or its audit history.
- A governed presentation read repairs a stale preparation-failure notice only when its durable job is `COMPLETED`, its `resultRef` is the displayed prepared plan, and its product/cutover-receipt payload matches that plan. Failed work for another product or receipt and unrelated safety notices remain open.
- V2 theme evidence now recognizes the canonical persisted consent state `analytics_and_preferences_allowed`; the former generic `ALLOWED` test-only value cannot qualify.
- The Web Pixel forwards one narrowly defined, consented, unassigned `ORIGINAL` / `KILL_SWITCH_ACTIVE` diagnostic. It explicitly sends null decision, experiment, visitor, assignment and bucket authority, never stores it as a decision reference, and clears prior stored authority.
- Reusable legacy decision references must match an actual event product. A stale v1 reference can no longer attach to page-wide events or a different product after v2 enablement.
- Rejected event logging contains only an allowlisted server reason and allowlisted event type. Raw payloads, tokens, event IDs and shopper values are excluded.

## Local evidence

- Focused pinned Node 24 tests pass: 32/32 across Pixel privacy, Pixel ingestion, storefront request boundaries, selected cutover, theme/runtime evidence, and notice reconciliation.
- The selected-cutover regression prepares and approves the replacement plan into `WAITING_FOR_THEME`, resolves the exact prior content notice, repairs a simulated completed-job notice through the presentation path, and preserves unrelated product and safety notices.
- Overview now separates notices that apply to the current plan from retained workflow history. An invalidated legacy plan's activation notice, a superseded cutover-receipt preparation notice, and prior-product preparation notices remain auditable but cannot become the current headline or primary action. Current-plan actions and unrelated safety notices remain visible.
- The verifying view derives its exact pending QA list from authenticated evidence using the same release-, receipt-, product-, theme-, template-, freshness-, and applicability-bound validation used by hold release. After runtime placement and Original-fallback evidence, it reports the seven remaining checks rather than a stale legacy subset.
- Complete Shopify test-gateway orders now terminate durable inbox processing as `PROCESSED` while retaining `TEST_ONLY` ledger status, zero attribution, and zero retry jobs. Incomplete or conflicting canonical reads still retry.
- Final pinned Node 24 `pnpm check` passed on 2026-09-06: 345/345 tests, TypeScript, ESLint, React Router production build, and Shopify app/extension build all passed (exit 0; unified check session `85732`).
- Release-source identity was unchanged across that check: `a95871187e13889de6a215899f15b26031e2f4bf4e9a6e81969bf7b4eb2f0637` before and after. The check did not alter schema or PostgreSQL transfer paths, so the PostgreSQL rehearsal was not repeated.

No provider, storefront, database, feature flag, deployment, plan approval, content hash, or receipt was changed by this local correction.

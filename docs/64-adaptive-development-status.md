# Adaptive storefront development status

Started: 2026-09-06. Implementers: Luna, then Sol. Reviewer: Astra. Authority: docs60–63. Baseline: doc61.

| Milestone | Scope | Status | Evidence |
| --- | --- | --- | --- |
| M1 | AP-00/01 contracts and mapping foundations | REVIEWED_FOUNDATION | Astra focused review approved the pure foundation; runtime/onboarding integration is explicitly not claimed |
| M2 | AP-02–05 integrated adaptive vertical slice | LOCALLY_VERIFIED | Connected intake/package review, full authority binding, storefront campaign context, reviewed orchestrator deployment, pre-enrollment eligibility, canonical denominators, update drift rejection, proof/FAQ rendering, and distinct experiment questions are covered by focused tests |
| M3 | AP-06 release preparation/final review | LOCAL_PREPARATION_COMPLETE | Source-bound final gate recorded below; live owner/provider/theme/performance/recovery gates remain explicitly open |

Record changed files, exact commands/results and source identity here. Do not copy old test counts into a new release. No adaptive implementation, treatment or launch is claimed by this initial entry.

Owner/provider gates: qualified store and actual ads/product evidence; content/experiment approval; live QA/recovery; operational sending connection; terms/price/distribution approval. Verify current state before requesting inputs again. Independent local work can proceed.

## M1 evidence — AP-00/AP-01 (2026-09-06)

Source identity: working tree at `/Users/erenyigit/Documents/ChatGPT/ecommerce ai`; no commit, deploy, migration, flag, active experiment, charge, or external approval was created. Existing untracked source and v2 behavior were preserved.

Changed paths:

- `app/services/adaptive-contracts.ts` — additive `adaptive-a-1` contract types for campaign mappings, immutable mapping snapshots, deployment payload shape, selection reasons and Original fallback; deterministic campaign signature, exact URL helper, and tenant/product/locale-scoped resolver.
- `tests/adaptive-contracts.test.ts` — four focused tests covering version/hash stability, exact scope and malformed references, ambiguous/revoked/expired fallback, and preservation of unrelated URL parameters.
- `docs/64-adaptive-development-status.md` — this evidence record.

AP-00 decisions frozen for M1: unknown/invalid/ambiguous/revoked/expired mappings resolve to `ORIGINAL`; no guessing from opaque UTM names; mapping selection requires exact merchant, product, locale and campaign reference; duplicate active matches are ambiguous; snapshots are versioned and hashed; link helpers only construct URLs and never publish ad changes. This is a pure foundation and is not wired into the v2 request path yet.

Contract fields reserved for the next milestone include deployment revision, bundle-set hash, mapping snapshot hash/version, policy/arm, selection reason and expiry. Sticky assignment, consent authority, treatment serving, financial outcomes and renderer integration remain M2+ work.

Acceptance evidence: AC-02 (unknown/ambiguous safe fallback), AC-03 (tenant/product isolation), AC-06 (revocation/expiry invalidation), and the AP-00 hash/version foundation are locally covered. AC-01 (two approved ads resolving to distinct served bundles) is not claimed: serving integration and approved bundles are M2. Human content usefulness, live theme/browser behavior, provider/distribution, recovery, pricing and launch gates remain external or later milestones.

Commands and results:

- `pnpm exec tsx --test tests/adaptive-contracts.test.ts` — PASS, 4/4 focused tests.
- `pnpm typecheck` — PASS.

M1 revision (focused review): snapshots now use fixed-field canonical serialization including snapshot version, deterministic code-point ordering, immutable rows, duplicate-key rejection, timestamp validation, and hash verification at resolver entry. Invalid/tampered snapshots fail closed. URL helpers accept only `http:`/`https:` destinations without credentials. The trusted snapshot boundary is the deployment payload/cache handoff; resolver verification remains defense in depth. Merchant-host/product destination allowlisting is a production integration responsibility and is not claimed by this helper.

AP-00 addendum: adaptive deployment schema is `adaptive-a-1`; response selection is represented by `AdaptiveMappingSelection` with `bundleId`, `mappingVersion`, `reason`, and `fallback`. The M1 policy is visitor-sticky assignment at the later runtime boundary: control never resolves a campaign bundle; known visitors retain their assigned arm across campaign changes; unknown campaign context is eligible only for Original/default handling and is excluded from the matching treatment population. Proposed budgets to freeze before M2 are 500 ms browser-to-decision, 100 ms server decision work, and no online model/provider call; these are engineering budgets, not observed performance evidence. Bounded Anthropic blueprint reuse decision: no code reuse or dependency is warranted for AP-00/01 because the reference concerns conversational commerce, while this scope is deterministic, source-bound campaign mapping; revisit only as a documented Horizon C assessment.

Source hashes at this M1 revision (working-tree artifacts, no commit): `app/services/adaptive-contracts.ts` `9b432c067b36ba12e5f374e2d83d1b8629e8fdaf3b9341349202acf32f4085c4`; `tests/adaptive-contracts.test.ts` `111800e39fc47d95238e61aa6d74f8db59a8674e913618668a38f653618d4f35`; this status document was hashed before this paragraph (`07c4b3fca08d5dde9746f4e18fca669a7b890110250c8b66daee2ba836d3eab7`).

The earlier AC-06 statement is narrowed: M1 covers revocation/expiry and tamper invalidation in the local contract; source-drift detection, stale serving prevention and review queuing remain AP-02/05 and are not claimed here. M1 review request: inspect these bounded semantics before AP-02–05 integration. No production action is requested or authorized by this entry.

## M2 constraints carried forward

- Deserialized mappings/snapshots must fail closed for null/missing fields, non-string references, invalid `now`, and non-canonical/non-UTC expiry timestamps; hash integrity is not authorization. Runtime deployment must compare against an owner-approved deployment hash/authority before serving.
- M2 primary analysis keeps the fixed eligible visitor cohort, including render failures. A known assigned visitor who later lacks campaign context remains in outcomes and does not disappear from the denominator.
- Before acceptance, freeze concrete performance percentile/window and layout/asset budgets (not only a median target); no online model/provider call is permitted in the render path.
- M2 completion requires connected merchant intake/approval, two materially distinct evidence-backed bundles, versioned deployment and runtime selection with control/treatment semantics, canonical measurement, proof/FAQ rendering, and campaign coverage/update flow. Standalone helpers are not completion evidence.

## M2 integrated slice evidence (2026-09-06)

Connected changes (still local only):

- `app/services/v2-deployment.server.ts` accepts an additive adaptive bundle set, validates all bundle records against merchant/product and runtime approval, requires experiment registration freeze for every bundle, and hashes the snapshot/bundle set into the deployment authority payload.
- `app/services/v2-decision.server.ts` resolves the approved bundle from the deployment snapshot only after v2 authority and sticky assignment; unknown first-time traffic is excluded before enrollment, while missing later context keeps the assigned visitor in the cohort and fails open to Original. Existing single-content v2 payloads remain unchanged.
- `app/services/adaptive-package.server.ts` builds an immutable approved package from active campaign mappings and approved product experiences, reports mapping coverage, computes an owner-review package hash, and provides the deployment caller seam. `app/routes/app.messages.tsx` now exposes owner-only package preparation with an explicit no-deploy message.
- `AdaptivePackageReview` is an additive persisted review record. Owner approval re-builds the current package and rejects stale/tampered/cross-tenant hashes; deployment preparation now requires an approved review record rather than accepting a caller-supplied hash alone.
- `storefront/adaptive-panel-v2.js` and generated `extensions/adaptive-panel/assets/adaptive-panel-v2.js` validate and render bounded approved proof items and evidence-backed FAQ items alongside benefits; no executable or generated HTML is accepted.
- `tests/mvp-v2-runtime.test.ts` adds an SQLite integration fixture with two distinct approved bundles, a frozen adaptive deployment, treatment resolution, and unknown-campaign Original fallback.

Evidence: `pnpm exec tsx --test tests/adaptive-panel.test.js tests/mvp-v2-runtime.test.ts tests/adaptive-contracts.test.ts` — PASS, 29/29; `pnpm typecheck` — PASS; focused ESLint — PASS; `pnpm build:theme-runtime` — PASS. The storefront request builder now sends validated `pag_campaign` references and browser tests cover known/unknown URL context.

The existing v2 orchestrator now consumes the latest approved package only when its payload/hash and every reviewed bundle content hash still match; it registers `MATCHED` treatment with the reviewed protocol/content set and passes through existing activation/QA/hold gates. `loadAdaptiveCoverage` reports assigned eligible visitors, mapped assigned visitors, unmatched assigned visitors, and render-failure visitors from decisions/assignments—not mapping-row counts. SQLite and PostgreSQL schema/migration tracks include `AdaptivePackageReview`; SQLite upgrade fixtures execute the additive migration. PostgreSQL schema validation was attempted but is externally blocked in this local environment because `DATABASE_URL` is not a PostgreSQL URL (`P1012`); no connection or migration was run.

Review package complete for M2. FAQ is implemented through the existing governed `rawOutputJson` extension; a dedicated persisted FAQ schema is deferred. No deployment or production flag was changed. PostgreSQL schema validation passed with a command-scoped dummy URL; no database connection or migration was run.

## M2 focused review corrections and M3/AP-06 preparation (2026-09-06)

Milestone status: **M2 LOCALLY_VERIFIED; M3 LOCAL_PREPARATION_COMPLETE / LIVE_GATES_OPEN**. No deployment, live flag, treatment, charge, provider change or external approval was performed.

The reviewed package now binds the current product source/version/hash, exact supplied campaign evidence, immutable mapping snapshot, every visible bundle field, FAQ/proof/evidence trace, content hash and a separately recomputable runtime authority hash. Package parsing re-verifies its canonical hash. New mapping versions, product-source changes and newly approved content invalidate pending/approved pre-deployment reviews while retaining audit/history; deployment rechecks current authority and an existing registered experiment keeps its frozen mapping instead of being silently mutated. Runtime selection verifies the complete frozen bundle set and registration hashes on every adaptive request and fails open to Original on authority drift.

Adaptive experiments now have two non-interchangeable versioned registrations: `adaptive-original-vs-matched-a1` for total policy effect and `adaptive-universal-vs-matched-a1` for matching-specific effect. The latter requires a distinct frozen Universal control. Reports surface the registered question and interpretation boundary. Coverage uses all assigned eligible visitors, preserves mapping eligibility for control and returning visitors, counts render failures/missing render outcomes, and reports unmatched pre-enrollment context separately without adding it to the causal denominator.

The owner review UI now shows exact campaign text, mapping versions/references, bundle text, FAQ/proof, evidence links, coverage, both protocol questions and all relevant source/package/snapshot/content/authority hashes before the approval action. Storefront FAQ uses native keyboard-accessible disclosure markup and text-only rendering. `adaptive-performance-a1` freezes percentile/window/layout/asset budgets; local tests enforce the deterministic core and built gzip limits. Real browser-to-server/CLS evidence remains a live AP-06 gate rather than a fabricated local PASS. The complete checklist and exact external boundaries are in [doc65](./65-adaptive-storefront-release-checklist.md).

Changed paths in this correction package:

- `app/services/adaptive-contracts.ts`, `adaptive-experiment.server.ts`, `adaptive-package.server.ts`, `adaptive-performance.ts`
- `app/services/experiment-registration-v2.server.ts`, `autopilot-v2-orchestrator.server.ts`, `v2-deployment.server.ts`, `v2-decision.server.ts`, `experiment-report-v2.server.ts`, `governance.server.ts`
- `app/components/adaptive-package-review.tsx`, `app/routes/app.messages.tsx`
- `storefront/adaptive-panel-v2.js`, generated `extensions/adaptive-panel/assets/adaptive-panel-v2.js`, and `extensions/adaptive-panel/assets/adaptive-panel.css`
- `tests/adaptive-contracts.test.ts`, `adaptive-panel.test.js`, `adaptive-performance.test.ts`, `adaptive-review-ui.test.tsx`, `mvp-v2-runtime.test.ts`
- `docs/64-adaptive-development-status.md`, `docs/65-adaptive-storefront-release-checklist.md`

Fresh focused evidence before the final gate: adaptive contracts/runtime/renderer/performance/owner-review UI **35/35 PASS**; pinned Node 24 TypeScript and focused ESLint **PASS**. Local asset evidence after rebuilding: generated adaptive v2 runtime is about 10.6KiB raw and remains below the frozen 5KiB gzip cap; combined loaded runtime assets remain below 10KiB gzip. The final full source-gate result and source identity are appended below after that one run.

## Final local source gate (2026-09-06T16:59:47Z)

The authoritative pinned-runtime gate used Node `v24.19.0`. `pnpm check` completed with **358/358 tests passing**, followed by TypeScript, full ESLint, React Router production build and Shopify app build. Shopify reported **“Pagnetic built!”**. `pnpm check:partner` passed **31/31** checks, including the current 28-directory SQLite migration track and a successful configured database query. The separate PostgreSQL schema validated successfully with a command-scoped dummy PostgreSQL URL; no connection or migration was attempted by that validation.

Read-only release-source capture after the gate recorded **332 files** and SHA-256 `5987e552f651b3115f715f6bf725d8a9a0ad9d26a6dabb2c5f4dbd279bb44070`. No source changed between the valid gate and this capture except this evidence paragraph and the corresponding tracker notice, so this digest identifies the pre-evidence source state rather than a deployable manifest. The first attempted gate used the host default Node 20 and failed only at Shopify CLI because `enableCompileCache` is unavailable there; it is superseded by the complete pinned Node 24 gate and is not release evidence.

**Review conclusion:** all currently scoped safe local AP-00–AP-06 engineering and release preparation is complete. This does **not** authorize a deployment or treatment activation. Design-partner launch readiness still requires the live gates in doc65: exact merchant/product/ad evidence and owner approval, supported published-theme/checkout/consent/pixel/refund evidence, real latency/CLS/capacity measurement, off-volume restore plus acknowledged alert delivery, and legal/distribution/commercial approvals. Original serving and all existing production holds remain unchanged.

## Owner-authorized safe deployment (2026-09-06T17:09Z)

The approved release configuration added terms effective date `2026-09-06` and made every retained hold explicit. Deploy source identity was **332 files**, SHA-256 `720da7950b50a93dbffd86d6494e9229511081040b4eb8dfd5daf83db8fcf4f5`. Fly release/machine version 23 is healthy as image `pagnetic:deployment-01M1VTZ60EF67QX1CYAS7QYC7K`; the existing encrypted volume and secrets were preserved. The additive `adaptive_package_reviews` migration applied and Prisma confirms all 28 migrations are current. Startup automation/privacy returned 200 and the automatic encrypted off-volume backup/readback/isolated restore completed successfully.

Post-deploy runtime verification confirms billing, v2 serving, shadow serving, model use and offer publication remain `false`. The current extensions/configuration were built, validated and released through Shopify as `pagnetic-ap06-20260906` (version ID `1117888282625`). A Make HTTPS endpoint accepted the setup payload with HTTP 200 and was installed as encrypted `ALERT_WEBHOOK_URL`; the resulting Fly machine version 24 is healthy. A fresh encrypted off-volume backup/readback/isolated restore verified at `2026-09-06T18:51:50.373Z`, and the production checker now passes **47/47**. After the Gmail scope was repaired and the scenario reactivated, Make recorded a successful production-originated alert run and the owner confirmed delivery to `bilgi@flapp.ist`. No treatment, charge, App Store publication, design-partner approval or lift claim is implied.

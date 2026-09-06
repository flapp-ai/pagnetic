# Pagnetic adaptive storefront — execution plan

Date: 2026-09-06. Status: owner-authorized scoped development; Luna implements and Astra reviews milestones.
Requirements: [doc60](./60-adaptive-storefront-prd.md). Baseline: [doc61](./61-built-vs-required-assessment.md).

## Delivery rule

Reuse the application; no platform rewrite. Finish one coherent, verifiable campaign-adaptive path before expanding scope. Every package must record source identity, changed paths, checks executed and remaining gates. Never label provider/human evidence as code-complete. Documentation alone changes no runtime, flags, approvals or active experiments.

## Ordered packages

| Package | Scope and likely code area | Depends on | Exit evidence |
| --- | --- | --- | --- |
| AP-00 Contract freeze | Versioned deployment/bundle/decision schemas; campaign eligibility, default/revisit rules, runtime budgets; measurement addendum; reconcile docs24/04/05 explicitly | Owner scope confirmation | Contract examples and reviewer checklist; legacy behavior preserved; acceptance cases below allocated |
| AP-01 Campaign intake | Existing messages/diagnosis/mapping services; ad-first UI, exact evidence, two-to-three angle proposals, link validation and supported inputs | AP-00 | Approved fixture with two distinct campaigns; malformed/ambiguous/cross-tenant/changed sources rejected |
| AP-02 Experience package | Evidence-backed proof/FAQ plus headline/benefits/reassurance; bundle approval and native previews | AP-01 | Source provenance and rendering tests; human judges distinctness/usefulness before live approval |
| AP-03 Contextual runtime | Versioned multi-bundle deployment and policy resolver; extend runtime/storefront contracts, preserve fixed arm assignment | AP-00/02 | Deterministic campaign-to-bundle selection; safe defaults, revocation, idempotency and old-version regression checks |
| AP-04 Direct policy tests | Registration/orchestration/analysis/results for Original vs matched and Universal vs matched; preserve canonical ledger | AP-03 | Statistical calibration and end-to-end assignment→render→eligible order/refund fixtures; claims accurately distinguish total vs matching effect |
| AP-05 Recurring operation | Campaign coverage, add/update-ad flow, source-change review queue, clear current notices and results | AP-01/04 | Second campaign/update completed entirely through supported UI; frozen experiments unchanged; action deduplication |
| AP-06 Controlled pilot release | Source-bound full check, migrations/rollback, theme/browser/consent/checkout/performance, privacy and recovery gates | AP-02–05 | Exact release evidence, owner approval, real provider checks and declared supported capacity; no broad launch claim |
| AP-07 Commercial learning | Five qualified pilot stores, setup/support tracking, bounded price offer, repeat-campaign and paid continuation | AP-06 plus merchants/offer | Actual use/payment evidence and per-store economics; positive/negative/inconclusive results retained |

Do not assign a percentage or calendar completion date before AP-00 sizes the implementation and a pilot has a traffic forecast. Store recruitment should proceed alongside engineering; lack of merchants cannot be solved by more platform features.

## Acceptance case inventory

| Case | Expected result | Package |
| --- | --- | --- |
| AC-01 Two approved ads, one product | Different relevant bundles on treatment; same control policy | 01–04 |
| AC-02 Unknown/ambiguous reference | Registered safe default; coverage reason recorded; no guessing | 01/03 |
| AC-03 Forged reference/wrong tenant/product | No data or content leakage | 01/03 |
| AC-04 Unsupported promise/review | Abstention; no invented fact/testimonial | 02 |
| AC-05 Reordered-only/duplicate drafts | Not accepted as meaningful contextual variants | 02 |
| AC-06 Content or evidence changes after approval | Invalidate authority; preserve history and safe serving | 02/03/05 |
| AC-07 Repeat visit/new campaign | Same experiment arm; content follows frozen revisiting policy | 03/04 |
| AC-08 Consent denied/revoked/regranted | Existing privacy rules enforced; no unauthorized context/identity reuse | 03/06 |
| AC-09 Timeout/provider/model failure | Original remains usable; no online model dependency | 03/06 |
| AC-10 Kill switch/cutover/rollback | Exact authorized scope only; original restored and cached authority invalidated | 03/06 |
| AC-11 Paid order, refunds, test order, replay | Canonical eligible net outcome; deterministic exclusions/idempotency | 04/06 |
| AC-12 Null/negative/sparse/unbalanced effects | No false winner or campaign attribution confusion | 04 |
| AC-13 Maximum duration/maturity | Stop enrollment as registered; mature outcomes; honest inconclusive state | 04 |
| AC-14 New campaign during active experiment | Review/new version, never silent mutation | 05 |
| AC-15 Missing mapping coverage | Correct known-visit denominator; not claimed ad-spend coverage | 05 |
| AC-16 Existing v1/v2 populated store | Old protocols, approvals, financial reports and privacy controls preserved | 00/03/06 |
| AC-17 Supported mobile/theme/browser | Accessible stable useful panel; checkout controls unchanged; measured performance | 02/06 |
| AC-18 Merchant repeat task | Add/update campaign without database edits; operational time recorded | 05/07 |
| AC-19 Billing/evaluation/cancellation | No unapproved price/charge; owner-approved boundaries respected | 07 |
| AC-20 Recovery and alerts | Independent scoped replay/restore and actual destination delivery evidence | 06 |

## Explicit later work

Behavioral personalization is Horizon C, not hidden unfinished AP work: define permitted signals, implement consented context, shadow evaluation and a separately randomized comparison against campaign-only. Optional ad connector follows validated need and permissions. Learned policies, extra placements/platforms and cross-store training require separate approval and evidence.

## Stop/go decisions

- Technical stop: unsafe rendering, tenant/consent boundary failure, corrupted attribution, unresolved recovery or missing live authority. Fail open; never bypass.
- Product stop: source cannot support distinct useful stories, or placement cannot deliver a visible improvement. Improve/abstain before running a weak test.
- Commercial stop: repeated activation friction or no recurring paid need. Investigate with merchants rather than expanding the feature list.
- Scientific stop: informative studies fail to support matching benefit. Distinguish no evidence from evidence of no useful effect; do not relabel a generic improvement as personalized lift.

## Next concrete action

Owner scope approval is recorded. Implement AP-00 through AP-06 code-controlled preparation under [doc63](./63-luna-development-brief.md), tracking evidence in [doc64](./64-adaptive-development-status.md). Merchant recruitment, live treatment, pricing and public launch remain separate gates. Do not invent operators or grant roles.

## Additional acceptance and economical review

- AC-21: the primary flow works without shopper chat or answering a question; unknown context safely falls back.
- AC-22: all randomized eligible visitors remain in primary analysis; engagement is never a post-treatment eligibility filter.
- AP-00 includes a bounded blueprint reuse decision, not an integration project. Explicit questions remain Horizon C.
- M1 review: AP-00/01 contracts and mapping foundations. M2 review: AP-02–05 integrated vertical slice. M3: AP-06 final source-bound release preparation. Review new diffs and risk boundaries, not the full historical audit repeatedly.

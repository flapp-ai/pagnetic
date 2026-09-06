# Pagnetic Autopilot MVP Launch Readiness

> **Audit qualification — 2026-09-05:** The [Astra audit](./21-astra-market-and-product-audit.md) found new launch-blocking implementation and measurement gaps despite the passing existing suite. The historical release evidence below is preserved, but the statements that no code-controlled P0 remains and that only owner actions block launch are superseded by the [improvement execution plan](./23-pagnetic-improvement-execution-plan.md). No production behavior or frozen registration was changed by the audit.

Status: production-deployed release candidate; 7 of 9 test-store commerce QA checks passed  
Release: Fly machine version 13  
Verified: 2026-09-05  
Production origin: `https://pagnetic.fly.dev`

## Outcome

The Autopilot MVP in [the productization PRD](./19-autopilot-productization-prd.md) is implemented and deployed. A merchant install now prepares a deterministic, source-grounded opportunity; asks for one bounded approval; requires the published-theme save; validates instrumentation with A/A; runs Original versus Universal; reports verified incremental revenue separately from projections; and preserves a one-action Original fallback.

The original release assessment reported no open code-controlled P0 scenario. That assessment is superseded: the 2026-09-05 audit identifies additional implementation and measurement blockers. Both those repairs and the applicable owner/provider gates below must be resolved before a real design-partner experiment is declared ready.

## Required-scenario traceability

| # | Required proof | Automated evidence | Result |
| --- | --- | --- | --- |
| 1 | Clear product is deterministic | `tests/autopilot.test.ts` — selects a clear product deterministically | Pass |
| 2 | Material tie asks merchant | `tests/autopilot.test.ts` — a material candidate tie asks the merchant to choose | Pass |
| 3 | Missing history has no precise duration | `tests/autopilot.test.ts` — missing history produces a source-based recommendation without duration precision | Pass |
| 4 | Excluded product is never approvable | `tests/autopilot.test.ts` — excluded and unavailable products cannot become approvable | Pass |
| 5 | Unsupported text is blocked | `tests/governance.test.ts` — blocks unsupported, unapproved, expired, and high-risk evidence; blocks claims with no linked evidence | Pass |
| 6 | Approval freezes all authority | `tests/autopilot-integration.test.ts` — approval freezes content, evidence, mappings, protocols, safety, and authority | Pass |
| 7 | Frozen-input drift invalidates | `tests/autopilot-integration.test.ts` — drift in every frozen authority field invalidates the plan before activation | Pass |
| 8 | Unpublished theme cannot verify | `tests/autopilot-integration.test.ts` — an unpublished theme remains blocked and cannot start A/A | Pass |
| 9 | A/A waits for every gate | `tests/autopilot-integration.test.ts` — A/A cannot start until every technical gate passes | Pass |
| 10 | Failed A/A cannot start real test | `tests/autopilot-integration.test.ts` — failed A/A never starts a real experiment | Pass |
| 11 | Passing A/A advances once | `tests/autopilot-integration.test.ts` — approved plan advances A/A exactly once | Pass |
| 12 | Safety pause serves Original | `tests/autopilot-integration.test.ts` — safety pause preserves Original; `tests/measurement.test.ts` — runtime rollback on safety failures | Pass |
| 13 | Early result is not final | `tests/autopilot-integration.test.ts` — an early real-test snapshot is never promoted to a final result | Pass |
| 14 | Negative and Inconclusive stay free | `tests/autopilot-integration.test.ts` — negative outcomes remain free; inconclusive and invalid outcomes preserve free access | Pass |
| 15 | Invalid stays free | `tests/autopilot-integration.test.ts` — inconclusive and invalid outcomes preserve free access | Pass |
| 16 | Automation is idempotent | `tests/autopilot-integration.test.ts` — repeated result automation creates one transition, notice, and entitlement decision; billing is disabled and no charge surface exists in this release | Pass |
| 17 | Stores are isolated | `tests/autopilot-integration.test.ts` — one merchant cannot read or mutate another merchant's plan | Pass |
| 18 | Pause works during live measurement | `tests/autopilot-integration.test.ts` — approved plan advances to the real test, then pause stops active experiments and enables the kill switch | Pass |
| 19 | Verified and projected value differ | `tests/incremental-value.test.ts` — distinct visible labels, visual treatments, and screen-reader labels | Pass |
| 20 | Uninstall stops storefront and automation | `tests/autopilot-integration.test.ts` — uninstall disables runtime, experiments, pixels, sessions, and plan automation | Pass |

## Release evidence

| Gate | Evidence | Result |
| --- | --- | --- |
| Full repository check | 79 tests, TypeScript, ESLint, React Router build, Shopify app build | Pass |
| Storefront budget | Adaptive Panel 9,975 bytes raw and below Shopify's 10,000-byte asset target | Pass |
| Production deploy | Fly image `deployment-01M1Q6NJ0MKBEKF1CJZ84TZZWJ`; machine version 13 in `fra` | Pass |
| Health and HTTPS | `GET https://pagnetic.fly.dev/healthz` returned 200; Fly health check passing | Pass |
| Automation authorization | Unauthenticated production POST returned 401; authenticated scheduler returned 200 | Pass |
| Durable storage | One 5 GB encrypted Fly volume, one writer, 14-day platform snapshots | Pass |
| Database | SQLite integrity `ok`; 11 migrations applied | Pass |
| Backup and recovery | Verified backup `adaptive-storefront-20260904T190517Z.sqlite` restored into an isolated database; integrity `ok`; 11 migrations; temporary copy removed | Pass |
| Shopify release | App version `pagnetic-split-latency-20260905` released | Pass |
| Development-store install | Pagnetic loads in Shopify admin; production Web Pixel is active | Pass |
| Live Autopilot preparation | The Complete Snowboard is approved, published-theme verified, and running a registered Original-versus-Original QA experiment | Pass |
| Consent behavior | Real storefront denial suppressed events; late grant released queued events; a later allowed product view produced a measured decision | Pass |
| Split latency telemetry | Live decision recorded 467 ms browser-to-decision and 10 ms server processing | Pass |
| Test-store commerce QA | Placement, mobile, desktop, standard checkout, accelerated checkout, consent, and Original fallback | 7/9 pass |
| Production readiness command | All checks pass except alert delivery and terms effective date | Blocked by owner inputs |
| Custom domains | Fly certificates created for `pagnetic.com` and `www.pagnetic.com` | Waiting for DNS |

## Owner actions before a design-partner test

These steps intentionally cannot be performed by unattended product code:

1. Complete Shopify Payments business verification so the remaining Shop Pay checkout QA can run.
2. Supply the named incident owner and backup contact. Confirm which address receives alerts; `support@flapp.ist` and `privacy@flapp.ist` are recorded, but no person's identity is inferred.
3. Supply a real external alert webhook and acknowledge one synthetic alert. An uptime monitor must also check `/healthz` from outside Fly.
4. Choose the legally approved terms effective date and approve the privacy policy and terms with counsel.
5. Update DNS at the domain registrar:
   - apex `A` → `66.241.124.61`
   - apex `AAAA` → `2a09:8280:1::183:972a:0`
   - `www` `CNAME` → `1pwj6wn.pagnetic.fly.dev`
   Remove conflicting apex and `www` records. Wait for both Fly certificates to become verified before changing the Shopify application URL.
6. Confirm support hours, incident owner, the USD 49/store/month founding price, and whether billing remains disabled for the first acquisition cohort. Billing is currently disabled.
7. Complete the App Store assets, protected-customer-data declaration, reviewer instructions, and Shopify submission.
8. Finish the two open test-store QA checks: Shop Pay, and the current experiment's frozen 150 ms end-to-end decision-latency gate. Do not rewrite that registered threshold. New `pilot-v0.3` registrations separately measure browser-to-decision latency (provisional 1,000 ms p95 ceiling) and server processing (150 ms p95 ceiling).
9. Select and onboard a real design partner, qualify one published product, and complete a mature production A/A result before making any lift claim.

## Release boundary

- The production database is single-writer SQLite. Keep one app machine and a maximum of 25 founding-beta stores until a capacity review and managed-database migration.
- Original is the fail-open storefront policy. No treatment can serve before merchant approval, published-theme verification, active Web Pixel, qualification, QA gates, and passing A/A.
- Billing, price changes, discounts, inventory, checkout, product images, and unsupported claims are outside Autopilot authority.
- A live lift claim is not authorized until a mature registered real experiment reconciles orders and refunds.

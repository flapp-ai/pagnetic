# V2 capture integrity, health and qualification evidence

Date: 2026-09-05. Scope: development evidence for R02/R05/R07/R12. This is not a deployed-store consent check, A/A validation, launch approval or sales claim.

## Consent and event authority

The v2 Web Pixel requires both analytics and preferences consent before reading or writing its decision context or sending measurement. A consent epoch invalidates queued events and retries; serialized storage removal follows any in-flight write on revocation. The actual TypeScript pixel runs in a VM regression harness, including the revoke-during-write and revoke/regrant-during-retry interleavings.

Checkout product matching scans every checkout line. The focal product may be the second item; an unrelated first quick-add item cannot borrow its attribution. Decision expiry remains fixed and product scoped. This proves code behavior against a mocked Shopify interface, not accelerated-checkout compatibility.

The receiver requires an active credential, an allowlisted envelope/data shape, allowed consent and a new-event receipt window of five minutes. V2 experiment/product/window context comes from the persisted decision, not client assertions. Client identities are tenant HMACs; decision visitor/session identities remain server-authoritative. Known event IDs replay idempotently without creating fresh observations. An atomic event/render transaction permits only one consistent final render result per decision; conflicting reports roll back.

The pixel manifest now sets `preferences=true`. **Do not release that extension into an active legacy analytics-only experiment without a compatibility/cutover review.** A new pixel-level consent requirement can change legacy capture even when the v2 backend flag is off. No extension deployment occurred in this slice.

## Observable health contract

`pagnetic-measurement-health-v2.1` derives evidence from persisted assignments, decisions, pixel observations, final render outcomes and verified financial links. Final report generation applies this assessment itself; a caller-supplied `READY` cannot bypass it. The pinned report stores its assessment and later reads do not recompute that frozen result.

- Server decisions older than a five-minute receipt grace form the bridge denominator. At least 20 settled decisions are required before its coverage gate is applied.
- Non-Original decisions require a final render acknowledgment. A failed render is a captured failure, not successful presentation; it still counts as an acknowledgment. Original A/A decisions have no adaptive-render requirement.
- Checkout identities are deduplicated across repeated pixels, checkout/order aliases and server orders. Independently observed missing-link cases remain failures in their known arm. An unknown arm is shown separately; it is never assigned an invented arm.
- Unassigned focal-product store orders are a separate store-level diagnostic, not the experiment's loss denominator. Test orders do not contribute to real evidence.
- At least 100 observable non-test checkout outcomes per arm are required. The absolute difference in linkage failure must be at most two percentage points. Linked eligible financial orders must all reconcile, with no unresolved contradictory links.
- A conservative **prelaunch** addition requires overall observable checkout linkage of at least 95%. Symmetrically losing every checkout must not appear healthy merely because the arm difference is zero. This adjustment is versioned; it cannot be introduced into an already-running registration to recover a result. Synthetic fault-injection tests cover symmetric and asymmetric loss, not a universal false-alarm calibration.

Wholly unobserved loss cannot be inferred from the same missing signals. These metrics must be paired with controlled real checkout paths. A population of known linked orders is not proof of complete capture.

Database integration tests retain a missing-link checkout, deduplicate its repeat, separate an unknown-context pixel and an unassigned focal order, and reject cross-tenant lookup. Pure health tests cover the per-arm floor, symmetric loss, asymmetric loss, duplicate inflation, render failures and contradictions.

## Qualification v2.3

Qualification now requires source coverage through at least seven days after the baseline observation window. Missing or immature outcome coverage yields `BASELINE_REQUIRED`. The service still needs an authoritative production data-source assembler; accepting a timestamp in a pure evaluator is not proof of real source maturity.

`dailyEligibleVisitors` means first-eligible visitor cohorts; its sum must equal the distinct baseline sample. Returning sessions cannot inflate it. `dailyObservableCheckoutVisitors` counts at most one first observable checkout per visitor and groups that outcome by the visitor's first eligible cohort day, not by checkout day. Missing checkout-rate evidence yields `PREVIEW_ONLY` with no precise completion date.

The planning buffer is 250 checkout visitors for the required 100 outcomes per arm. Under independent 50/50 A/A allocation, conditional on an unchanged observable-checkout population, the two-sided Hoeffding shortfall bound is below 1.4%. This is a planning assumption, not an A/B guarantee: treatment may change checkout propensity. Actual per-arm observations remain mandatory before early enrollment close and validation.

An observed daily-rate band drives both A/A and A/B durations. This is a conditional planning band, **not** a prediction interval or promise that traffic and capture stay stable. A/A needs 7–14 enrollment days, 1,000 visitors and the checkout information floor. If that floor is not plausibly reachable by day 14, qualification stays `PREVIEW_ONLY`. A/B needs its statistical target and the checkout floor within its frozen 14–42 enrollment days. Both stages retain their separate seven-day attribution and seven-day financial review windows.

Synthetic examples with 300 eligible visitors/day and sufficient statistical power:

| Observable checkout visitors/day | A/A enrollment estimate | Full two-stage minimum | Qualification consequence |
| --- | ---: | ---: | --- |
| 50 | 7 days | 49 days | Can qualify with all other evidence |
| 20 | 13 days | 55 days | Can qualify with all other evidence |
| 10 | 25 days | 78-day hypothetical | Preview only; A/A exceeds its 14-day limit |
| Unobserved | Unknown | Unknown | Preview only; no precise date |

The 78-day value is an infeasibility explanation, not permission to run a 25-day A/A. Alpha/power and attribution/review windows cannot be weakened to fit a commercial trial. The actual statistical target remains the greater analytic/conservative-bootstrap sample; repeated testing for a winner is not introduced.

The independent SciPy calibration was rerun after v2.3. All 45 quantiles, 24,000 null experiments and 12,000 power experiments pass with unchanged measured source hashes. Planned statistical sample sizes and detection power remain as documented in `30-v2-statistical-calibration.md`; checkout feasibility adds restrictions instead of lowering those samples.

## Remaining integration

1. The subsequent Original-only baseline assembler now has local implementation evidence in `34-original-baseline-source-contract.md`. Connect it to baseline collection and the merchant plan; ordinary unassigned product-view counts remain traffic diagnostics only.
2. Connect qualification, registered enrollment, actual health-aware close and finalization to the merchant plan and supervised worker. Service tests alone are not an end-to-end plan.
3. Verify live Customer Privacy API behavior, cart properties, mixed cart, direct buy, Shop Pay and lost thank-you-page capture on the intended supported theme.
4. Review immutable as-of versus current operational health projections for late source changes; preserve pinned reports and make ambiguity explicit.
5. Verify bounded request handling, remote delivery, retention and real off-volume recovery. No live/deploy/commercial state changed here.

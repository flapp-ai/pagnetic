# Test1 remaining QA plan

Status: test1 demonstration evidence is partially captured. The recovery hold remains on; no baseline activation, treatment serving, public rollout, or merchant-readiness claim is authorized.

## Performance decision

The current activation implementation accepts a fresh authenticated `performance` QA receipt, but the recorder validates receipt integrity and scope rather than calculating the frozen performance protocol. Recording a weak artifact would therefore pass an implementation gate without satisfying PRD section 13.2.

Section 13.2 requires all of the following:

- server decision p95 at or below 150 ms under accepted mixed load;
- client decision p95 at or below 1,000 ms and deterministic Original by the 1,500 ms absolute deadline, validated on relevant mobile devices and geographies;
- supported-theme before/after LCP, INP, and CLS distributions with absolute quality, confidence, and sample reporting; proposed degradation budgets are p75 LCP at most 100 ms, p75 INP at most 20 ms, and CLS increase at most 0.02;
- concurrent storefront, webhook replay, and reporting load at twice the forecast cohort peak, reporting p50/p95/p99, fallback percentage, database waits, queue age, RSS, and errors; and
- a cohort-specific request/event cap derived from evidence, not the configured 25-store limit.

Test1 has no population-derived forecast cohort peak. A tiny synthetic run can exercise fallback and collect diagnostic timings, but cannot legitimately establish the population percentiles, confidence, geography/device relevance, or two-times-forecast load required by the frozen PRD. Consequently, a truthful `performance` PASS cannot be recorded now and test1 cannot legitimately cross the existing 9/9 activation gate.

This exposes a narrow dependency conflict in the current exact protocol. Section 14 intentionally calls for a selected internal test-store cutover with an Original baseline and a fresh v2 plan, but the implementation requires the full section 13.2 population-grade `performance` PASS before it can start even that held internal Original baseline. The existing protocol therefore permits a supervised test1 demonstration through `VERIFYING`—including approval, published-theme/runtime verification, fail-safe Original, checkout and consent QA—but it does not permit baseline activation without making a population-grade claim that test1 cannot support.

The specific owner decision is one of:

1. Keep test1 at `VERIFYING` with the recovery hold on and use the existing protocol only for the completed Original/fail-safe demonstration; or
2. Separately authorize design and implementation of a lab-only test1 demonstration protocol that is cryptographically/durably distinct from the real `performance` PASS and cannot activate mature treatment or satisfy public/merchant rollout readiness.

A safe lab-only protocol would retain the exact test1 allowlist and recovery hold, record bounded diagnostic latency/deadline/fallback/load evidence under a different evidence type, permit at most an explicitly labeled internal Original-only demonstration state, and prohibit A/B treatment, rollout reuse, or conversion into a section 13.2 receipt. Population-grade performance remains a later rollout gate when a real cohort is nominated; a real store is not required merely to finish ordinary test1 QA. This alternative requires an explicit product/code decision and is not authorized by the current QA delegation.

## Review and register the other six checks

Current-release observations exist for `mobile`, `desktop`, `standard_checkout`, `accelerated_checkout`, `shop_pay`, and `consent_flows`, but none is accepted merely because a screenshot or note exists.

For each check:

1. Preserve the original artifact bytes, honest scope, timestamp, device/viewport, URL/product context, and limitations. Consent should include the ordered native deny, partial-deny, successful late-grant under the hold, revoke, and reload-denied observations, plus the uncategorized first transient. Shop Pay may be `NOT_APPLICABLE` only with the captured store/payment capability evidence. Accelerated checkout should be `APPLICABLE` when the observed direct-buy route is the capability under test.
2. Astra may review the exact bytes and conclusion under the owner's explicit QA delegation. The production recorder still requires an actor key that already belongs to an active Pagnetic `OWNER` or `OPERATOR`; delegation alone does not create that durable application role. If Astra has no such role, an existing authorized actor must record the reviewed result or separately grant Astra an operator role through the normal governed access path. Never supply or impersonate the root user's actor key.
3. Upload the reviewed bytes to the approved private evidence store under a non-semantic SHA-256 object key. The repository recorder does not upload artifacts.
4. An authorized actor runs the existing recorder against the authoritative database/environment, with the exact current `APP_RELEASE`, test1 shop, Pagnetic product `cmtpl078j0042q6m2tyug5g3t`, a unique receipt-bound idempotency key, and their own existing actor key:

   ```sh
   APP_RELEASE=<exact-current-release> pnpm exec tsx scripts/record-v2-qa-evidence.ts \
     --apply \
     --shop test1-eczm2zce.myshopify.com \
     --product-id cmtpl078j0042q6m2tyug5g3t \
     --check-key <check> \
     --applicability <APPLICABLE-or-supported-NOT_APPLICABLE> \
     --artifact-file /absolute/path/to/reviewed-artifact \
     --artifact-ref qa-artifact:v1:<64-hex-private-object-key> \
     --actor-key <reviewing-actors-own-existing-key> \
     --idempotency-key v2-qa:cmtzd7f0k007kq6lafgyydxtc:<check>:v1 \
     --captured-at <ISO-8601>
   ```

5. Confirm Overview accepts the receipt only for the current recovery receipt, product, published theme/template, app release, actor, artifact hash, and 14-day freshness window. A later application release requires current-release evidence again.

Do not select **Activate verified Original baseline** while `performance` remains pending. The six accepted checks improve test1 demonstration evidence but do not substitute for real-merchant performance, mature baseline, payment/attribution, or public-rollout evidence.

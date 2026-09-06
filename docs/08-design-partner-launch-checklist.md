# Design-Partner Launch Checklist

Status: operational gate  
Owner: product owner  
Applies to: one qualified Shopify design partner and one hero product

No live test may start until every item below has evidence in the app or the release record.

## 1. Commercial and legal

- Signed pilot agreement: scope, no guaranteed lift, support channel, pilot dates, suspension rights, data roles, sub-processors, and termination/deletion terms.
- Merchant has supplied a current privacy-policy URL and confirmed its consent banner behavior in every pilot market.
- Product is outside the claims-policy pilot exclusions. Any exception has written legal approval and a new policy version.
- A named incident contact and backup contact are recorded.

## 2. Store and product readiness

- Required Shopify scopes are healthy.
- Catalog sync is current and the source-derived brand profile is approved.
- One hero product is `READY`, or the owner has recorded a specific internal override.
- Current product evidence is approved and the exact Universal treatment is approved and previewed. Matched content is optional in MVP v2 and requires a separate approved registration; it is not a prerequisite for Original-versus-Universal.
- Paid campaigns use stable UTM source, campaign, and content values. Every material campaign has an active mapping; unknown traffic policy is explicit.
- Adaptive Panel is detected on the published product template. Native variants, quantity, subscription, selling-plan, add-to-cart, accelerated checkout, and Shop Pay controls remain owned by the theme.

## 3. Production readiness

- Stable HTTPS application URL; Shopify app and redirect URLs updated and deployed.
- Production secrets are generated independently and stored only in the hosting secret manager.
- Persistent database volume is attached to exactly one application writer instance for the pilot.
- Six-hour online backup, authenticated checksum/readback and remote retention complete; a restore drill has been performed in a disposable environment.
- `/healthz` is monitored externally. `/internal/automation` runs every five minutes with its bearer secret.
- Alert webhook reaches the on-call channel. One synthetic alert has been acknowledged.
- `pnpm check` and `pnpm check:production` pass for the release.

## 4. Browser and commerce QA

Record a dated evidence link for all nine checks in **Setup and qualification**:

1. block placement;
2. mobile layout;
3. desktop layout;
4. standard checkout and order join;
5. accelerated checkout and order join;
6. Shop Pay path;
7. analytics consent denied, allowed, and granted late;
8. original fallback on timeout, invalid payload, missing mapping, and kill switch;
9. Core Web Vitals and decision-service latency.

Use a real published-theme test order for each supported checkout path. Refund one test order and verify net revenue changes exactly once.

## 5. Experiment sequence

- Register and launch A/A first. Do not inspect lift during the validation window.
- Proceed only after a mature `MEASUREMENT_CHECKS_PASSED` v2 A/A snapshot, its authoritative Original baseline qualification and healthy event/render/order-join coverage. A/A does not prove economic equivalence.
- Register Stage 1: Original versus Universal. Freeze content, mappings, allocation, eligibility, sample, duration, and stopping rules.
- Universal versus Matched is deferred by default. Run it only as a separate explicitly approved experiment after a mature positive Stage 1 snapshot; do not relabel or mutate Stage 1.
- Keep the original holdout and automatic rollback active throughout.

## 6. Launch-day procedure

1. Confirm no open SEV1/SEV2 alert and no unresolved incident.
2. Run product sync; if anything becomes stale, stop and reapprove.
3. Run scheduled maintenance manually and verify a completed automation record.
4. Confirm the published theme, Web Pixel, event endpoint, and current content hashes.
5. Clear the kill switch, launch the registered stage, and open representative mapped and unmapped URLs.
6. Watch errors, p95 decision latency, render coverage, sample ratio, event coverage, and order joins for 30 minutes.
7. Record the launch time and all theme, campaign, price, inventory, promotion, and checkout changes as confounders.

## 7. Stop conditions

Pause immediately for checkout interference, content outside approval, protected-data leakage, severe sample-ratio mismatch, high render-error rate, or the frozen revenue guardrail. The kill switch must restore the original storefront without a theme deployment.

## 8. Exit criteria

The product is design-partner ready when the app reports every product readiness check as passed, the production check passes, a restore drill is documented, and an owner can execute the launch and rollback runbooks without a developer changing code.

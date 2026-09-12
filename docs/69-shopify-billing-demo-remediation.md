# Shopify billing and onboarding-demo remediation

Date: 2026-09-12
Status: IN PROGRESS — do not mark reviewer findings resolved until live evidence below is complete.

## Source and workspace

Owner supplied Shopify requirements 1.2.2 and 4.5.3 with reviewer videos:
- https://shopify.click/10-15-vjm2q-f8wh2.webm — embedded `admin.shopify.com refused to connect` observed.
- https://shopify.click/10-07-sty0r-j8ahm.webm — Shopify's post-reinstall app settings show Founding Beta, $0/month and `Plan expires 10 Oct`; Pagnetic must reflect canonical expiry rather than indefinitely claiming active access.

The original `/Users/erenyigit/Documents/ChatGPT/ecommerce ai` checkout has dataless cloud-offloaded files and a branch reference that time out on reads. It was not repaired destructively or overwritten. Work proceeds in a fresh GitHub checkout at `/Users/erenyigit/pagnetic-review-KqNpQ9`, starting at `803e99b`. New source changes must be pushed to the existing flapp-ai/pagnetic repository and preserved for later workspace reconciliation.

## Required evidence before resubmission

| Requirement | Repair / proof | Current evidence |
| --- | --- | --- |
| View plans | Actual merchant click leaves the app iframe for Shopify's hosted plan page; no refused-to-connect screen | PASS live: Settings → View plans opened the real top-level Shopify plan page after release38 |
| Approve | No-charge development flow approved in real Shopify UI; return re-verifies the canonical contract | Public Founding Beta free test approved; initially reproduced OFFER_INACTIVE. Release39 verified its provider trial end Oct12. General public test-contract correction is being deployed; final regression pending |
| Decline | Real hosted decline creates no new entitlement or charge; a valid existing contract is not accidentally revoked | PASS for change-plan cancellation: canceled Founding Beta approval and existing private Test plan remained Current. No-existing-contract decline still pending |
| Reinstall | Actual uninstall/reinstall refreshes the provider contract without relying on plan_handle | PASS Sep12: real uninstall/reinstall; fresh provider verification at19:50:45UTC, then explicit no-charge reapproval at19:52:34UTC. See lifecycle evidence below |
| Expiry / cancellation | Provider-confirmed access end is visible, stale or missing confirmation is explicit, expiry blocks access and reapproval is available | PASS live date comparison: both Pagnetic and Shopify showed cancellation/expiry Oct12 after reinstall. Expired-time enforcement remains automated-test evidence, not a fabricated live clock |
| Review-store pricing | Legitimate Shopify development/review-store terms are handled without granting arbitrary unapproved free plans | Canonical production verification investigation pending |
| Onboarding demo | Actual real UI recording shows source/product selection, campaign/message configuration, review/approval, theme placement, storefront testing and expected results | Recording runbook in doc68; recording pending |
| Proof and submit | Final hosted video verified; correct proof URLs attached; Shopify receipt inspected | Pending all above; no current success claim |

## Engineering check

One integrated `pnpm check` on Node 24.19.0 passed 383/383 tests, TypeScript, full ESLint, application production build and Shopify extension build. This proves tested source behavior, not acceptance/decline/reinstall in Shopify or functional onboarding on a real storefront. Any later change needs verification proportionate to its scope.

Final reviewer-UI source `637c48c37d1d2dd1ddff81c0c74927c5dbe49530` is pushed and deployed as Fly machine version 41/image `deployment-01M2B5J4H16K7GTZ4PXM0YD7M6`. Machine `d8d1497a937658` is started in `fra`; its Fly service check passes and the public health endpoint returns 200. All 28 migrations remain current. Startup encrypted backup `pagnetic-2108ff79-9adf-4490-af27-51b993bc7ab8.sqlite.enc` passed verification and isolated restore in 1558ms without changing remote backup objects. Proportionate final checks passed: 18 billing tests, 9 subscription-presentation tests, 3 approved-message/preview UI tests, TypeScript and the application production build. These checks do not complete the still-pending live preview/Settings verification, uninstall/reinstall, owner package approval, final video or resubmission.

## Live reproduction and provider semantics

- Public Founding Beta test approval returned charge `37179097394`. Shopify explicitly displayed that no charge would be billed.
- Canonical Partner response: `activeSubscription` present, `founding-beta`, `EVERY_30_DAYS`, effective USD0, `trialEndsAt=2026-10-12T15:35:23Z`, `price.active=false`.
- The old adapter incorrectly treated catalog price activity as contract activity. Shopify documents [FlatRatePrice.active](https://shopify.dev/docs/api/partner/latest/objects/FlatRatePrice) as false after a product price changes. The enclosing [activeSubscription](https://shopify.dev/docs/api/partner/latest/queries/activeSubscription) is the active contract authority.
- Shopify also documents [public-plan no-charge testing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#testing) as an effective USD0 contract. Public-plan verification must not depend on this one development store's allowlist. Private `shopify-test` remains restricted.
- Live Settings after release39 showed verified end **Oct12,2026**, refreshed Sep12 15:46UTC. Shopify's own Manage app page showed **Free trial / 30 days left / Founding Beta $0/month after trial**. Reinstall remains unverified at this checkpoint.

## Actual configuration rehearsal

- Selected existing synthetic QA pouch, product `cmtpl078j0042q6m2tyug5g3t`.
- Created campaign `pagnetic_review / qa_pouch_20260912 / two_pockets`, Universal angle, exact supplied ad: **Two internal pockets separate cables and adapters.**
- Real UI generated a source-supported draft, displayed exact evidence, and accepted message approval. This is synthetic QA, not a human quality-evaluation attestation or sales proof.
- Prepared package review `cmtyk2lwt0042q6lcpscbsz28`, hash `031bd66c64eccd13cde465ea9ec4d3ae05760ee496d44a806fd7de302d535898`, 1/1 mappings supported. Owner approved in chat; exact package approval applied through the real UI and confirmed APPROVED after reload. This is not deployment or QA-artifact approval.
- Current storefront remains paused with missing authenticated QA surfaces. Do not record this as working adaptive serving or mark requirement4.5.3 resolved with only hold/error screens.
- A local tab-only MediaRecorder utility is prepared in `scripts/reviewer-recorder/`. Its real browser-tab capture was validated: selected only the test1 Pagnetic tab through Chrome's chooser, captured Shopify Manage app → Pagnetic navigation, stopped capture and downloaded `/Users/erenyigit/Downloads/pagnetic-review-2026-09-12T15-56-11-084Z.webm` (38.291 seconds, 3456x1548). This short recorder validation is NOT the required final demo. No final video has been submitted.

## Remaining owner and live-evidence gates

### Post-release41 live UI verification

On application source `637c48c37d1d2dd1ddff81c0c74927c5dbe49530`, the approved campaign message remains visible with its source evidence and exact experience-specific preview link. The real click opened experience `cmtyk0vc2002cq6lcdbrvwehx` with the expected pockets headline. Changing Device to Mobile retained the same experience ID and rendered the readable mobile-sized proposed panel. This verifies merchant preview, not actual mobile checkout or adaptive serving.

Settings refreshed through Shopify at **2026-09-12 16:05UTC** and displayed confirmed access through **Oct12,2026**. View plans again navigated the top-level browser to Shopify's hosted pricing route. No reinstall, new charge, final video submission, or owner package approval was performed in these checks.

### Pending actions

1. Exact synthetic package approval is complete, using the owner's explicit answer. Other QA artifacts still require their own actual evidence and owner review.
2. Owner approved the disclosed test1 uninstall/reinstall. It completed through Shopify's actual UI and developer-dashboard Install app link. Session deletion/recreation, pixel deactivation, privacy cleanup and fresh subscription verification were observed. Reconnect pixel then exposed a stale deleted-provider-ID bug; a targeted repair is in progress. Recovery must not silently restore stale entitlement or clear the serving hold.
3. `PAGNETIC_V2_ENABLED=false` and shadow=false remain unchanged. Before uninstall the selected plan was VERIFYING with no linked experiment; uninstall invalidated preparation and changed the runtime hold to `App uninstalled`. Current Overview reports `AUTOPILOT_PREPARATION_INACTIVE`. Normal setup/preparation recovery is required; the old migration-hold snapshot is not current authority. This is not active adaptive serving. `ADAPTIVE_SERVING_ENABLED` is not used by the current serving path.
4. Current legitimate activation path is seven missing scoped QA artifacts (mobile, desktop, standard checkout, accelerated checkout, Shop Pay, consent, performance), owner artifact review, exact selected-store v2 enablement, and Overview's atomic **Activate verified Original baseline**. Only evidenced non-applicability may substitute for accelerated/Shop Pay tests. Do not directly clear the kill switch.
5. Actual treatment follows registered baseline/measurement and maturity gates. A synthetic rehearsal or merchant preview cannot prove sales uplift or replace these gates. The reviewer video must label previews and Original/baseline behavior accurately.
6. Chrome's tab-specific extension control recovered; scoped Pagnetic tabs now work independently of unrelated tabs. Full-screen/native capture remains inappropriate while another task uses Chrome. The prepared recorder captures only the explicitly selected browser tab, never the whole screen.

## Guardrails

- Preserve approved Founding Beta USD49 every30days, 30-day Shopify trial and canonical provider verification; no custom charge creation or fabricated expiry.
- No real charges, unrelated stores, reviewer credential edits, fake revenue or synthetic video interfaces.
- The previous screenshot slideshow did not meet requirement4.5.3. Do not substitute another screenshot slideshow or a technical-error explanation for an actual onboarding/configuration demonstration.
- Keep production data, historical experiments, rollback controls and user files intact. A completed submission is not Shopify approval.
- Chrome testing/recording/submission for Pagnetic was explicitly reauthorized. Concurrent Chrome activity was detected: use scoped tab controls and the explicit Pagnetic-only capture picker; do not capture the whole screen or operate unrelated task tabs.

## Sep12 actual recording checkpoint

- Downloaded real tab-only package approval/uninstall rehearsal: `/Users/erenyigit/Downloads/pagnetic-review-2026-09-12T19-45-47-499Z.webm`. It includes an unsuccessful direct auth entry attempt; the successful reinstall used the developer-dashboard install link. Do not describe that failed entry attempt as a pass.
- Downloaded real reinstall/billing proof: `/Users/erenyigit/Downloads/pagnetic-review-2026-09-12T19-52-45-793Z.webm`, 3,645,379 bytes, VP9 WebM, 3456x1548, approximately308.687s by cluster/block timestamps. Browser preview decodes at readyState4; no independent full-file decode tool was available. Container duration metadata is absent, so browser duration can appear infinite.
- Billing clip captures reinstall, fresh cancellation/expiry, top-level hosted plans, canceled reapproval, explicit free-test reapproval and fresh Active status. Draft English captions are local at `tmp/reviewer-billing-20260912-captions-draft.vtt`; timing needs visual review before publication.
- These files remain local and are not the final required end-to-end configuration/working-storefront screencast. Nothing has been uploaded or submitted as completed reviewer proof.
- Requested separate owner permission for test1-only v2 testing while Original and safety holds remain intact. No flag was enabled by the package/uninstall approval.

## Reinstall pixel recovery repair

Real **Reconnect pixel** reproduced a deleted-provider-ID error after reinstall. `activateWebPixel` now resolves Shopify's current app pixel before update/create instead of trusting historical local metadata. An owned-store read-only API2026-07 check observed explicit `data.webPixel=null` plus a single `RESOURCE_NOT_FOUND` error at `webPixel`. Both this raw-response shape and the installed Shopify SDK's thrown error shape are handled narrowly. Missing/malformed data, authorization/network errors and mixed/other provider errors do not authorize creation. Existing privacy activity guards remain in place; this repair never clears serving holds.

Bounded verification: 19/19 measurement tests and TypeScript passed. Root reviewed the change; deployment and actual reconnect confirmation must be recorded separately below. Normal preparation recovery also needs the explicit Operations workflow because uninstall invalidates the old plan; no direct database hold clearing is permitted.

## Owned-store uninstall, reinstall and reapproval evidence — 2026-09-12

- Before uninstall, production held a freshly verified public Founding Beta contract: `ACTIVE`, provider `ACTIVE`, no cancellation, verified `2026-09-12T16:06:46Z`, with Shopify-confirmed access through `2026-10-12T15:35:23Z`. One Admin session and one active pixel credential existed.
- The owner authorized and completed uninstall for `test1-eczm2zce.myshopify.com`. The webhook cleanup receipt was created at `2026-09-12T19:44:12Z`: sessions fell from one to zero, the pixel became inactive, the merchant kill switch became active with reason `App uninstalled`, and the pending `APP_UNINSTALLED` privacy-request count increased from nine to ten. The old subscription row remained stored but could not authorize an embedded request without a session.
- Shopify's native development-dashboard installation flow reinstalled the app. Pagnetic created a new expiring Admin session and refreshed the canonical Partner contract at `2026-09-12T19:50:45Z`, rather than presenting the old watermark. Shopify returned `CANCELLED`; Pagnetic mapped it to `CANCEL_AT_PERIOD_END` through `2026-10-12T15:35:23Z`. Live Settings displayed **Cancellation scheduled**, the October 12 access boundary and the 19:50 verification time. Pixel and serving stayed disabled after reinstall; no stale runtime was silently restored.
- The hosted pricing page continued to open top-level. A declined Founding Beta approval retained Shopify's existing October 12 boundary. The owner then approved Shopify's explicit **Free / no billing** development-store offer (`charge 37179752754`). A fresh canonical refresh at `2026-09-12T19:52:34Z` returned provider `ACTIVE`; Pagnetic stored `ACTIVE`, cleared cancellation, and displayed Shopify-confirmed access through `2026-10-12T19:52:20Z`. The latest verified-authority audit is `2026-09-12T19:52:35Z`; no new redirect-verification failure was recorded.
- This is owned-test-store lifecycle evidence, not reviewer-store completion or Shopify approval. Remaining gates are the final continuous onboarding/configuration video review and upload, truthful demonstration of the still-held storefront/QA state, attachment of current proof to the Shopify response, and resubmission. Adaptive serving remains paused; uninstall cleanup did not reactivate the pixel or clear the kill switch.

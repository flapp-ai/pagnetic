# Shopify submission checkpoint — 2026-09-07

Current checkpoint2026-09-12: ACTION NEEDED; billing/reinstall repairs are live-tested, but the new complete screencast and resubmission remain pending. The Sep7 resubmission receipt below is historical, not current approval.

## Scoped test-store enablement — 2026-09-13

Release43/source `42dd579a84e25a9cfb7922fb7180fa00888e9ab9` is deployed healthy. A new strict runtime allowlist enables v2 only for test1, independently of cutover permission; other stores fail closed. Affected tests63/63, TypeScript and production build pass. Actual published-page DOM confirms `KILL_SWITCH_ACTIVE`, hidden panel, no deployment and unmeasured Original fallback. Runtime independently confirms zero active experiments/deployments, intact uninstall hold and active canonical pixel. Backup verification/restore1487ms and28 current migrations passed. Clearing only the uninstall pause for fresh setup needs the separately requested owner answer; no hold or experiment was activated. The full video and resubmission remain pending.

## Owned-store reinstall recovery — 2026-09-12

Owner-approved package approval and uninstall/reinstall completed in actual Shopify UI. Reinstall refreshed the provider contract to cancellation scheduled through Oct12; Shopify's own plan screen showed the same expiry. Declining reapproval retained that boundary; explicit free-test reapproval freshly restored Active with a confirmed date. No real charge was created.

The test exposed stale deleted-pixel recovery. Reviewed source `e8ed09a6c0f5cb7bee4e1929c5bb5ca9ecd2feb8` was pushed and deployed in image `deployment-01M2BKBK3R644CTNHASYKCAZXC`. Its 19 targeted measurement tests, TypeScript and production build passed. Public health returns200 and Fly's check passes. Normal measurement-page recovery and the actual **Reconnect pixel** button now succeed; serving holds were not cleared. Fly's postdeploy DNS probe to8.8.8.8 timed out locally, but the public health request succeeded. Full lifecycle evidence, recording paths and remaining gates are in doc69.

## Shopify App Pricing remediation — 2026-09-12

- Shopify review reported that **View plans in Shopify** remained inside the embedded frame and that a reinstalled plan did not expose a trustworthy expiry. The production baseline reproduced the broken embedded-frame navigation. Commit `40cef34` moves the hosted Shopify pricing page to the top-level admin, refreshes the canonical Partner API contract on authenticated app entry and Settings load, bounds cached authority to Shopify's verified trial/billing end, and never treats `plan_handle`, `charge_id`, a local flag or an experiment result as payment approval.
- The owned development-store flow then reproduced a second real adapter defect after approving the public `founding-beta` plan through Shopify's explicit **Free, You will not be billed** test path. The Partner API returned an authoritative active subscription with `founding-beta`, USD `0.0`, `EVERY_30_DAYS`, `trialEndsAt=2026-10-12T15:35:23Z`, no current billing cycle, and `price.active=false`. The app truthfully rendered verification unavailable because it incorrectly treated the price-version flag as contract status.
- Shopify documents `FlatRatePrice.active=false` as meaning that the product price was updated, while the enclosing `activeSubscription` is the canonical live contract. Commit `df58a54` therefore validates the exact app/shop identity, configured handle, USD flat-rate type, every-30-days cadence, effective amount and verified trial/cycle boundary from `activeSubscription`; it uses `price.active` only to prefer the current price version. The public handle accepts the approved USD 49 price or Shopify's provider-issued effective USD 0 no-charge test price. The automatic private `shopify-test` handle remains restricted to the explicit store allowlist. An active unexpected price wins selection and fails closed instead of falling back to an inactive USD 49 version.
- Decline/no-contract refresh maps to canceled access rather than inventing a free trial. Scheduled cancellation retains access only until Shopify's verified cycle or trial end; provider outage cannot extend a stale active contract beyond that date. Settings distinguishes local evaluation, verified active/trial/cancel state, expiry, and verification unavailable without guessing provider facts.
- Integrated pre-release verification passed 383/383 tests plus TypeScript, full ESLint, React Router build and Shopify build. The final pricing adapter suite passes 18/18 and its targeted TypeScript/ESLint checks pass.
- Final source `df58a54804173a390f4db49152f8516dc28dcdfe` is pushed to GitHub and deployed as Fly machine version 40/image `deployment-01M2B4N40JXJ82E29WNS7CYNPB`. Machine `d8d1497a937658` is started in `fra` with 1/1 health check passing. All 28 migrations are current with none pending. Startup encrypted backup `pagnetic-3968a6f3-fc16-43bd-bd86-87d7da60aeb6.sqlite.enc` passed upload/readback/isolated restore in 1585ms; remote backup objects and the existing volume were preserved.
- This closes the code-controlled navigation and canonical lifecycle defects plus the owned-store reproduction. It is not evidence that the reviewer reinstalled successfully, Shopify approved the app, or public billing ran. The reviewer-store accept/decline/reinstall sequence remains a real Shopify review verification gate.
- Final reviewer-UI source `637c48c37d1d2dd1ddff81c0c74927c5dbe49530` is pushed and deployed as Fly machine version 41/image `deployment-01M2B5J4H16K7GTZ4PXM0YD7M6`. Machine `d8d1497a937658` is started in `fra`, Fly reports the service check passing, and the public health endpoint returns 200. All 28 migrations remain current with none pending. Startup backup `pagnetic-2108ff79-9adf-4490-af27-51b993bc7ab8.sqlite.enc` passed encrypted verification and isolated restore in 1558ms; remote backup objects remained unchanged. The final scoped verification passed 18 billing, 9 subscription-presentation and 3 approved-message/preview UI tests, plus TypeScript and the application production build. Live preview/Settings checks, uninstall/reinstall, owner package approval, final video and resubmission remain pending.

## Reviewer runtime repair — 2026-09-07

- Confirmed production failure: `APP_UNINSTALLED` and `SHOP_REDACT` returned HTTP 500 when Shopify's SDK attempted to refresh a revoked expiring offline token before invoking the webhook handler. Cleanup never ran, leaving stale reviewer sessions. This matches the SDK's known bare-500 invalid-refresh path.
- Mandatory uninstall/privacy handlers now validate Shopify's raw-body HMAC without requesting Admin API credentials. Missing headers remain HTTP 400 and a tampered HMAC remains HTTP 401; no authentication bypass or blanket success fallback was added.
- Embedded Admin authentication now has one bounded recovery attempt: only a bare HTTP 500, a cryptographically valid Shopify session token, a same-shop expired offline session with refresh credentials, and an exact compare-and-delete of the observed credential version can trigger removal and token exchange. Invalid JWTs, non-500 errors, unexpired sessions and concurrently refreshed records are preserved.
- Every merchant-facing embedded route uses the guarded authenticator. The existing expiring-offline-token setting remains enabled.
- Targeted auth tests pass 8/8, including real Shopify SDK signed-body/tampered-body validation, bounded retry, invalid-token preservation, unexpired-session preservation and compare-and-delete race behavior. TypeScript and the production build pass.
- Commit `406429c` is pushed. Fly image `deployment-01M1YS0MED7PKXQVJF6RTA7Q36`, machine version 36, is started with 1/1 health check passing; `/healthz` returns HTTP 200.
- Live recovery proof used only the owned development store, not the reviewer's shop: its offline credential was deliberately changed to expired invalid test markers, then a fresh Shopify Admin embedded request was opened. `/app` returned HTTP 200, the full Overview rendered, and Shopify token exchange replaced both markers with a new expiring credential. Messages also rendered after embedded navigation. No reviewer token, iframe URL or secret is retained in this document.
- The original review-shop `/app` HTTP 500 cannot be replayed because Pagnetic does not control the reviewer session. The confirmed webhook defect and stale-session mechanism strongly explain the sequence, while the exact causal link to the reviewer's embedded error remains an evidence-backed inference rather than a claimed replay.
- Both Shopify findings were marked resolved with the hosted reviewer walkthrough URL in Shopify's URL-only proof field. At that moment the file was the pre-fix narrated interface walkthrough, not a live repair capture; it did not by itself prove the authentication repair. Without withdrawing the pending submission, the file at that same submitted URL was subsequently replaced with the dated post-fix evidence described below. The feedback page changed to `2/2` and **Ready to resubmit**. After **Submit fixes**, Partner Dashboard changed to **In review**, **We're reviewing your response**, and **Success! We received your submission.** Review correspondence remains `bilgi@flapp.ist`; visibility remains limited to merchants with the direct URL after approval.

## Authoritative submission receipt

Root completed the final review step and clicked Submit for review under the owner's existing explicit approval. The live Partner dashboard changed to **Submitted**, displayed **Success! We received your submission.**, and stated that Shopify is assigning a reviewer. Review correspondence goes to `bilgi@flapp.ist`. The receipt URL is `https://partners.shopify.com/5157971/apps/418274574337/distribution/app-store`.

The receipt also confirms English as primary and limited App Store visibility: when published, the listing will be accessible only through its direct URL. No fully-visible setting was enabled. The five-minute submission follow-through automation was deleted after this verified receipt to avoid unnecessary polling. Earlier remaining-step and login notes below are historical and superseded by this receipt. No app approval, real merchant experiment, or revenue uplift is claimed.

## Completed in Shopify

- App: Pagnetic (`418274574337`), submission/client ID `a419293d1339cc23b5841538d18a1710`, Partner ID `5157971`.
- English is the primary listing language. The Pagnetic icon, corrected 1600x900 feature image and three distinct prepared desktop screenshots are present. The listing copy, support address, merchant-review address, submission address, Online Store requirement and three feature statements are saved. After the owner attached and saved the corrected feature image, a fresh reload showed the feature upload control disabled in its attached state and exactly three screenshot sections.
- Public plan `founding-beta` is USD 49 every 30 days with a 30-day trial. Development stores are free to test.
- The public plan passed the owned development-store selection flow on `test1-eczm2zce.myshopify.com`: Shopify displayed `Free to test`, the owner-approved no-charge action completed, and Shopify redirected to `/app?plan_handle=founding-beta&charge_id=37160976690`.
- Shopify App Pricing is enabled. The migration page reports `Draft and test plans completed` and `App Pricing enabled completed`. Shopify also exposes its automatic private `shopify-test` plan.
- The private `shopify-test` plan is restricted to `test1-eczm2zce.myshopify.com`. Shopify approved its free charge (`37161206066`) and redirected to `/app?plan_handle=shopify-test`.
- The reviewer screencast URL is saved in the English listing. A fresh listing reload preserved it.
- Shopify's submission summary recognizes the `embedded` and `online store` capabilities. The common-error automated check now reports `Passed`.
- Partner API client `35709` (`Pagnetic subscription verification`) was created with only `Manage apps`. Its token is stored only as encrypted Fly secret `SHOPIFY_PARTNER_API_TOKEN`; its value was not printed or committed.
- Business and emergency contacts are saved with `bilgi@flapp.ist`, `support@flapp.ist`, and the approved emergency phone.

## Reviewer screencast

- `public/reviewer-6f2c9b31/pagnetic-shopify-review.mp4` is now a 5 minute 50 second narrated sequence of three current post-fix screenshots captured from the owned development store's live embedded Overview, Messages and Results routes on 2026-09-07. It explicitly identifies itself as dated screenshots, not a continuous recording.
- It explains the reviewer failure, confirmed webhook defect, narrowly guarded stale-session recovery, controlled forced-expiry test, current rendered routes, eight focused auth regressions, and the limitation that the reviewer store itself was not replayed.
- Narration source: `docs/app-store-assets/reviewer-screencast-narration.txt`.
- Reproducible builder: `scripts/build-review-screencast.swift`.
- Local validation: the replacement MP4 is 14,899,893 bytes, duration `350.373333` seconds, contains H.264 video plus AAC narration, and has SHA-256 `71f3c66f135e65b50437e949e7c93f3eba080275389dfba96e96eb676a7b8903`. Media-only Fly deploy `deployment-01M1YT9M7DM4QQ905PJGK10G8G`, machine version 37, is healthy 1/1. A fresh full download from the unchanged submitted URL returned HTTP 200, `video/mp4`, byte ranges, the expected content length, and the identical SHA-256. The URL remains `https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review.mp4`.

## Runtime pricing integration verified

- The installed Shopify app handle is `adaptive-storefront`; the hosted plan-selection route is `/charges/adaptive-storefront/pricing_plans`.
- The production configuration uses Partner ID `5157971`, App GID `gid://shopify/App/418274574337`, public plan handle `founding-beta`, private test handle `shopify-test`, and the explicit no-charge allowlist `test1-eczm2zce.myshopify.com`.
- The `/app` loader now treats `plan_handle` as a verification trigger, checks it against the configured plan, queries Shopify's Partner API and persists only the server-verified subscription. A redirect parameter or charge ID alone never grants paid authority. Failures create an audit event and retain the safe existing entitlement.
- Shopify's canonical Partner API verification succeeded and persisted `active` at `2026-09-07 08:07 UTC`; the current period ends `2026-10-07`.
- The integration accepts the $0 private test contract only for the configured private handle and explicit development-store allowlist. The public `founding-beta` handle must match USD 49 or Shopify's canonical effective USD 0 no-charge test price, every 30 days; Shopify, not a local allowlist, determines eligibility for that public-plan test price.
- Targeted subscription tests pass 12/12. TypeScript and the production application build pass. Production deploy `deployment-01M1XEBHD4W1ZGCSQ68Y26RMQ2` reached healthy state with verified DNS; code is pushed through commit `ce716b4`.

## Production alert delivery correction

- Commit `4c31000` is deployed as Fly image `deployment-01M1XQMHDJ97PAQ89S120Q2FCK`, machine version 35. Fly reports the machine started with 1/1 health check passing; `/healthz` returns HTTP 200.
- Remote operational delivery now uses durable incident idempotency regardless of the storefront V2 flag. SEV1 incidents and actual `AUTOMATION_FAILURE` events remain remotely actionable; lower-severity warnings remain visible in Pagnetic without consuming Make operations. Retry, resolution and reopen behavior remain covered.
- Focused delivery tests pass 7/7 and TypeScript passes. Production automation runs at `2026-09-07 16:49:53`, `16:54:54` and `16:59:54 UTC` all completed with `delivery=IDLE`, `delivered=0`, `failed=0`, `skipped=0`. No test webhook was sent.

## Remaining controlled sequence

1. Monitor `bilgi@flapp.ist` for Shopify's review response; do not poll the Partner dashboard continuously.
2. If Shopify requests changes, record the exact issue and run only the targeted remediation/retest.
3. After approval, use the limited direct listing URL to invite qualified founding-beta stores. Approval is not design-partner activation or evidence of uplift.

The prior file-upload and authentication blockers were resolved. The final requirements attestation and submission action completed successfully, and Shopify issued the receipt recorded at the top of this document. The app is submitted but not yet approved or publicly available.

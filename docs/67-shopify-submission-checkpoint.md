# Shopify submission checkpoint — 2026-09-07

Status: RESUBMITTED and IN REVIEW after targeted remediation, verified live on 2026-09-07. Shopify approval and published availability remain pending.

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
- The integration accepts the $0 private test contract only for the configured private handle and explicit development-store allowlist. Public stores must match the approved `founding-beta`, USD 49, every-30-days contract.
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

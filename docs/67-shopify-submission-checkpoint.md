# Shopify submission checkpoint — 2026-09-07

Status: in progress. This is evidence for the current Shopify-controlled launch sequence. It does not claim Shopify approval or a public listing.

## Completed in Shopify

- App: Pagnetic (`418274574337`), submission/client ID `a419293d1339cc23b5841538d18a1710`, Partner ID `5157971`.
- English is the primary listing language. The Pagnetic icon and three distinct prepared desktop screenshots are present. The listing copy, support address, merchant-review address, submission address, Online Store requirement and three feature statements are saved. Shopify currently requires a replacement feature image; the corrected 1600x900 asset is prepared locally but not yet attached.
- Public plan `founding-beta` is USD 49 every 30 days with a 30-day trial. Development stores are free to test.
- The public plan passed the owned development-store selection flow on `test1-eczm2zce.myshopify.com`: Shopify displayed `Free to test`, the owner-approved no-charge action completed, and Shopify redirected to `/app?plan_handle=founding-beta&charge_id=37160976690`.
- Shopify App Pricing is enabled. The migration page reports `Draft and test plans completed` and `App Pricing enabled completed`. Shopify also exposes its automatic private `shopify-test` plan.
- The private `shopify-test` plan is restricted to `test1-eczm2zce.myshopify.com`. Shopify approved its free charge (`37161206066`) and redirected to `/app?plan_handle=shopify-test`.
- The reviewer screencast URL is saved in the English listing. A fresh listing reload preserved it.
- Shopify's submission summary recognizes the `embedded` and `online store` capabilities. The common-error automated check now reports `Passed`.
- Partner API client `35709` (`Pagnetic subscription verification`) was created with only `Manage apps`. Its token is stored only as encrypted Fly secret `SHOPIFY_PARTNER_API_TOKEN`; its value was not printed or committed.
- Business and emergency contacts are saved with `bilgi@flapp.ist`, `support@flapp.ist`, and the approved emergency phone.

## Reviewer screencast

- `public/reviewer-6f2c9b31/pagnetic-shopify-review.mp4` is a 4 minute 27 second narrated walkthrough assembled from the prepared actual Pagnetic interface views. It is a narrated still-image walkthrough, not a continuous live screen recording.
- It covers the public preview, evidence-backed message review, merchant approval boundary, Shopify theme activation, shopper fallback, measurement, pause behavior and Shopify-hosted plan approval.
- Narration source: `docs/app-store-assets/reviewer-screencast-narration.txt`.
- Reproducible builder: `scripts/build-review-screencast.swift`.
- Local validation: the final MP4 is 13 MB and contains video and audio tracks. It is deployed at `https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review.mp4`; an independent HTTP check returned `200`, `video/mp4`, byte-range support and the expected content length. That URL is saved in Shopify.

## Runtime pricing integration verified

- The installed Shopify app handle is `adaptive-storefront`; the hosted plan-selection route is `/charges/adaptive-storefront/pricing_plans`.
- The production configuration uses Partner ID `5157971`, App GID `gid://shopify/App/418274574337`, public plan handle `founding-beta`, private test handle `shopify-test`, and the explicit no-charge allowlist `test1-eczm2zce.myshopify.com`.
- The `/app` loader now treats `plan_handle` as a verification trigger, checks it against the configured plan, queries Shopify's Partner API and persists only the server-verified subscription. A redirect parameter or charge ID alone never grants paid authority. Failures create an audit event and retain the safe existing entitlement.
- Shopify's canonical Partner API verification succeeded and persisted `active` at `2026-09-07 08:07 UTC`; the current period ends `2026-10-07`.
- The integration accepts the $0 private test contract only for the configured private handle and explicit development-store allowlist. Public stores must match the approved `founding-beta`, USD 49, every-30-days contract.
- Targeted subscription tests pass 12/12. TypeScript and the production application build pass. Production deploy `deployment-01M1XEBHD4W1ZGCSQ68Y26RMQ2` reached healthy state with verified DNS; code is pushed through commit `ce716b4`.

## Remaining controlled sequence

1. Attach `docs/app-store-assets/00-feature-media-shopify-v2.png` as the required feature image and save the English listing. The three duplicate screenshots were removed; the three distinct screenshots remain.
2. Re-open the submission summary, verify Shopify reports no remaining required-field issue, complete the truthful final requirements review, and submit the already owner-approved app for Shopify review.
3. Record Shopify's returned status or exact rejection. Submission is not approval.

The partner laptop is unlocked. Shopify's live file input is enabled and advertises `image/jpeg,image/png`; the corrected 1600x900 PNG and JPEG satisfy that contract. The supported browser upload API nevertheless rejects `fileChooser.setFiles` with `Not allowed`. The native macOS chooser can select either exact file by path, but its **Open** button remains disabled and Return has no effect. This is an upload-control failure, not a locked-session failure. No unsupported file-input bypass was used. Attaching this one prepared image remains the sole presently observed submission blocker; the app has not yet been submitted.

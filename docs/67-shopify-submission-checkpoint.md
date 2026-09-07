# Shopify submission checkpoint — 2026-09-07

Status: in progress. This is evidence for the current Shopify-controlled launch sequence. It does not claim Shopify approval or a public listing.

## Completed in Shopify

- App: Pagnetic (`418274574337`), submission/client ID `a419293d1339cc23b5841538d18a1710`, Partner ID `5157971`.
- English is the primary listing language. The Pagnetic icon, feature image and three distinct prepared desktop screenshots are present. The listing copy, support address, merchant-review address, submission address, Online Store requirement and three feature statements are saved.
- Public plan `founding-beta` is USD 49 every 30 days with a 30-day trial. Development stores are free to test.
- The plan passed the owned development-store flow on `test1-eczm2zce.myshopify.com`: Shopify displayed `Free to test`, the owner-approved no-charge action completed, and Shopify redirected to `/app?plan_handle=founding-beta&charge_id=37160976690`.
- Shopify App Pricing is enabled. The migration page reports `Draft and test plans completed` and `App Pricing enabled completed`. Shopify also exposes its automatic private `shopify-test` plan.
- The reviewer screencast URL is saved in the English listing. A fresh listing reload preserved it and reported no remaining required-field issue.
- Shopify's submission summary recognizes the `embedded` and `online store` capabilities. The common-error automated check now reports `Passed`.

## Reviewer screencast

- `public/reviewer-6f2c9b31/pagnetic-shopify-review.mp4` is a 4 minute 27 second narrated walkthrough assembled from the prepared actual Pagnetic interface views. It is a narrated still-image walkthrough, not a continuous live screen recording.
- It covers the public preview, evidence-backed message review, merchant approval boundary, Shopify theme activation, shopper fallback, measurement, pause behavior and Shopify-hosted plan approval.
- Narration source: `docs/app-store-assets/reviewer-screencast-narration.txt`.
- Reproducible builder: `scripts/build-review-screencast.swift`.
- Local validation: the final MP4 is 13 MB and contains video and audio tracks. It is deployed at `https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review.mp4`; an independent HTTP check returned `200`, `video/mp4`, byte-range support and the expected content length. That URL is saved in Shopify.

## Runtime pricing integration prepared

- The installed Shopify app handle is `adaptive-storefront`; the hosted plan-selection route is `/charges/adaptive-storefront/pricing_plans`.
- The production configuration is prepared for Partner ID `5157971`, App GID `gid://shopify/App/418274574337`, plan handle `founding-beta`, and the explicit no-charge allowlist `test1-eczm2zce.myshopify.com`.
- The `/app` loader now treats `plan_handle` as a verification trigger, checks it against the configured plan, queries Shopify's Partner API and persists only the server-verified subscription. A redirect parameter or charge ID alone never grants paid authority. Failures create an audit event and retain the safe existing entitlement.
- Targeted subscription tests pass 9/9. TypeScript and the production application build pass.

## Remaining controlled sequence

1. Create the prepared least-privilege Shopify Partner API client with only `Manage apps`, store its token as the encrypted Fly secret `SHOPIFY_PARTNER_API_TOKEN`, and roll the secret into the deployed build.
2. Add the Partner account emergency-contact phone number, replace the feature image that Shopify flagged for pricing language, and remove the three duplicate screenshot uploads.
3. Repeat the development-store plan redirect against the deployed verifier and confirm the authoritative subscription status.
4. Complete the truthful final requirements review and submit the already owner-approved app for Shopify review. Record Shopify's returned status or exact rejection. Submission is not approval.

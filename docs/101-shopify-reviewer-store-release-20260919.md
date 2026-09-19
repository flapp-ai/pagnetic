# Shopify reviewer-store release and resubmission package

Date: 2026-09-19  
Status: **LIVE QA PASSED — FINAL SHOPIFY RESPONSE/RESUBMISSION REQUIRES OWNER APPROVAL**

## Production release

- GitHub `flapp-ai/pagnetic` main contains reviewer fixes and the reviewer-store evidence bundle through `c7c311d42e84c421ad85011d1713fdbbe80fc569`.
- Fly release 58 runs that exact commit on the existing single machine `d8d1497a937658` in `fra`; no machine, volume or paid-service capacity was added.
- Fly reports `1/1` health checks passing and `https://pagnetic.fly.dev/healthz` returns HTTP 200.
- Startup found all 29 migrations with none pending. The encrypted startup backup verified; remote backup objects were not expanded by this work.

## Verification

- Full suite: **459/459 passed**.
- TypeScript, ESLint and the React Router production build passed.
- Live invited-store navigation passed on Overview, Get started, Messages, Preview, Results and Settings without a blank document, redirect loop, HTTP error page or raw internal error.
- Shopify staff actor `208727212054` was automatically assigned narrow `SETUP`; the pre-existing store owner remains `OWNER`.
- SETUP can sync/select a product and create/revise a source-backed campaign draft. It cannot approve/publish, activate serving, change billing, export data, enter operator workspaces or grant roles. Owner-only buttons and links are hidden rather than leading reviewers into an authorization error.

## Actual reviewer-store configuration

Store: `rhv9sb-uj.myshopify.com` (`MugJestic`)

- Hero product: `Ariel Mug`
- UTM source: `shopify_review`
- UTM campaign: `mug_safe_20260919`
- UTM content: `dishwasher_microwave`
- Angle: `Universal`
- Exact supplied ad message: `Dishwasher and microwave safe`

The live action returned: `The campaign promise is linked to a source-backed draft.` The draft and its exact source trace are visible in Messages and Preview. The storefront remains Original because the store owner has not approved a plan. Results correctly shows no experiment and Settings correctly shows read-only setup access and Original-only serving.

## Reviewer video

Verified public asset: `https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review-20260919.webm`

The video is an actual tab-only recording of Shopify's invited store, followed end-to-end and re-recorded with burned-in English explanations. It is approximately 3 minutes 40 seconds, 3456×1662, 13,925,801 bytes, SHA-256 `856eeabcc8ee58860b95d0e038c85d594a261a34d00c2168b3317ad0ed857f53`. The public response returns HTTP 200 as `video/webm`, supports byte ranges and matches that SHA-256 exactly. It shows onboarding status, the product/source, exact UTM/ad configuration, successful draft, preview/evidence, empty Results and read-only Settings. It does not claim that a draft is live or that sales lift exists.

## Exact draft response to Shopify

> Thank you. We fixed the runtime and reviewer-onboarding issues and configured Pagnetic in your invited MugJestic test store. The Shopify staff account now receives limited setup access automatically, while owner-only approval and activation remain protected.
>
> Reviewer-store walkthrough (English captions, approximately 3:40): https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review-20260919.webm
>
> Reproduce the configured flow: open Pagnetic → Get started and confirm Ariel Mug is selected. Open Messages → Match this product to one campaign. The saved values are UTM source `shopify_review`, UTM campaign `mug_safe_20260919`, UTM content `dishwasher_microwave`, angle `Universal`, and exact ad message `Dishwasher and microwave safe`. Pagnetic verifies the ad promise against the current Shopify product source and displays the source-backed draft plus its evidence in Messages and Preview.
>
> Expected result: the campaign promise is linked to a source-backed draft. The storefront remains Original until the store owner separately approves a bounded plan and the safety checks pass. Results remains empty before an experiment exists, and setup staff cannot publish, activate, bill, export data or enter operator workspaces. We also repeated Overview, Get started, Messages, Preview, Results and Settings without a blank page, Application Error or HTTP 500.

Do not send this response or click Shopify resubmit until the owner opens the hosted video and gives explicit final approval.

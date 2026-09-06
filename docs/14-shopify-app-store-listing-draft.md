# Shopify App Store Listing Draft

Status: owner approved pricing and Public distribution with limited visibility on 2026-09-06. Assets, actual submission configuration, reviewer verification and Shopify approval remain to be completed.

## App name

Pagnetic

## Subtitle

Match approved product messages to campaign intent and measure the result.

## Introduction

Turn one product page into a controlled message experiment. Preview source-grounded Comfort, Performance, Value, and Universal versions, approve every statement, and compare revenue per session while Shopify keeps control of products, prices, inventory, cart, and checkout.

## Core benefits

- Preview campaign-aligned product messages using existing merchant product text.
- Keep every live statement merchant-approved and linked to its source.
- Validate tracking with A/A before testing a storefront change.
- Measure original versus universal and universal versus matched experiences.
- Restore the original storefront automatically on invalid content, errors, or kill switch.

## Founding-beta pricing text

Free preview. Founding Beta: $49 USD/month after a 30-day trial, one active product and up to three campaign messages. Shopify subscription approval is required. Applications do not start billing. Existing free-until-result grants are preserved. A trial does not guarantee a conclusive experiment result.

## Search terms

product page testing, campaign landing page, conversion experiment, PDP personalization, revenue attribution

## Merchant requirements

- Shopify Online Store with an unlocked product page
- One product with enough PDP traffic to finish a test
- Permission to add a Theme App Extension block
- Shopify Customer Privacy consent configuration where required
- Stable campaign labels or UTM parameters for matched testing

## Support and legal URLs

- Landing page: `/`
- Privacy: `/privacy`
- Terms: `/terms`
- Support: `/support`
- Health: `/healthz`

Replace these paths with the production HTTPS origin during submission.

## Reviewer test path

1. Install the app on the supplied review store.
2. Open **Get started** and sync the catalog.
3. Select the seeded hero product.
4. Approve the source-derived brand profile and create the draft library.
5. Review the evidence trace and approve a Universal version.
6. Add Adaptive Panel to the product template through the supplied theme-editor link.
7. Verify that Original mode produces no storefront panel.
8. Use the seeded approved experience and QA-only development override to preview Universal and matched variants.
9. Activate the Web Pixel, place the supplied test order, and verify the decision-to-order join.
10. Activate the kill switch and verify immediate original fallback.

## Prepared listing assets

- App icon: `docs/app-store-assets/pagnetic-app-icon.png` — 1200 × 1200 PNG, square corners, padded mark, no text or Shopify trademark.
- Feature media: `docs/app-store-assets/00-feature-media-free-scanner.png` — 1600 × 900 PNG. Alt text: “Pagnetic’s free product and campaign-message preview form.” No video for the initial submission.
- Screenshot 1: `docs/app-store-assets/01-free-message-preview.png` — 1600 × 900 PNG. Alt text: “Pagnetic compares the original product message with source-backed proposed alternatives.”
- Screenshot 2: `docs/app-store-assets/02-source-backed-message-review.png` — 1600 × 900 PNG. Alt text: “A merchant reviews an exact proposed product message beside its current product source.”
- Screenshot 3: `docs/app-store-assets/03-guided-theme-activation.png` — 1600 × 900 PNG. Alt text: “Pagnetic guides the merchant to save the approved panel on the published product template.”

The screenshots use deterministic demo data and contain no merchant/customer PII, browser chrome, prices, reviews or outcome guarantees. Each shows a different actual product surface. Final upload and Shopify automated review remain pending App Store registration.

## Still requiring submission input or verification

- Demo-store URL and password/instructions if Shopify requires them for the reviewer path.
- Emergency developer-contact phone number.
- Primary listing language: English (proposed); owner can add locales after initial review.

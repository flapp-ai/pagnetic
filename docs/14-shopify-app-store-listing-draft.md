# Shopify App Store Listing Draft

Status: copy-ready draft; owner identity, approved assets, pricing, demo URL, and Shopify review remain outstanding

## App name

Adaptive Storefront

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

Free until your first valid experiment result. A/A validation does not end free access. Paid continuation, if offered, is shown and accepted through Shopify before any charge.

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

## Assets still requiring owner approval

- 1200 × 1200 app icon
- listing feature image and video decision
- three or more current product screenshots
- demo-store URL and password if applicable
- final app name, company identity, support email, and localized listing choices

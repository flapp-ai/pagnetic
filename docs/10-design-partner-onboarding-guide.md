# Design-Partner Onboarding Guide

Give this guide to the merchant operator. Expected hands-on time is 45–60 minutes, excluding the A/A data-collection window.

## Before the call

Ask for one hero product, the last 30–90 days of that PDP's eligible sessions/orders/revenue, paid-campaign UTM values, supported checkout methods, privacy-policy URL, consent-platform name, incident contacts, and current promotion calendar.

## In the app

1. Install Adaptive Storefront and approve the requested Shopify scopes.
2. Open **Governed content** and select **Sync Shopify products**.
3. Review the generated brand profile and approve it.
4. On the hero product, choose **Approve source + build draft library**. This explicitly approves the current merchant-owned source snapshot and creates up to four evidence-bound drafts.
5. Review every claim and its evidence. Revise only with text supported by an approved source, then approve the Universal, Comfort, Performance, and Value versions.
6. Add campaign mappings using the exact UTM values used by live ads. Set the global unknown-traffic policy in **Setup and qualification**.
7. Complete product qualification using PDP-level history. A non-ready result blocks launch unless an owner records a specific override.
8. Open Shopify's theme-editor link, add **Adaptive Panel** to the published product template, save, return to the app, and select **Check published theme**.
9. Preview each approved experience at desktop and mobile widths.
10. Connect the measurement pixel, run all checkout/consent/fallback tests, and save evidence for every QA check.
11. Register the A/A experiment, review the frozen analysis plan, then launch from **Pilot operations** only when every gate passes.

## Merchant expectations

- Adaptive Storefront never changes price, discount, inventory, variants, payment, or checkout logic.
- Draft content is not served. Only the exact merchant-approved immutable version can render.
- The original storefront is the universal failure state and remains a permanent experiment control.
- Catalog edits automatically stale affected approved content until it is reviewed again.
- Campaign, theme, promotion, price, and checkout changes during a test must be recorded as confounders.
- Results are not promised. The purpose of the pilot is to measure causal revenue-per-session lift under a registered protocol.

## Support handoff

Provide the merchant with the incident channel, response hours, kill-switch location, and escalation contact. Demonstrate a pause and recovery before live traffic begins.

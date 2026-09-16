# Reviewer capture completion runbook

**Historical capture plan; execution and final media are recorded in [doc81](./81-reviewer-recording-20260916.md), hosting in [doc83](./83-reviewer-media-deployment-20260916.md).** The owner authorized ordered hosting/deployment preparation. Only final Shopify resubmission requires fresh owner approval. The actual run safely submitted the identical existing campaign mapping to persist a source-backed draft; this later source-checked execution supersedes the earlier plan to display fields only.
This runbook supplements the existing-setup recording in [doc77](./77-reviewer-recording-20260914.md). It is a real Pagnetic-only Chrome walkthrough for `test1-eczm2zce.myshopify.com`, not a script for simulated screens or still images.

## Before recording

1. Use the Shopify Admin app launch for the authorized development store. Confirm the embedded Pagnetic app is authenticated as the owner/operator approved for this test store. Do not operate another store or share a signed demo URL.
2. Use only the disclosed synthetic product **Pagnetic QA Travel Pouch - Synthetic Test Product** (USD10; no real item offered or fulfilled). Keep the existing source and campaign record selected:
   `pagnetic_review / qa_pouch_20260912 / two_pockets`, angle **Universal**, exact ad **“Two internal pockets separate cables and adapters.”**
3. Start on Overview and read the current state aloud or show it on screen. If it says `AUTOPILOT_PREPARATION_INACTIVE`, `QA unavailable`, `V2_PRODUCT_RUNTIME_ACK_REQUIRED`, `App uninstalled`, or another hold, record that truthfully and do not clear it. Do not enable a flag, activate a treatment, or claim a gate passed.

## Minimal current UI sequence (target 3–8 minutes)

### 1. Source and campaign configuration (about 60–90 seconds)

1. Open **Messages** and select the synthetic pouch. Show **Current source**, the diagnosis (if present), and the exact campaign fields/source-backed message. Expand **View exact sources**.
2. If the approved message card is present, show its immutable headline, benefits, evidence, and **Preview in context** link. The link is experience-specific; use the card’s generated link and do not hand-edit query parameters.
3. Do **not** click **Create campaign draft**, **Save supported edits**, or **Prepare adaptive package for review** when the intended campaign/package already exists. A duplicate draft or a new package can change the audited inputs and invalidate the approved receipt.
4. If no current approved package exists, stop for owner action: the owner must review the exact current product, campaign mapping, text, evidence and experiment question, then use the real package-review control once. Never approve a different or stale hash merely to continue filming.

### 2. Existing approval and theme boundary (about 45–60 seconds)

1. Show the package status and source/package hash in **Messages** or **Review test readiness**. If it is `APPROVED`, preserve it; do not re-approve. If it is `PENDING`/`READY_FOR_APPROVAL`, only the authorized owner may click **Approve this exact adaptive package** (or the current Overview **Approve and prepare test**) after checking the displayed evidence.
2. If Overview presents **Open theme editor**, use the actual Shopify top-level editor. Show the existing single Adaptive Panel configuration and native product selector. Do not add a duplicate block or save an unchanged theme. Return to Pagnetic and use **I saved it — verify now** only after a real Shopify save; otherwise show the unchanged/blocked state.
3. Keep the statement visible: the preview is merchant review evidence, not a live treatment, and a theme placement check does not prove performance or lift.

### 3. Isolated synthetic demo: start → visible result → stop (about 90–150 seconds)

1. Open the owner-only `/app/demo` route from the authenticated Pagnetic app. Show **Demo / synthetic test — not a live experiment**, the package status, and the fixed-store restriction.
2. If needed, click **Provision dedicated Astra demo operator** once. With the exact package `APPROVED` and operator provisioned, click **Start 15-minute synthetic demo**. Expected status: **Synthetic demo lease started. It expires automatically.**
3. Open the generated **Open isolated synthetic product demo** link. Do not invent a fallback URL or `pag_campaign` value. In Shopify’s native Cookie preferences, grant the required Personalization and Analytics purposes (Marketing may remain off) and save. Expected result: the labelled synthetic panel shows the approved pockets headline/bullets while native **Add to cart** and **Buy it now** remain present. If consent is denied/unknown, expected result is Original/no panel; record that instead.
4. Optionally add only the synthetic pouch to cart and open Shopify’s test checkout. Do not submit payment or create an order. Remove the item and show the cart empty.
5. Return to `/app/demo`, click **Stop synthetic demo**, and show **Synthetic demo lease stopped.** Re-open or refresh the generated product page. Expected result: `DEMO_STOPPED`/Original fallback with the adaptive panel absent and native product/cart controls intact. Do not describe this visible demo output as an experiment result.
6. Open **Results** only to show **No experiment yet** (or the exact current hold/result). Do not claim assignment, treatment, statistical maturity, performance PASS, revenue, or lift. Leave no demo lease active.

## Billing evidence (separate, about 30–60 seconds)

Use the prior real owned-store lifecycle evidence in [doc69](./69-shopify-billing-demo-remediation.md); do not repeat uninstall/reinstall or create a charge solely for this video. If a current screen is needed, open **Settings**, show Shopify-confirmed access through **October 12, 2026**, and open **View plans in Shopify** so it leaves the iframe for Shopify’s hosted plans page.

The prior evidence covers real development-store no-charge approval, decline/change-plan handling, uninstall/reinstall contract refresh and expiry/cancellation display. It does not authorize a new paid subscription. Show any current accept/decline control only if the owner explicitly requests it, and record the actual outcome; never imply that a redirect, catalog price, or stale local status is billing authority.

## Reviewer access and handoff

- The reviewer receives the final hosted English-captioned video URL and the Shopify Admin app entry point for the authorized test store. The owner must open the hosted URL after upload and verify playback, captions, and access before resubmitting.
- Include this runbook, doc77’s actual sequence, doc76’s isolated-demo QA boundaries, and doc69’s billing lifecycle proof as explanatory references. Keep local paths out of the Shopify response unless converted to accessible hosted evidence.
- State plainly that the clip supplements an existing-setup recording. It does not show fresh installation/onboarding creation unless those screens were actually captured, and it does not claim governed activation, adaptive treatment, mature results, or Shopify approval.

## Stop conditions

Stop and preserve the visible state if the store is not `test1-eczm2zce`, the synthetic product/campaign differs, the package hash changes, an owner-only action is required, the theme editor proposes a duplicate, consent is unavailable, the demo link is expired/stopped, or any UI reports a QA/runtime/billing hold. Report the exact visible message in the reviewer explanation rather than bypassing it.

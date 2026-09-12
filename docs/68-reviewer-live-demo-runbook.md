# Reviewer live demo runbook — Pagnetic (English)

Date: 2026-09-12  
Store: `test1-eczm2zce.myshopify.com`  
Recording target: about five minutes for the product flow, plus the required billing proof below.

## Recording contract

Use one continuous Chrome recording of the real Shopify embedded app and, if the gate is genuinely available, the real Online Store product page. Keep the browser URL visible during navigation. Speak in English. Do not splice still images, simulate results, edit the database, use internal qualification overrides, unlock flags, or turn a local test into live evidence.

Use only this low-risk fixture:

- **Pagnetic QA Travel Pouch - Synthetic Test Product**
- Shopify product GID: `gid://shopify/Product/10345426977074`
- Synthetic USD 10.00 product; no real item, fulfillment, customer demand, or lift evidence
- Keep its disclosure visible: “Synthetic development-store fixture for Pagnetic QA. No real item is offered or fulfilled.”

Opening narration: “This is a live Pagnetic walkthrough in an owned Shopify development store. I will show source-bound onboarding, campaign matching, approval, and safe storefront behavior. The product and traffic are synthetic, so I will not claim revenue lift.”

Before recording, open the installed Pagnetic app for the named store and confirm `/app` renders. Do not show credentials, tokens, Partner Dashboard, or another store. If authentication, preparation, or billing verification fails, show the actual error once, narrate it, and record that as a blocker.

## Main product flow — current four-tab embedded UI

### 1. Overview: current onboarding state

1. Start on **Overview**. Show the merchant headline, state badge, current product/“Your first opportunity,” timeline or next action, and the visible safety language that the original storefront remains unchanged until a bounded plan is approved.
2. If no plan exists, click the real **Prepare opportunity →** button. Wait for the actual response. The expected result is either a real **Recommended first product / READY_FOR_APPROVAL** opportunity or a visible preparation/qualification notice. Do not create a fictional opportunity if the synthetic product is not eligible.
3. If **READY_FOR_APPROVAL** appears, show the **Original** card, the proposed panel, each **View exact sources** disclosure, the test question text, and **What you authorize**. Only the owner may check the medium-risk acknowledgement and click **Approve and prepare test**. Expected result: the visible plan state advances; this action does not authorize billing or prove lift.
4. If Overview shows **Attention**, **blocked**, **waiting for evidence**, **VERIFYING**, or **Awaiting reviewed backend enablement**, leave it visible and narrate the exact gate. Do not click a disabled activation control or use a legacy cutover/override to make the recording progress.

### 2. Messages: source review and actual ad matching

1. Click the embedded **Messages** tab. Select **Pagnetic QA Travel Pouch - Synthetic Test Product** and click **Show messages**.
2. Show **Current source** beside **Diagnosis**. If there is no diagnosis, click the real **Find a message opportunity** button and wait. Expected result: a bounded diagnosis or a truthful abstention; diagnosis alone does not reach shoppers.
3. Show **Exact proposed message**, its headline/benefits, and open **View exact sources**. Do not invent or broaden the synthetic facts. If the owner changes copy, use only supported edits and show **Save supported edits** plus its real response.
4. Expand **Match this product to one campaign** and enter clearly synthetic values:
   - UTM source: `meta`
   - UTM campaign: `qa-travel-pouch-demo`
   - UTM content: `video-01`
   - Message angle: an angle actually offered by the app
   - Exact ad message: `Synthetic QA demo: keep small travel items organized in one pouch.`
   Click **Create campaign draft** and wait for the live response. Expected result: a reviewable mapping/evidence record; no ad account is connected and no ad is edited.
5. If an exact draft is present and the owner approves its displayed source/evidence, click **Approve this message**. Show the explicit note that message approval does not start a test or authorize billing.
6. If the page offers **Prepare adaptive package for review**, click it and wait. Show **Review before approving**, package/mapping snapshot hashes, exact supplied campaign promise, bundle text, protocol questions, and evidence trace. Click **Approve this exact adaptive package** only when the owner is approving that exact visible package. If coverage says mappings remain unsupported or status is not pending, narrate the state and stop this branch.

### 3. Preview and theme boundary

1. Click **Preview in context**. Show **Current catalog source**, **Proposed panel**, the live rendered text, and **Evidence trace / Exact statements**. This is a merchant preview, not live treatment or uplift evidence.
2. Return to **Overview**. If an approved plan exposes **Open theme editor →**, use that real button. In Shopify’s actual theme editor, add the Pagnetic Adaptive Panel to the product template and save only if the owner has approved the exact package. Return to Pagnetic and use its real verification action when offered.
3. Expected result is either an observed published-theme verification or a visible hold such as **Adaptive Panel not yet verified**, **BLOCKED**, pending authenticated QA, or Original fallback. Do not tick QA boxes, call an unpublished preview “published,” or claim activation when the app says it is blocked.

### 4. Real storefront test and safe result

1. Open the synthetic product’s real Online Store product page in a second live tab. Show the original description and native price, inventory, quantity, cart, and checkout controls. If consent UI is present, show the actual state without personal data.
2. Only if the app has shown a verified approved deployment and a campaign reference in the live package, use the generated link/reference supplied by the UI. Do not invent a `pag_campaign` URL or manually guess its encoding. If no generated reference or approved deployment is visible, show the original page and say **Original is active**.
3. Do not place a chargeable order. If the campaign is unknown, consent is denied, authority is stale, or the panel cannot load, the expected real safety result is Original with native purchase controls intact.

### 5. Results: truthful outcome

1. Click the embedded **Results** tab. Show the actual experiment list/state if present. Do not open operator-only measurement setup as a substitute for a merchant result.
2. If there is no frozen mature result, say: “No lift is claimed. The sample, minimum duration, financial reconciliation, and maturity rules are not complete.”
3. If a result exists, show scope, dates, denominator, uncertainty interval, financial completeness, and the app’s actual recommendation. Never call preliminary, incomplete, or synthetic-store data a win. A result is not payment authorization.

## Required separate billing proof — real Shopify flow

Billing is a separate proof segment, not an optional omission. It must use Shopify’s actual pricing page; no mocked acceptance, decline, expiry, or reinstall UI is valid. Real charges are out of scope.

1. Click **Settings**. Show the current subscription card, offer terms, and whether Shopify has supplied a provider-confirmed status/period end. If the button is present, click **View plans in Shopify**. Expected route: `/charges/adaptive-storefront/pricing_plans` for this store.
2. On the live Shopify page, show the configured **founding-beta** terms: USD 49 every 30 days with a 30-day trial; the authorized development store should show **Free to test**. Do not claim access from a redirect or charge ID; Pagnetic verifies with Shopify server-side.
3. Perform the authorized no-charge acceptance branch in the development store. Return to Pagnetic and click **Verify status with Shopify** if available. Expected result: a provider-confirmed subscription state and period end, or a truthful verification failure that retains safe entitlement.
4. Perform the real decline/cancel branch if Shopify presents it and the owner’s test window permits. Return to Pagnetic. Expected result: no charge and a pending/reapproval/canceled presentation; paid authority must not be silently retained.
5. Demonstrate reinstall/expiry only through the real Shopify uninstall/reinstall or provider-expiry flow under the owner’s maintenance window. Expected result: stale session/subscription invalidation, fresh embedded authentication, and no resurrection of entitlement without provider verification. If Shopify cannot produce this state safely in-session, say **not demonstrated in this recording**; never simulate it.

## Closing narration and current submission status

End on the current Overview or Results state: “Pagnetic showed the source-bound merchant workflow, campaign evidence, approval boundary, and Original fallback. This owned development-store recording does not claim real-merchant uplift or Shopify approval.”

The current Shopify submission status must be narrated from the live dashboard/owner-provided current state. Do not reuse a stale **In review** statement if the current feedback says **Action needed 1/3**. Approval, public availability, qualified real-merchant evidence, published-theme/checkout/consent/performance evidence, and uplift remain gates unless visibly verified in this session.

## Stop-and-report blockers

- Synthetic product absent, inactive, or changed from its disclosure: stop; do not substitute a real product.
- Preparation/qualification, package coverage, source evidence, approval, theme placement, consent, or authenticated QA is blocked: show the exact message and stop that branch.
- No verified approved deployment or generated campaign reference: show Original; do not invent a storefront URL or treatment.
- No mature reconciled result: report no lift; do not register legacy A/A flows merely for video progress.
- Shopify pricing, decline, expiry, or reinstall state is not available safely: report **not demonstrated**, not a simulated pass.

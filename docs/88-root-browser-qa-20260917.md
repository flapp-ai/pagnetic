# Root-reviewed test1 QA — September 17, 2026

## Verdict and scope

Five applicable browser checks pass in the bounded test1 synthetic fixture; Shop Pay is **NOT_APPLICABLE** on this store. Performance's technical diagnostics pass, but its combined field/capacity gate remains **PENDING**. No public rollout, payment, new order, serving-hold release, deployment, push or Shopify resubmission was performed.

Observations were collected approximately 06:13–06:24 UTC. Artifact review checkpoint: 2026-09-17T06:24:28Z. Browser: macOS Chrome, desktop 1728 px viewport and verified 390×844 responsive viewport; this is not physical iPhone/Safari or all-theme certification.

- APP_RELEASE: `402fe1b55566b865f9a84092746bf9bd1c7e5f15`
- Shop: `test1-eczm2zce.myshopify.com`
- Local product: `cmtpl078j0042q6m2tyug5g3t`; Shopify product10345426977074, variant51727716614450
- Canonical product: `/products/pagnetic-qa-travel-pouch-synthetic-test-product`
- Product price: USD10; quantity1; no real item/fulfillment
- Approved plan: `cmtzdcx1r00m1q6larwx71jys`, version2
- Cutover: `cmtzd7f0k007kq6lafgyydxtc`
- Published theme: `gid://shopify/OnlineStoreTheme/187666989362`
- Dedicated provisioned operator: `test1:operator:codex-astra`
- Approved package: `cmu0uast301fhq6lb6isxnwv0`
- Package hash: `670e19c0d955e707084b7e917e3e22a6ffbf953c0ea1845cde4be7d94bb36d24`

## Accepted browser checks

### mobile — APPLICABLE / PASS

Root inspected `mobile-demo.png` (390×2525 full-page pixels) and `mobile-original.png` (390×2264). Native title, USD10 price, Add to cart and Buy it now are visible, wrapped sensibly and unobstructed. No clipping/overlap/horizontal overflow was observed in these screenshots. The approved panel appears below native description and purchase controls in the demo and is absent on the canonical held product. Native mobile Add to cart and cart Checkout were actually operated. This is Chrome responsive evidence only. Initial canonical reason was not yet assigned when first read; later held-state inspection confirmed `KILL_SWITCH_ACTIVE` with hidden panel.

### desktop — APPLICABLE / PASS

Root inspected `desktop-original.png` and `desktop-demo.png` at1728px width. Native price and purchase controls remain intact; approved, explicitly labelled synthetic panel appears below the description, not over purchase controls. Initial normal product inspection: hidden=true, reason=`KILL_SWITCH_ACTIVE`, document width=viewport width=1728, hidden-panel geometry zero. Product has one variant; no multi-variant selector coverage is claimed.

### standard_checkout — APPLICABLE / PASS

On the **canonical product without a demo marker**, Add to cart opened the native cart drawer. It contained exactly one synthetic pouch, variant51727716614450, quantity1, price/subtotal USD10. Native Check out entered Shopify checkout with contact, delivery, shipping, test-card payment instructions and Pay now USD10. Captures: `mobile-canonical-cart.png`, `mobile-canonical-standard-checkout.png`. A separate demo-path run reached the same checkout, including desktop capture. No contact/shipping/card information was entered, no Pay/submit was clicked, and no order was created. This certifies unobstructed cart-to-checkout navigation, **not** paid-order attribution, checkout completion or fulfillment. The one added test cart item was removed and empty cart verified.

### accelerated_checkout — APPLICABLE / PASS

After emptying the cart, the **canonical product** native Buy it now entered Shopify checkout. Order summary retained one synthetic pouch, quantity1, USD10 total; native test-card checkout remained available. Capture: `desktop-canonical-accelerated-checkout.png`. This is the store's direct-buy route, not wallet/Shop Pay certification. No payment/order was submitted. Direct-buy checkout did not leave a persisted cart item; empty cart was verified afterward.

### shop_pay — NOT_APPLICABLE

Canonical Shopify Admin Settings → Payments showed Test payment gateway and Shopify Payments **Complete setup**, with the development-store test-payment notice. Current native checkouts offered test-card payment and no Shop Pay button/option. `shop-pay-provider-capability.png` preserves the actual provider state; checkout captures supply the second observation. This N/A is **test1/current configuration only**, not a product-wide statement. If the merchant enables Shop Pay, this check must be recaptured as applicable.

### consent_flows — APPLICABLE / PASS

Only native Shopify cookie/privacy controls were used; no injected consent APIs, cookie edits or storage edits.

1. Initial native preferences: Required, Personalization and Analytics checked; Marketing off.
2. Decline all: hidden panel, `DEMO_CONSENT_REQUIRED`; denied reload stayed hidden.
3. Personalization only, Analytics/Marketing off: still hidden, `DEMO_CONSENT_REQUIRED`.
4. Add Analytics with Marketing off: immediate snapshot was still asynchronous/pending, failure-code null; after granted reload the approved article became visible, `DEMO_ACTIVE`.
5. Revoke Personalization with Analytics still on: hidden, `DEMO_CONSENT_REQUIRED`.
6. Re-grant Personalization without reload: waited for visible approved article, `DEMO_ACTIVE`, failure-code null.
7. Decline all and reload again: hidden, `DEMO_CONSENT_REQUIRED`, failure-code null.
8. Accept all without reload: waited for visible approved article, `DEMO_ACTIVE`, failure-code null. Accept-all reload retained the visible demo.
9. On the canonical product after demo stop: native Decline all hid the panel with `consent_denied`; restoring Personalization+Analytics with Marketing off and reloading retained hidden Original under `KILL_SWITCH_ACTIVE`, failure-code null.

No `runtime_failure_safe` occurred in this fresh ordered run. The prior run's uncaptured first late-grant failure remains historical evidence; this rerun does not erase it. The transient file named `consent-late-granted.png` shows an in-flight state and is **excluded** from accepted proof. Genuine late-grant success is `consent-regranted.png` and `consent-accept-all-late-grant.png`, each after waiting for the article to become visible.

Focused automated privacy/demo/panel/cutover tests passed62/62; these provide identity/decision/checkout suppression and revocation-race coverage. The root browser pass did **not** independently collect a delivery/network/paid-attribution trace; demo deliberately suppresses measurement. Thus no live identity/attribution claim is inferred from seeing demo content.

## Cleanup and automation limitations

The fresh15-minute isolated synthetic lease was stopped through the real app UI. Visiting that stopped link returned hidden Original with `DEMO_STOPPED`. Canonical held-state remained `KILL_SWITCH_ACTIVE`; cart is empty; Marketing consent restored off. Temporary viewport overrides were reset. No signed demo URL, checkout/session identifier, cookie, shopper PII or credential is included in approved artifacts.

Locator evaluation intermittently timed out despite valid DOM; root used native interactions, getAttribute, visible article waits and actual screenshots instead. Later viewport override attempts did not apply to the captured storefront: files named `mobile-original-final.png`, `mobile-original-verified.png`, `mobile-original-correct-target.png` are1728px wide, **not mobile proof**, and excluded. Accepted mobile files were independently dimension-checked at390px. Checkout loading produced transient detached-selector/loading snapshots; refreshed native DOM and actual completed navigation, not those attempts, determine the result.

## Performance and remaining decision

See `85-performance-qa-20260917.md`: assets/core3/3 pass; isolated mixed load1,440 decisions plus360 webhooks and180 reports in61.470s, zero errors, decision p95=12.222ms, deadline faults4/4 return Original at1500ms. A25× local SQLite burst saturated with errors and is retained as a local fixture boundary, not concealed or certified as production behavior.

Still absent: supported device/geography/browser request-to-decision/render and LCP/INP/CLS distributions, accepted partner traffic forecast and cohort cap, real Fly/app-proxy/DB/worker capacity and waits. No formal performance PASS receipt is authorized. Do not weaken or silently split the frozen gate. Smallest explicit owner decision would distinguish completed technical QA from field/capacity validation while retaining the serving hold until field/capacity passes.

## Receipt handoff

Six accepted check artifacts are private archives containing this reviewed report plus only their relevant reviewed screenshots, each at most5MiB. Root approves those exact generated bytes after hashing for official receipt recording by the provisioned operator. Sol may store them privately at `/data/qa-artifacts/<sha256>`, independently compare stored SHA256, then use the existing recorder. No direct QA table edits, performance PASS, activation or resubmission is authorized. Receipt IDs and live progress must be appended after persistence; this report alone is not a receipt.

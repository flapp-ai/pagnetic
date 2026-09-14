# Test1 QA evidence checkpoint — 2026-09-13

Status: PARTIAL; no baseline activation, treatment serving, public rollout or Shopify resubmission.

## Frozen scope

- Shop: `test1-eczm2zce.myshopify.com` only.
- Release: `4acebb80ad7a87eb52fd90c0aef31d3321294fb2`, Fly release48/image `deployment-01M2DMABXYGM6ZHEYRDMJ4Q2RW`.
- Product: `cmtpl078j0042q6m2tyug5g3t`, Shopify `10345426977074`, synthetic QA pouch, USD10. No real item/fulfillment.
- Plan: `cmtzdcx1r00m1q6larwx71jys`, state VERIFYING; fresh owner approval preserved.
- Recovery receipt: `cmtzd7f0k007kq6lafgyydxtc`.
- Published theme: `187666989362`, default product template (`templateSuffix=null`).

## Authenticated checks already accepted

The actual Overview **I saved it — verify now** action returned **Published theme verified** after a real current-release product load. No unsaved theme was published. Existing panel placement was inspected in Shopify's Active theme; the synthetic product was selected through the real preview selector. The add-block deep link briefly proposed a duplicate; root undid exactly that unsaved addition and verified one panel/Save disabled.

| Check | Receipt | Result |
| --- | --- | --- |
| placement | `cmtzy2epf0022q6lbbxdgthws` | PASS/APPLICABLE, STOREFRONT_RUNTIME |
| original_fallback | `cmtzy2epf0024q6lbjqmt6796` | PASS/APPLICABLE, STOREFRONT_RUNTIME |

Both receipts match the current release, recovery receipt, product, theme and genuine storefront event. Active experiments0; active deployments0; exact recovery hold remains ON.

## Captured observations awaiting formal artifact review/registration

| Check | Actual observation | Limit |
| --- | --- | --- |
| desktop | Chrome1728x804: Original text, USD10, Add to cart/Buy it now unobstructed; no horizontal overflow; exactly one hidden panel, reason KILL_SWITCH_ACTIVE, measured=false, no deployment | Original-only compatibility; not treatment/lift or performance certification |
| mobile | Chrome responsive390x844: readable title/source text and native purchase controls; no horizontal overflow; temporary viewport reset | Responsive browser evidence, not physical-device validation |
| standard_checkout | Final-release Add to cart produced exactly one pouch/USD10; Check out reached native Contact/Delivery/Shipping/Payment/Finalize order with visible Test Payment Gateway and Pay now USD10 | No order/payment was submitted; does not prove paid-order attribution |
| accelerated_checkout | Product Buy it now reached native checkout for the same pouch/USD10 and Test Payment Gateway | Unbranded direct-buy path only; no wallet/payment completion |
| shop_pay | Actual Payments settings show Test payment gateway and Shopify Payments **Complete setup**; checkout has no Shop Pay option | Candidate NOT_APPLICABLE for this configured development store, not a claim that Pagnetic supports or rejects Shop Pay elsewhere |

Unmodified screenshots are retained locally in `tmp/qa-evidence-20260913/` (ignored, not public/GitHub-hosted):

- `desktop-original-release48.png`, SHA256 `3d1756262fa1ae62dd45e5a34071fc076bc40efbea50f822e6ab132b5d9072c9`.
- `mobile-original-release48.png`, SHA256 `401a3aea8805e5b6da0730409ee3a11f393de5fe09a8471952045321c6f1154c`.
- `standard-cart-release48.png`, genuine one-item native cart capture.

These are observations/draft artifacts, not seven accepted QA receipts. No private-bucket upload or owner/operator artifact-acceptance command has been run. Review the exact artifacts, retain their honest limits, upload approved bytes privately, then use the existing authenticated recorder under the actual authorized actor. Do not infer acceptance from a screenshot filename or this checklist.

## Unresolved substantive checks

- **Consent:** owner subsequently approved enabling test1's banner, including US visitors. Configuration and real native interaction evidence are recorded below. One initial late-grant runtime failure remains unexplained; the consent artifact is not formally accepted.
- **Performance:** PRD24 section13.2 requires representative before/after LCP/INP/CLS, decision deadlines, device/geography evidence and twice-forecast mixed-load validation. A tiny synthetic run or layout screenshot cannot close these gates. No performance PASS, arbitrary capacity claim or baseline activation was fabricated.

All seven manual QA keys remain unaccepted. Keep the recovery hold and Original serving until the required evidence is reviewed. A test-only change to acceptance requirements would be a separate explicit product decision, not permission implied by today's draft/QA approval. The final end-to-end demo and Shopify resubmission remain pending.

## Owner-approved native consent QA continuation — 2026-09-13

Changed only test1 Customer privacy > Cookie banner. Disabled automated regional selection and saved explicit regions. Initial selection retained 31 European entries and added all 51 US entries; the banner did not initially appear on the normal product. To remove test-session geography ambiguity, selected all six continent groups, verified **299/299 entries**, clicked Done and Save. Saved admin summary shows Afghanistan, Åland Islands and 235 other country groups, automated settings off and no unsaved controls. Checkout banner setting was left unchanged/off. No other store, theme, billing, runtime flag or hold was changed.

Shopify-generated preview displayed a banner, but its initial Decline did not establish denied behavior on the normal product. That preview interaction is excluded from consent evidence. Subsequently the native policies/preferences page and **normal product URL without preview parameters** both displayed the real banner and footer Cookie preferences control.

| Ordered native interaction | Actual DOM-backed result |
| --- | --- |
| Normal product before new choice | Panel hidden, `consent_denied`, `measured=false`; banner visible. This is pre-choice UI evidence, not proof that the Customer Privacy API was unavailable. |
| Decline | Banner dismissed; panel hidden, `consent_denied`, unmeasured, no deployment. |
| Cookie preferences: Personalization only, Save my choices | Still hidden/denied/unmeasured. |
| Same-page enable Analytics too, marketing off, Save my choices | First attempt hidden `runtime_failure_safe`, unmeasured. Failure-code attribute was not captured at that moment; cause is unconfirmed. |
| Reopen preferences | Native checkboxes confirmed Personalization=1, Analytics=1, Marketing=0. |
| Decline all, then reload | `consent_denied` both immediately and after reload, hidden/unmeasured. |
| Same-page Accept all, then reload | Both returned expected `KILL_SWITCH_ACTIVE`, hidden/unmeasured under the retained recovery hold. |
| Repeat exact Personalization-only -> add Analytics transition | Returned expected `KILL_SWITCH_ACTIVE`, failure code absent, deployment empty, hidden/unmeasured. |
| Revoke only Personalization, leaving Analytics enabled | Returned `consent_denied`, failure code absent, hidden/unmeasured. |
| Final Decline all and reload | Left browser denied: `consent_denied`, failure code absent, hidden/unmeasured. |

All actions used native Shopify banner/preferences controls. No injected privacy APIs, cookies/storage edits, fabricated events, orders or baseline activation. Screenshots alone cannot show hidden runtime attributes; table values came from contemporaneous read-only DOM inspection. No storage/identity-clearing or server/pixel-delivery assertion is inferred from these screenshots.

Additional unmodified local artifacts in the same ignored directory:

- `consent-banner-settings-all-regions.png` — saved admin regional configuration.
- `consent-before-choice-release48.png`, SHA256 `b9b24acc7b71aaad39ed558ab1b6a6559408d1325529e3476a4116dd516d01f9`.
- `consent-declined-release48.png`, SHA256 `3d1756262fa1ae62dd45e5a34071fc076bc40efbea50f822e6ab132b5d9072c9`.
- `consent-granted-held-release48.png` — captured during the FIRST failed late grant; filename does not establish successful hold response.
- `consent-granted-retry-release48.png` and `consent-revoked-release48.png` — visually identical Original-page screenshots to the preceding file; all three SHA256 `ba1e0a3f37505629faffabeded630d5f87272f4567e726276308feaef073edf6`. Their distinct runtime observations are in the table, not visible in the pixels.
- `consent-reload-denied-release48.png`, SHA256 `6b1f3c1a58daf035a774e58bdd1be7c44707759544c9274d9fb0b455844ad355`.

Sol performed one bounded read-only source diagnosis. A consent-state race or transient request failure remains possible, but neither is established without the first failure code. If reproduced, capture `data-adaptive-failure-code` immediately and distinguish consent, timeout, HTTP, response-validation and network causes before changing code. Successful retries do not erase the first failure. No code fix, deploy, formal consent PASS or QA-recorder submission occurred in this continuation.

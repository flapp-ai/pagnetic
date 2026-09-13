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

- **Consent:** current US storefront did not expose a consent banner. Denied/unknown, allowed/late-grant and revoke must be exercised through Shopify's real consent mechanism. Owner was asked for permission to enable the banner on test1 including US visitors; no answer received and no privacy settings changed at this checkpoint. An allowed Original decision alone is not a consent-flow pass.
- **Performance:** PRD24 section13.2 requires representative before/after LCP/INP/CLS, decision deadlines, device/geography evidence and twice-forecast mixed-load validation. A tiny synthetic run or layout screenshot cannot close these gates. No performance PASS, arbitrary capacity claim or baseline activation was fabricated.

All seven manual QA keys remain unaccepted. Keep the recovery hold and Original serving until the required evidence is reviewed. A test-only change to acceptance requirements would be a separate explicit product decision, not permission implied by today's draft/QA approval. The final end-to-end demo and Shopify resubmission remain pending.

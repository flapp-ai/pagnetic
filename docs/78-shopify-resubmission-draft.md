# Shopify resubmission response — DRAFT

**Owner approval required before Shopify resubmission.** Final media and public hosting are root-verified in [doc83](./83-reviewer-media-deployment-20260916.md). Authenticated submission-field updates and postdeployment current-release verification await restoration of the Shopify session. Final Shopify submission remains owner-gated.

Date: 2026-09-16  
App: Pagnetic  
Store used for controlled evidence: `test1-eczm2zce.myshopify.com`

## Proposed reviewer response

Hello Shopify review team,

We prepared a fresh, Pagnetic-only recording in an owned Shopify development store using a clearly disclosed synthetic product. The recording shows the real embedded merchant UI and the real storefront, including:

- the synthetic product and an identical existing campaign mapping submitted through the real UI, persisting draft version 5 (`cmu4bsw3s03qrq6lam4kzys41`);
- the exact source review and evidence expansion for the approved message, while the approved package remains unchanged (`cmu0uast301fhq6lb6isxnwv0`, hash prefix `670e19…`);
- desktop and mobile merchant previews of the same selected experience;
- the actual Shopify theme editor showing the Adaptive Panel configuration (no theme save was needed because the configuration was unchanged);
- a fresh 15-minute synthetic demo start, native consent deny/grant, labelled live panel, native Add to cart, test checkout with empty fields and no payment, item removal/empty cart, stop receipt and panel-hidden `DEMO_STOPPED` result;
- Results showing **No experiment yet**, with no lift or monetary result claimed;
- Settings showing Shopify-confirmed access through October 12, 2026 and top-level navigation to Shopify’s hosted plans page.

The campaign mapping shown is the existing mapping reused without creating a second mapping:

`pagnetic_review / qa_pouch_20260912 / two_pockets` · Universal  
Exact supplied ad message: “Two internal pockets separate cables and adapters.”

The recording shows the real campaign form submission and persisted draft version 5; it does not create a duplicate campaign. The video demonstrates merchant configuration, previews and controlled synthetic demo behavior, not a live customer experiment. Native purchase controls remain Shopify-owned, and no payment or real order was made.

The billing/navigation correction is also covered by prior real owned-store reinstall evidence: the hosted Shopify plans page opens top-level, the development store’s free-test terms are visible, and Pagnetic displays the provider-confirmed expiry rather than treating a redirect or charge ID as authority.

We have not represented the following as complete: fresh installation/reinstallation in this clip, a theme save (the existing block was inspected unchanged), governed activation, adaptive treatment, a mature experiment, or revenue uplift. Before capture, current-release verification showed placement/Original fallback accepted, while seven QA checks remain pending and the storefront hold remains ON. No activation or lift is claimed.

The root-reviewed local MP4 is 267.8 seconds (about 4:28), SHA-256 `cc9ec3c98187a9919a6fde6b2f44c5f6dc613b0c7c7511a1ab4d3eba5a3a6fd9`, composed of two real tab-captured segments with English burnt-in captions and no audio. Hosting access verification is recorded separately. This response and recording do not claim Shopify approval or public availability.

Thank you,

Pagnetic team

## Proof references (verify before submission)

- Local final media: `/Users/erenyigit/pagnetic-review-KqNpQ9/tmp/reviewer-20260916/pagnetic-shopify-review-20260916.mp4` (do not submit a local path).
- Public viewing copy, operator-verified: [English-captioned demo](https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review-20260916.mp4).
- Recording source commit: `216a74c`.
- Current sequence and limitations: [doc81](./81-reviewer-recording-20260916.md) and [doc82](./82-reviewer-instructions-20260916.md). [Doc77](./77-reviewer-recording-20260914.md) is the historical partial September 14 recording, not the final September 16 clip.
- Isolated demo implementation/QA and prior reinstall billing evidence: [docs/76-test1-demo-implementation-qa.md](./76-test1-demo-implementation-qa.md) and [docs/69-shopify-billing-demo-remediation.md](./69-shopify-billing-demo-remediation.md).

## Acceptance gaps before claiming the finding resolved

1. Hosted playback/hash verification is complete in doc83. Restore the authenticated Shopify session, repeat current-release verification after asset-only deployment and save the new URL/instructions to the real submission fields.
2. Keep the seven pending QA checks and storefront hold explicit: mobile, desktop, standard checkout, accelerated checkout, Shop Pay, consent and performance. No v2 flag, experiment activation, treatment, or lift claim is authorized by this draft.
3. The Shopify Partner submission fields still require the normal OTP-authorized owner action; do not invent or prefill submission state. Owner approval is required for the final submit.
4. After submission, verify the live Shopify feedback state and receipt directly. Do not claim a 100% review pass or Shopify approval from local media, hosting, or a submission receipt.

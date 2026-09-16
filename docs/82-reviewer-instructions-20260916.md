# Shopify reviewer instructions and response template

**Draft for final submission QA.** Root-reviewed final media is 267.8 seconds (~4:28), with two real tab-captured segments, English burnt-in captions and no audio; SHA-256 is `cc9ec3c98187a9919a6fde6b2f44c5f6dc613b0c7c7511a1ab4d3eba5a3a6fd9`. Hosting/operator URL verification is recorded in [doc83](./83-reviewer-media-deployment-20260916.md). Only final Shopify submission requires fresh owner approval.

## Legitimate reviewer access

The controlled demonstration uses only the authorized Shopify development store `test1-eczm2zce.myshopify.com` and the disclosed synthetic product **Pagnetic QA Travel Pouch - Synthetic Test Product**. A private test-store Admin session is operator access; it is not, by itself, reviewer access. The hosted video is supplementary evidence, not a substitute for legitimate, reproducible reviewer access to the core feature set.

Live inspection must use Shopify’s normal review or authorized test-store access process for the submitted app and store. No new access, passwords/tokens or signed `pagnetic_demo` URLs may be created/shared without the required specific authorization. Operator verification of the hosted video does not establish reviewer access. Confirm the Shopify app entry point and permitted reviewer testing path before resubmission.

For an ordinary merchant path, the reviewer launches Pagnetic from Shopify Admin after installing the app on an authorized store, completes the visible product/source selection and campaign mapping, reviews exact evidence, and uses the current approval control only for the displayed package. The controlled `/app/demo` route is owner-only and fixed to `test1`; it is a synthetic QA demonstration, not a normal-shop activation path.

### Ordinary-store path: source-derived, not freshly browser-verified

An arbitrary reviewer store is not enabled for the current v2 cutover by Fly configuration. It can use legacy core configuration/runtime; do not promise that our test1-only v2 synthetic demo is available on that store. Legacy `/storefront/experience` universal/matched serving checks active product, active angle/mapping, validated source-backed approved experience and no kill switch. Unlike registered experiment activation, this unmeasured core rendering does not require A/A, a performance receipt or an active pixel at request time. Source pointers: `app/services/runtime.server.ts:286-407`, `app/services/activation.server.ts:132-165`, `storefront/adaptive-panel.js:282-430`.

Proposed reproducible instructions, to verify against the actual submitted testing fields and a legitimate installation before describing as accepted:

1. Install/launch from Shopify Admin and sync the catalog; select an actually active product.
2. Review its current source and create the exact campaign mapping/ad promise. Review evidence and approve the displayed source-backed message; package review is separate.
3. Use the actual top-level Shopify theme editor. Add one Adaptive Panel to the intended product template only if missing, choose the intended product/policy and save deliberate changes. An unmeasured Universal/Matched demonstration and an Autopilot experiment are different paths.
4. For Matched, use a URL with the exact saved UTM source/campaign/content; use native Personalization/Analytics consent. Observe approved content and native purchase controls. If a hold or missing authority keeps Original, report it; do not invent a pass or bypass the hold.
5. Test consent withdrawal, native cart/checkout and safe Original fallback. Registered experimentation/measurement still requires its own qualification, all nine manual QA keys and A/A/registration gates. The seven pending checks shown in our video are nine total keys minus accepted placement/Original fallback, not a seven-key QA matrix.

This source trace establishes that ordinary legacy rendering is possible, not that a fresh reviewer installation has been proven. Session expiry currently prevents fresh authenticated postdeploy testing and confirmation of the submitted reviewer access/instructions. Shopify requires reviewers to be able to set up/test core features and, where needed, have functional testing access: [requirements 4.5.3–4.5.5](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements#ensure-your-submission-is-complete-and-accurate).

## Capture completion sequence

1. **Onboarding/configuration.** In the authenticated Pagnetic UI, select the synthetic pouch and show Current source, diagnosis, and the exact campaign mapping: `pagnetic_review / qa_pouch_20260912 / two_pockets`, **Universal**, and “Two internal pockets separate cables and adapters.” Expand exact sources. The capture shows the real identical campaign form submission persisting draft version 5 (`cmu4bsw3s03qrq6lam4kzys41`, displayed content hash) while reusing the existing mapping; do not create a second mapping.
2. **Approval authority.** Show the current package status and hash. If already `APPROVED`, leave it unchanged. If it is pending, only the authorized owner reviews and approves the exact displayed package; never approve a stale or different hash to make the recording progress. A message draft approval and package approval are separate actions.
3. **Theme/configuration.** Inspect the existing Adaptive Panel in Shopify’s real top-level theme editor and the native product selector. Do not add a duplicate block. Save only a deliberate changed configuration; if unchanged, show that no save was needed. If Overview reports a hold or missing QA/runtime acknowledgement, show the exact message and retain the hold.
4. **Controlled core-function proof.** On owner-only `/app/demo`, show **Demo / synthetic test — not a live experiment**, package status, and operator status. With the exact package approved and operator provisioned, start the 15-minute synthetic demo using the real button. Open only the generated product link. Show native consent denied then granted; with Personalization and Analytics granted, show the labelled approved panel and intact Shopify Add to cart/Buy it now controls. If consent is unavailable, show the expected Original/no-panel result.
5. **Native commerce and stop.** Optionally add only the synthetic pouch, open Shopify test checkout, enter no payment and submit no order, then remove the item and show an empty cart. Stop the demo in Pagnetic and refresh the generated page; show the stop confirmation and Original/panel-hidden result. Leave no lease active.
6. **Results and limitations.** Open Results and show the exact current state (expected **No experiment yet** for this isolated demo). State that this proves controlled UI behavior only—not activation, customer treatment, statistical maturity, performance, revenue, or lift. Current-release verification passing does not mean the remaining seven QA checks are passed.
7. **Billing evidence.** Show Settings’ provider-confirmed access boundary (currently October 12, 2026), then Shopify’s loaded Free Test/Founding Beta top-level plans page if needed. Reuse the prior real accept/decline/reinstall/expiry evidence in doc69; the main capture does not repeat uninstall/reinstall or create a charge.

## Concise response template

Hello Shopify review team,

Pagnetic’s attached 267.8-second English-captioned recording (two real tab-captured segments, no audio) shows the real embedded merchant UI and Shopify storefront in an owned development store using a clearly disclosed synthetic product. It shows product/source review, the persisted version-5 campaign draft, exact source evidence, the unchanged approved package, desktop/mobile previews, existing Shopify theme placement, and a controlled synthetic demo with consent deny/grant, native cart/test-checkout navigation without payment, cleanup, and the stop flow returning to Original. Results are shown truthfully; no experiment, treatment, performance result, revenue uplift, or public rollout is claimed.

The campaign mapping shown is `pagnetic_review / qa_pouch_20260912 / two_pockets`, Universal, with the exact ad promise “Two internal pockets separate cables and adapters.” The existing mapping was reused; no duplicate mapping was created. The controlled demo is restricted to `test1-eczm2zce.myshopify.com`, is labelled **Demo / synthetic test — not a live experiment**, and does not clear Pagnetic’s safety or measurement holds.

Billing evidence is supplied separately from the prior real owned-store lifecycle proof: Shopify-hosted plans navigation, no-charge development-store handling, decline/change-plan behavior, reinstall contract refresh, and provider-confirmed expiry. No new paid charge was created for this submission.

We have not represented fresh installation/reinstallation, governed activation, adaptive treatment, mature experiment results, or Shopify approval as complete. Recording-release placement/Original fallback verification passed, but seven QA checks remain pending and the storefront hold remains ON. Hosted proof access and the actual Shopify submission receipt must be verified before any completion claim.

Thank you,

Pagnetic team

## Attach only after verification

- Public video URL: [English-captioned demo](https://pagnetic.fly.dev/reviewer-6f2c9b31/pagnetic-shopify-review-20260916.mp4) — operator independently verified browser playback and public hash in doc83. Final submission remains owner-gated.
- Local media SHA-256: `cc9ec3c98187a9919a6fde6b2f44c5f6dc613b0c7c7511a1ab4d3eba5a3a6fd9`.
- Caption file or embedded captions, checked against the final rendered video.
- Links to [doc69 billing evidence](./69-shopify-billing-demo-remediation.md), [doc76 controlled-demo QA](./76-test1-demo-implementation-qa.md), [doc81 final recording facts](./81-reviewer-recording-20260916.md), and [doc83 hosting proof](./83-reviewer-media-deployment-20260916.md). Doc77 is the older partial recording.
- Exact current release/package/source identifiers visible in the final capture; source commit `216a74c`, approved package `cmu0uast301fhq6lb6isxnwv0` / hash prefix `670e19…`. Do not replace them with historical hashes or stale UI state.
- Do not claim 100% review completion. Shopify Partner submission fields remain pending the normal OTP-authorized owner action; final submit is owner-gated.

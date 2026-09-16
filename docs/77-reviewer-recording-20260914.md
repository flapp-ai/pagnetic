# Sep 14 reviewer walkthrough — actual media and remaining gaps

Historical recording. The final September 16 replacement and genuine persisted configuration/start/consent/stop sequence are in [doc81](./81-reviewer-recording-20260916.md); hosting is in [doc83](./83-reviewer-media-deployment-20260916.md). Do not use this older clip as the final submission artifact.

Date: 2026-09-14. Status: recorded, captioned, full decode checked; **not uploaded or submitted**. Owner must approve the final submission package. This is not a claim that Shopify's end-to-end onboarding finding is resolved.

## Viewable files

- English-captioned viewing copy: `/Users/erenyigit/pagnetic-review-KqNpQ9/tmp/reviewer-20260914/pagnetic-review-english.mp4`
- Lossless source remux: `/Users/erenyigit/pagnetic-review-KqNpQ9/tmp/reviewer-20260914/pagnetic-review-lossless.webm`
- Original download: `/Users/erenyigit/Downloads/pagnetic-review-2026-09-14T16-25-39-736Z.webm`
- Caption source: `/Users/erenyigit/pagnetic-review-KqNpQ9/tmp/reviewer-20260914/pagnetic-review.en.vtt`

These are local paths, not reviewer-accessible hosted URLs. Preserve the source master. The older Sep 13 recording is a different, partial artifact.

The actual selected Chrome tab alone was recorded. No audio, unrelated tabs, payment details or owner credentials were recorded. No real purchase was made. The synthetic demo link was stopped after filming; do not extract or reuse signed links from footage.

## Technical verification

Original size: 6,316,718 bytes. Source remux duration: 347.678 seconds; all 1,365 source frames decode successfully. Source viewport dimensions change during recording. The MP4 viewing copy scales/letterboxes to 1920×1120, adds English captions in the lower margin and holds frames at 10 fps; it does not invent actions or screens. It is 347.70 seconds and all 3,477 frames decode successfully. There is no audio track.

SHA-256:

```text
Original: 97941214be3af477ccc1ace912e76013bdb7f79bb91621e821cadcde8cd0cfe6
Remux: e6a47f3df22806d852fe598bd44947427969c96e9f3ed6f16b2a66a317ebb4b6
English MP4: 62135f1343cb929043c81d25fabc0f33e46618578b9d3b409681cf0a65740cf4
```

Root inspected source stills every 15 seconds from 0 through 345 seconds and a rendered caption still. This is sampled visual QA plus complete decode, not a claim of continuous human playback. A diagnostic tiled storyboard was discarded as a timeline authority because source-resolution changes reinitialized that filter. Temporary intermediate `pagnetic-review-captioned.mp4` is superseded; use `pagnetic-review-english.mp4` only.

## Actual recorded flow

1. Overview: existing verification state; Original retained; QA-unavailable message visible.
2. Messages: select synthetic pouch, display existing campaign fields/source evidence. No new campaign is saved.
3. Desktop and Mobile merchant previews. These are not measured treatments.
4. Actual theme editor: existing single Adaptive Panel inspected, Autopilot runtime policy. No add/remove/change/save.
5. Isolated demo: current package APPROVED and a previously active link opened. This recording does not show starting that session.
6. Native consent: Personalization and Analytics granted, Marketing off; actual labelled synthetic panel becomes visible with the approved pockets text.
7. One synthetic pouch added to native cart; test checkout opened with empty customer fields. No payment submitted. Cart item removed and empty cart confirmed.
8. Stop synthetic demo in app; stopped link shows Original with panel hidden. Read-only DOM confirmed `DEMO_STOPPED`.
9. Results: No experiment yet; no uplift claimed.
10. Settings: Shopify-confirmed plan expiry October 12, 2026; View plans opens Shopify-hosted plans top-level, with free development-store terms visible. No charge approved.

Prior exact package/operator approval and consent-revocation QA are in [doc76](./76-test1-demo-implementation-qa.md). Prior actual reinstall billing footage is in [doc69](./69-shopify-billing-demo-remediation.md). Those events are not falsely attributed to this clip.

## Outstanding acceptance work

- This clip does not demonstrate fresh install, persisted campaign creation/package approval, a fresh demo start, production activation or mature results. Supplement the missing setup steps before treating the end-to-end reviewer finding as fully addressed.
- The QA-unavailable message was diagnosed after filming: deployed release49 had empty `APP_RELEASE`, causing `V2_QA_APP_RELEASE_REQUIRED`. This was repaired in release51 as recorded below. Do not pretend this older footage depicts the later repair.
- Population-grade performance and other production gates remain unaccepted. No synthetic demo evidence may clear them.
- Complete final media review, host an accessible proof link, verify access, and present the exact final package for owner approval **before** Shopify resubmission. Draft response: [doc78](./78-shopify-resubmission-draft.md).

No Shopify submission, public rollout, GitHub push or production experiment activation occurred during this recording work.

## Post-recording release-ID repair

Sol implemented Docker ARG/ENV binding to an immutable full source SHA and a deploy wrapper that rejects relevant staged, unstaged and untracked runtime changes; the four focused stub cases passed. Source `216a74cfe1e762ff6cffbb085e1bdaa0d243d53e` deployed as Fly release51, image `registry.fly.io/pagnetic:deployment-01M2GCJ7WTF71TKA4WKZKCFP5D`. A predeployment encrypted backup was verified by isolated restore in1713ms. Runtime returned the exact release identifier; health and machine checks passed. Test1 kill switch remained ON, plan VERIFYING, active experiments/deployments0/0.

Root reloaded the real embedded app after deployment: the unavailable error disappeared and the actual list displayed **9 authenticated QA checks remain**. The UI explicitly requested current-release recapture. This is live confirmation of the loading fix, not acceptance of those nine checks. Root invoked the normal **Verify current release now** control: `V2_PRODUCT_RUNTIME_ACK_REQUIRED`. After visiting the canonical synthetic product URL without demo parameters and observing Original/native purchase controls, one retry returned the same missing-ack result. No evidence was fabricated, no hold cleared, and no further unchanged retries were made. Sol is checking the exact missing bridge/consent/demo-marker precondition separately.

Follow-up: root opened the actual native consent dialog; Personalization and Analytics were already checked and Marketing unchecked. Read-only canonical panel DOM returned hidden=true, reason=`KILL_SWITCH_ACTIVE`. Thus declined consent is disproved; an earlier delegated historical-consent diagnosis was rejected, not applied. Current Liquid and pixel source implement a 30-minute `pagnetic:v2:demo-mode` session/local storage marker suppressing measurement even after canonical navigation. This is consistent with the observed missing bridge acknowledgement during the isolation window; marker expiry was not read from browser storage. At16:46:55UTC the window following the stopped-demo page around16:24UTC had not yet elapsed. Retry after16:56UTC from the canonical URL, without opening any demo link first; do not clear markers or manufacture evidence. A separate in-app browser context required the storefront password and was closed without attempting bypass. The authenticated Chrome tab remains on Pagnetic Overview.

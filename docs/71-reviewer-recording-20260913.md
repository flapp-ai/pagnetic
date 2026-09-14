# Actual reviewer recording checkpoint — 2026-09-13

Status: RAW PARTIAL WALKTHROUGH RECORDED; not final reviewer proof or resubmission.

## File and validation

### Subsequent Astra/Luna media QA

Luna produced a re-encoded finite-duration copy and English caption prose (doc73). Astra inspected sample frames at0/60/120/180seconds, then rejected treating a lossy/canvas-normalized copy as the preservation master. The source contains dynamic frame heights; constant-canvas re-encoding is not pixel-identical.

Astra created the preferred **stream-copy** artifact at `tmp/reviewer-20260913/pagnetic-review-lossless-remux.webm` using `-map 0:v:0 -c:v copy -an`, with no trimming, scaling, crop or frame-rate change. It has finite container duration **212.219seconds**. File SHA256 `c1040871d34c00fd6db187f8a6b5282c6dd9ca405e3abde120337690561b51c7`. Original and remux compressed video stream SHA256 both equal `e76cd4323016bebd589397b5d82c225e56ab19821b4e531d5bc09f07d8264e23`, confirming preserved video payload.

Full remux decode completed with852frames, exit0, using passthrough timing and a1/1000 output time base. The first default null-output decode emitted duplicate-DTS warnings from output time-base rounding; the millisecond passthrough verification completed without those warnings. Container header says1728×860, but source frames have changing heights746/748/804/860; do not misreport it as a fixed-resolution original. Raw original remains unchanged. No tool/dependency was added to the application; isolated ffmpeg lives in `/tmp/pagnetic-media-tools-20260913/`.

This closes technical duration/full-decode verification only. Caption timing, complete visual review, and missing actual setup/activation footage remain open. The video is not final reviewer proof and was not uploaded or submitted.

- File: `/Users/erenyigit/Downloads/pagnetic-review-2026-09-13T16-27-03-705Z.webm`.
- SHA256: `d1a1f00d8793d2f6fa3b370541ee06315f62e441166e5f1266b7908ca2b164a5`.
- Size: 3,620,212 bytes. Browser playback reports 1728×746, readyState4, no media error; visible replay shows the actual Pagnetic UI.
- Browser duration reports Infinity because the MediaRecorder WebM lacks finalized duration metadata. Normalize the container and verify complete playback before hosting/submission. No independent full-file decode or complete visual review is claimed.
- No audio was captured. Accurate English captions remain to be authored and visually time-checked.
- Capture was restricted through Chrome's native sharing picker to **test1 · Pagnetic · Shopify**. The live recorder preview was inspected before continuing. Whole-screen/window sharing was not selected.
- First attempt from a background recorder returned InvalidStateError and created no recording. Root brought only the Pagnetic recorder tab forward, selected the exact Pagnetic tab in Chrome's picker, and retried successfully.

## Real recorded sequence (UTC observation timestamps)

| Time | Action / observed outcome |
| --- | --- |
| 16:23:41 | Capture verified on Overview. Seven authenticated QA checks remain; Original is held. |
| 16:24:09 | Messages: selected synthetic QA pouch and clicked Show messages. |
| 16:24:33 | Expanded campaign form and filled the existing approved `pagnetic_review / qa_pouch_20260912 / two_pockets` values, Universal angle, exact supported pockets statement. **Did not submit a duplicate draft or change approval.** |
| 16:24:49 | Expanded exact sources on the existing approved message. |
| 16:25:02 | Opened actual approved desktop Experience preview. This is merchant preview, not shopper treatment. |
| 16:25:11 | Set Device to Mobile and clicked Update preview; same experience retained. |
| 16:25:34 | Navigated captured tab to the normal synthetic product URL. Original text/native purchase controls remained visible; DOM hidden, consent_denied, measured=false. |
| 16:25:53 | Native Cookie preferences: enabled Personalization and Analytics (Marketing left off), Save my choices. DOM returned KILL_SWITCH_ACTIVE, failure code absent, hidden/unmeasured, as expected under retained hold. |
| 16:26:03 | Native Decline all restored consent_denied, failure code absent, hidden/unmeasured. |
| 16:26:38 | Results showed No experiment yet. No lift or monetary result claimed. |
| 16:26:55 | Settings showed Active, Shopify-confirmed through Oct12, freshly verified Sep13 16:26UTC; serving still paused. |
| 16:27:03 | View plans navigated the captured tab top-level to Shopify hosted pricing. Free to test and Founding Beta current terms displayed; no new approval/charge. Recording stopped and downloaded. |

These timestamps are operator observations, not exact subtitle cue offsets. Recording began before the first timestamp; derive cue offsets from actual video playback. DOM-only consent diagnostics are not rendered into the captured video.

## Still missing for Shopify requirement4.5.3

This recording improves on the original introduction: it captures real product selection, configuration fields, source review, preview interaction, native consent and billing navigation. It does **not** establish fresh installation, saved campaign creation, fresh message/package approval, actual theme configuration/save, completed governed activation or shopper treatment. Existing Sep12 recordings contain some separate approval/reinstall/billing evidence but are not automatically a complete final demo.

Do not mark the feedback resolved or host this raw partial file as the completed end-to-end replacement. Finish legitimate QA/activation prerequisites, capture the missing real setup/expected-result steps, add accurate English explanation and perform a complete reviewer-oriented video review. Keep distinctions between preview, Original baseline, treatment and measured lift explicit.

## Bounded Sol check

Targeted `adaptive-panel.test.js` and `pixel-privacy-v2.test.js` passed27/27. No source defect was reproduced and no speculative patch/deploy was made. The previous one-off runtime_failure_safe remains documented in doc70; today's native grant/withdrawal succeeded but does not erase it. If reproduced, capture the exact failure-code attribute immediately with the request outcome before assigning a cause.

All seven manual QA receipts remain unaccepted. Current screenshot/interaction evidence is not owner-reviewed artifact registration. Performance still needs the representative evidence required by the existing PRD. No holds, experiments, pricing, Shopify findings or public distribution were changed in this recording continuation.

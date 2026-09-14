# Proposed test1-only reviewer demonstration protocol

Status: OWNER APPROVED FOR IMPLEMENTATION on 2026-09-14. The owner replied “yes i approve your porposal go on” to the proposal for isolated test1 demo mode and a dedicated Astra QA-operator identity. Approval does not certify implementation, deployment, QA or Shopify acceptance. No production state changes are made by this document.

## Why a decision is needed

The current protocol uses the same performance acceptance gate for an internal synthetic demonstration and real-shop activation. PRD24 section13.2 cannot be certified from test1's synthetic traffic. Fabricating a performance PASS is not an acceptable path to a recording. The existing partial video also does not demonstrate the complete setup and visible adaptive outcome requested by Shopify.

## Recommended bounded change

Doc72 describes the more conservative Original-only diagnostic option. That can improve internal testing but cannot show an adaptive message on the storefront. The proposal below additionally permits an explicitly labeled synthetic demonstration of the already-approved message; it remains separate from A/B treatment and is a new owner decision, not a claim that the frozen protocol already allows it.

Introduce a distinct **reviewer demonstration** path, not a waiver of production QA:

- Hard-limit eligibility to `test1-eczm2zce.myshopify.com`, confirmed development-store status, the existing synthetic pouch and the exact reviewed package. Fail closed if any identifier or source changes.
- Require an explicit authorized operator action with an expiring session/window, immutable audit receipt and immediate stop control. Provision a separately identified Astra operator only if the owner expressly approves it; do not impersonate the human owner.
- Keep real-store activation, production performance status, ordinary experiment orchestration, billing and outcome/maturity gates unchanged. Demonstration evidence is a different evidence type and cannot satisfy `performance` or upgrade readiness.
- Allow deterministic demonstration of the approved source-backed message on that synthetic product only, with an unmistakable **Demo / synthetic test — not a live experiment** label in app and storefront. Never generate a mature baseline, A/A validation, winner, revenue lift, actual-ad traffic claim or paid-order evidence.
- Exclude demonstration traffic and orders from production results, qualification and billing usage. If the existing data contract cannot isolate them, stop rather than reuse live events with guessed labels.
- Preserve genuine consent handling, tenant/source validation, request deadlines and Original fallback. Check native purchase controls, mobile/desktop layout and bounded lab performance before recording. Lab results remain diagnostic, not population certification.
- Capture the real setup, exact source/approval review, theme integration, explicit demo start, generated test link, visible approved message, consent refusal and stop-to-Original. Disclose the development-store/demo limitation to Shopify in the video and reviewer instructions.
- Stop the demo and restore Original after recording. No automatic public-store rollout or permanent hold removal.

## Implementation acceptance after owner approval

Sol should design the smallest isolated path after inspecting the existing plan/deployment contracts. Astra must review positive test1 behavior and negative cases: another shop/product, non-development shop, expired window, changed source/approval, missing consent, stop/revoke, forged demo context, and contamination of real metrics. Deployment requires relevant tests, source review and actual test1 QA; a code-only PASS cannot authorize submission.

If safe isolation cannot be implemented without weakening the ordinary serving path, return the concrete design conflict for review. The alternative remains gathering the real-traffic evidence under the unchanged production protocol before activation.

## Work that can finish without this decision

Normalize and decode the captured partial video; review its exact frames; prepare accurate English captions and reviewer instructions; preserve honest existing QA artifacts. Do not present these as a completed end-to-end demonstration while the activation/outcome branch is absent.

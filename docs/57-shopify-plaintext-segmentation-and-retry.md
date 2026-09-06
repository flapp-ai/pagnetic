# Shopify plaintext segmentation and selected-product retry

Date: 2026-09-06

Live follow-up: deployed as reviewed-653e304059bd after source-bound341-test full check. Same-receipt authenticated retry and automation200 produced a fresh READY_FOR_APPROVAL plan on the synthetic product; owner approval remains null. The live parser blocker is resolved. Old failure notices remain displayed and require scoped notice reconciliation; see docs26.

## Scope

This correction is limited to the observed test-store preparation blocker. Shopify's plaintext conversion can concatenate adjacent HTML paragraph text without inserting whitespace. The source snapshot and cutover receipt remain immutable; the diagnosis rule version changes so the same authenticated source can be evaluated again without rewriting the earlier abstention.

## Implementation

- `message-diagnosis-v2.2` scans punctuation boundaries instead of requiring whitespace. A terminal `.`, `!`, or `?` followed immediately by an uppercase sentence start is a boundary.
- The scanner retains the exact characters from the authenticated Shopify description. It does not synthesize words or whitespace into evidence spans.
- Decimal points, common abbreviations, and multi-initial abbreviations remain within their source sentence.
- `deterministic-source-composer-v2.2` gives the corrected evaluation a new immutable diagnosis identity. An existing `message-diagnosis-v2.1` `NO_SUPPORTED_OPPORTUNITY` record remains unchanged; the new diagnosis and its experience are appended.
- The selected-test-store dashboard now exposes a same-product retry only for the latest current cutover receipt when no v2 plan exists. The action performs a fresh catalog sync, validates the exact merchant, receipt, selected product, frozen source and safety hold, requires the product to remain active, then reopens the same durable preparation job chain.
- The retry control names the receipt-selected product rather than the product attached to the retained legacy plan. Product reselection remains a separate explicit action.

## Evidence

- The production-path regression uses the observed run-together Shopify description. `prepareAutopilotOpportunity` invokes `buildDraftLibrary`, which invokes `createDiagnosisDraftV2`; the resulting claims are verified as literal substrings of the single description `EvidenceObject`.
- The same regression begins with a persisted v2.1 abstention and verifies that preparation appends a v2.2 diagnosis and draft while preserving the old record.
- Focused Node 24 evidence: 16/16 diagnosis and selected-cutover tests pass; 20/20 preparation-worker and Autopilot tests pass; targeted TypeScript and ESLint checks pass.
- Integrated pinned Node 24 `pnpm check` passes: 341/341 tests, TypeScript, ESLint, React Router production build, and Shopify app build. The source identity was unchanged across the check: `653e304059bd4df55ebcac3937c6afe36f96f5ffd4d83a61e7c42df28af6f64d`.

No Shopify data, feature flag, deployment, product, receipt, or production database was changed by this correction. Live retry and successful preparation remain post-deployment verification steps.

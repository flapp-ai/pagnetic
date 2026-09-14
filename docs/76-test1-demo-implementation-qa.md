# Approved isolated demo: implementation and QA checkpoint

Date: 2026-09-14. Status: IMPLEMENTATION IN PROGRESS; not deployed or accepted.

Owner approval: “yes i approve your porposal go on”, referring to doc74's isolated test1 demo mode and dedicated Astra QA identity. Public launch, production performance acceptance and experiment activation are not included.

## Ownership

- Sol: backend authorization, expiring demo contract, exact-source binding, audited actor provisioning/start/stop and targeted server tests.
- Luna: storefront demo branch, native-consent lifecycle, lease removal, pixel/vitals isolation and targeted client tests; one writer per client/extension file.
- Astra: boundary review, integration verification and actual test1/browser QA. No fabricated human-owner or Shopify evidence.

## Required negative and positive checks

| Case | Required result |
| --- | --- |
| Exact development shop + synthetic product + current approved package | Audited expiring demo can start under authorized identity; generated link, explicit synthetic label |
| Another shop/product, non-development store or missing canonical confirmation | No demo authority; no cross-tenant content |
| Forged, malformed, expired or stopped demo context | Original; no experimental assignment or measurement reference |
| Source or approval changes after start | Context invalidated; no stale approved text |
| Unauthorized operator provisioning/start/stop or client-supplied actor spoof | Rejected; no role escalation |
| Consent unknown/denied or only one required purpose allowed | No demo content or identity/event creation |
| Late consent grant | Only the exact active approved demo content, visibly labelled; no statistical state transition |
| Revoke while request pending / stale response after stop | No reappearing panel; response generation invalidated |
| Stop, expiry or source invalidation with page already open | App panel removed within bounded revalidation; native product/cart/checkout unchanged |
| Pagehide/visibility return/network timeout | Safe removal/revalidation; no persistent stale demo |
| Pixel/page-view/vitals/checkout during demo | No demo contamination of real results, qualification or billed usage; no `_pagnetic_ref` |
| Normal non-demo traffic | Existing governed path unchanged; all production QA/performance/maturity holds remain enforced |

## Integration and release evidence to record

Record exact source commit and build/test commands, actor audit, canonical development-store check, package/source hash, demo expiry and stop receipt. Verify mobile/desktop native purchase controls, real consent and local diagnostic timing. Do not register lab results as population-grade performance PASS.

Before Shopify upload: record real setup and demo start/link/output/stop, keep the label visible, add accurate English explanation, inspect full playback and proof-link access. A demo is not a mature experiment or sales-lift result. Stop the active demo after filming.

No production state is altered by this checklist. Later sections must distinguish local tests, deployment, live browser verification and Shopify submission receipt.

## Current package authority refresh

Read-only production check found the only historical package review `cmtyk2lwt0042q6lcpscbsz28` / `031bd66c…535898` INVALIDATED after reinstall; its old approvedAt is history, not current authority. Root used the normal authenticated Messages **Prepare adaptive package for review** action. It created PENDING review `cmu0uast301fhq6lb6isxnwv0`, package hash `670e19c0d955e707084b7e917e3e22a6ffbf953c0ea1845cde4be7d94bb36d24`, coverage1/1, no deployment.

Exact pending content: **Two internal pockets separate cables and adapters.** Supporting bullets: synthetic development-store fixture; no real item offered/fulfilled; zip closure keeps small items together; rectangular pouch20cm wide and12cm high. Mapping `pagnetic_review / qa_pouch_20260912 / two_pockets`, Universal, bundle v4 (`cmtzdcx0x00lfq6lazkxvulh2`). Product source `2026-09-06T19:53:50Z` / `d931f97e…c59f` unchanged.

Root did not click **Approve this exact adaptive package**. New demo-mode implementation approval is not silently converted into a fresh package-review attestation. Backend must bind start to the actual current approved package receipt/hash; it must not restore the invalidated historical approval. Local implementation/tests can continue while this content-approval boundary remains open.

## Targeted integration review in progress

Initial delegated implementations are present locally, not deployed. Root returned these bounded findings for correction: owner-only loader/token access; transaction-time authority and singleton start coordination; exact merchant binding during operator provisioning; bounded exact-shop demo suppression on late events and checkout; positive consent/render/expiry tests; and synthetic order attribution exclusion. The initial three backend negative tests alone are not lifecycle acceptance.

Shopify's official Web Pixels browser API documents storage operations as executing in the top frame: https://shopify.dev/docs/api/web-pixels-api/standard-api/browser. This supports same-origin storage integration, not a claim of verified cross-origin accelerated-checkout isolation. Actual browser QA is still required.

An asynchronous owner question requests approval for the exact fresh package above and dedicated test1 operator. Until answered, neither package approval nor operator provisioning/start is authorized by this checkpoint. No new release or Shopify resubmission is claimed.

## Local acceptance and pre-deployment backup

Root verified 28 billing/subscription/navigation regressions, 54 storefront/pixel/measurement tests and 5 demo tests, all passing. The isolated migrated SQLite lifecycle test exercises actual simultaneous start attempts (Promise.allSettled; exactly one successful start and one start receipt), visible-content response, source drift, owner revocation, stop and expiry. TypeScript, changed-file ESLint, application production build, Shopify extension build and diff-check pass. The initial never-typed pixel callback and server-only route import build failures were corrected before this acceptance.

The additive migration introduces TestStoreDemoLease coordination; immutable receipts/audits remain the evidence. Exact synthetic product orders cannot attach legacy decision references; the existing v2 financial ledger excludes canonical test orders. Accelerated/cross-origin checkout browser verification remains unproven and is not represented as passed.

Before deployment, Fly release48 was healthy. A fresh encrypted backup `pagnetic-ee58c237-5e7f-4c29-9272-e18f5ce08938.sqlite.enc` verified with isolated restore in1701ms. The backup routine pruned one obsolete local cache pair; remote backup objects were unchanged. No new demo authority or Shopify submission was applied.

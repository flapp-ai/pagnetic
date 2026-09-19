# Shopify-reviewer QA — 2026-09-19

## Verdict: NOT READY FOR RELEASE OR RESUBMISSION

Resolution update: the findings below are fixed in the integrated local candidate and its 457-test release gate passed. See [doc100](./100-shopify-reviewer-fix-plan-20260919.md). This remains the pre-fix audit evidence; deployment and live reviewer-store proof still require owner approval.

This audit supersedes doc98's implication that candidate `1a46c31` only needs deployment approval. Passing 445 existing tests did not cover the reviewer journeys below. No release, submission, subscription approval, storefront activation, product edit, or order was performed during this audit.

Scope: live invited **MugJestic** store (`rhv9sb-uj.myshopify.com`), read-only embedded navigation/billing; candidate service flows against an isolated migrated SQLite database; targeted source review. Live Fly release54 remains separate from the undeployed candidate. The store in Shopify's supplied recording was named **LBP Test1**; do not mislabel MugJestic as that recording's store.

## Release-blocking findings

### 1. New staff access is broader than setup access — high

Candidate `ensurePilotRole` automatically assigns every later authenticated actor OPERATOR. The actual OPERATOR gate also permits Settings resume and Operations kill-switch-off (`app.routes` files `app.settings.tsx:155,179` and `app.operations.tsx:371`). An isolated new-staff probe passed that gate. This does not prove every downstream activation prerequisite can be bypassed, but contradicts the claim that the grant is only harmless setup access.

Required: a least-privilege setup role or explicit owner-authorized role grant. Test that setup staff cannot resume serving or clear holds. Do not fix by silently granting OWNER.

### 2. Campaign-first onboarding fails on fresh valid sources — high

`app/routes/app.messages.tsx` creates a campaign mapping then calls `createDiagnosisDraftV2` directly. Fresh synced low-risk facts are not yet approved evidence. The fixture's valid campaign fails with `DIAGNOSIS_EVIDENCE_LINK_MISSING`; running `buildDraftLibrary` first succeeds with four approved evidence objects and one draft. The new default-open campaign form exposes this missing prerequisite, and its mapping is saved before failure.

Required: an explicit safe source-preparation prerequisite or atomic flow, actionable feedback, and tests starting from a truly fresh installation. Do not weaken evidence requirements to suppress the exception.

### 3. Source updates leave an obsolete draft apparently current — high

Fixture: create a draft headed `Dishwasher and microwave safe`; sync a later product version saying `Hand wash only. Not microwave safe. Keep away from direct heat.` The old experience remains `DRAFT`, `staleAt:null`, with the old headline. Sync invalidates APPROVED_ACTIVE experiences but not DRAFT experiences. Messages/preview can still select those drafts. **Publishing obsolete claims was not attempted or proved.**

Required: invalidate/revalidate draft versions and their diagnosis on source change; verify preview, revision and approval cannot present obsolete claims as current.

### 4. Successful campaign drafting can display failure guidance — medium

`createDiagnosisDraftV2` persists `EXPERIENCE_DRAFTED`; the new Messages condition displays the add-three-facts/choose-another-product recovery whenever status is not `DRAFT`. The fixture confirms persisted `EXPERIENCE_DRAFTED`. The source-review button also disappears once any diagnosis exists despite telling the merchant to run it again.

Required: explicit success/abstention/stale states and an available retry/refresh path. Test rendered UI for each persisted status, not just service return values.

## Additional findings

- **Parser coverage gap:** the exact visible Ariel Mug plaintext already contains at least three sentence boundaries. `productDescriptionText` therefore returns it unchanged, even with HTML supplied. The pending parser fix does not address its flattened list boundaries. This alone does not prove that Ariel cannot generate any draft; doc98's definitive source-scarcity explanation was too strong.
- **Existing-record inconsistency:** normalizing the description with unchanged Shopify updatedAt updates the product snapshot but preserves the old source version and old description evidence text. Reproduced in SQLite. Draft generation still succeeded for this fixture, so this is a source-provenance inconsistency, not a demonstrated universal drafting failure. Introduce/test normalization-version-aware source refresh.
- **Contradictory live Settings:** displays `Reviewed authority active` beside `NO ACTIVE PLAN` and `No active plan can change the storefront`. Subscription separately reports Active. Distinguish paid subscription, serving plan and paused/active authority consistently.
- **Empty Results:** no experiment exists, but Show result remains enabled. No fabricated results were shown. Disable or explain the empty action.

## Checks that passed in this bounded audit

- Invited-store Messages, Results and Settings rendered; billing Back returned to Settings. No Application Error was observed on these sampled pages.
- View plans opened Shopify's top-level pricing page, not a refused embedded connection.
- Shopify correctly denied charge approval to the invited non-owner account; current test plan/trial was visible. No charge was accepted.
- Public health and the hosted September16 reviewer MP4 returned HTTP200; video HEAD showed video/mp4. This is availability evidence, not a fresh full-playback review.
- Fly reported the existing single machine started and health1/1 passing. No capacity/service increase or load/stress test.

## End-to-end gates still NOT passed

This is not a completed successful E2E certification. Setup inspection was interrupted by a browser-control CDP frame-tree timeout; that tooling timeout is not evidence of an application HTTP500. Live catalog/draft configuration remains blocked by the current staff-role issue; the candidate cannot be tested live without release approval and must first be corrected.

No new proof of reviewer-store draft approval, theme placement, exact campaign URL producing the intended shopper message, unknown-UTM Original fallback, consent, cart/checkout, uninstall/reinstall, or sustained embedded-session recovery was collected in this audit. Prior test1 receipts are not proof for this different store/current candidate. The planned draft-only recording in doc98 does not by itself show the requested working storefront result.

## Ordered repair and verification gate

1. Correct least-privilege access and add role-denial regression tests.
2. Correct fresh campaign setup and stale-source handling; test changed catalog and existing-record migration.
3. Correct success/abstention/retry and serving-status UI; render-test actual persisted states.
4. Run focused regressions plus the normal release check once after fixes are integrated.
5. Obtain owner release approval; deploy without adding capacity/services, then run the real invited-store sequence.
6. With appropriate store-owner authority, verify product selection → source review → campaign → exact draft → approval → supported theme rendering → matching/unknown UTM → consent → native checkout, and return safely to Original. Do not assume operator access authorizes approval or public rollout.
7. Record the actual reviewer store end to end in English, including expected results and supported limitations. Stop for explicit resubmission approval.

## Reproduction evidence

Disposable local diagnostic: `tmp/reviewer-qa-20260919.ts` (ignored, contains no production credentials). It creates a temporary SQLite database from repository migrations and removes only that fixture afterward. It invokes real service functions, not mocks of the diagnosed behavior. Output:

```text
CAMPAIGN_BEFORE_GENERAL_REVIEW {"error":"DIAGNOSIS_EVIDENCE_LINK_MISSING"}
GENERAL_REVIEW_THEN_CAMPAIGN {"approvedEvidenceCount":4,"draftCount":1,"diagnosisStatuses":["DRAFT","DRAFT"]}
PERSISTED_DIAGNOSIS_UI_STATUS [{"status":"DRAFT"},{"status":"EXPERIENCE_DRAFTED"}]
DRAFT_AFTER_SOURCE_CHANGE [{"status":"DRAFT","staleAt":null,"headline":"Dishwasher and microwave safe"}]
AUTO_STAFF_PERMISSION {"role":"OPERATOR","passesResumeAndKillSwitchGate":true}
LIVE_DESCRIPTION_FIX_BYPASS {"returnedUnchanged":true}
```

No recurring monitor, paid API calls, alerts, or production writes were added for this audit. This bounded QA is not a fresh financial-billing audit or proof of zero future costs.

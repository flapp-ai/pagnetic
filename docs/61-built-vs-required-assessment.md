# Pagnetic — what exists versus what must be built

Development update (2026-09-06): the owner authorized the adaptive scope in [doc60](./60-adaptive-storefront-prd.md), with Luna implementing under [doc63](./63-luna-development-brief.md) and milestones tracked in [doc64](./64-adaptive-development-status.md). Earlier contracts and verification below remain historical/implemented baselines, not evidence that the new scope is built. New protocol changes must be versioned and reviewed; no active registrations or production authority change through this notice.

Date: 2026-09-06. Scope: local source/document inspection, not a fresh full test suite or live deployment audit.  
Target: [Adaptive Storefront PRD](./60-adaptive-storefront-prd.md).

## Executive answer

We have substantial Shopify integration, governed content, runtime, measurement and operations foundations. We do not yet have the latest proposed adaptive-storefront product end to end. The current v2 application primarily prepares and tests a single source-backed Universal panel. Campaign drafting is implemented, but the inspected v2 serving path is not a campaign-to-multiple-bundle selector.

No defensible percentage-complete estimate is available: prior requirements and the proposed adaptive scope are different. Do not count existing tests or documents as proof that contextual personalization is complete.

## Evidence vocabulary

- Source present: code/schema/test exists; not a fresh execution claim.
- Recorded verified: saved release evidence reports the check; may have changed since that checkpoint.
- Partial: useful component exists, but the complete required workflow is absent/unverified.
- Proposed: new requirement; no implementation verification.
- External gate: needs provider evidence or owner authorization, not only code.

## Capability matrix

| Capability | Local evidence | Assessment against latest PRD | Remaining work |
| --- | --- | --- | --- |
| Shopify app, catalog, embedded UI, theme and pixel | app/routes, app/services, extensions/adaptive-panel, extensions/adaptive-measurement | Source present; synthetic live evidence recorded in doc59 | New bundle/decision contract QA and supported theme/browser acceptance |
| Evidence, claims, approvals, immutable versions | prisma/schema.prisma; governance.server.ts; runtime.server.ts | Reusable foundation | Campaign-specific provenance and proof/FAQ evidence validation across full flow |
| Source-backed copy diagnosis | message-diagnosis-v2.ts and .server.ts; message-diagnosis-v2.test.ts | Implemented deterministic extraction/ranking with optional provider interface | Materially different multi-angle experiences; human usefulness evidence; do not claim deployed generative model |
| Campaign draft UI and mapping records | app/routes/app.messages.tsx campaign-draft; CampaignMapping in schema | Partial: exact ad text and campaign draft exist | Ad-first onboarding, easy links, mapping validation/coverage and contextual runtime wiring |
| Current v2 runtime | v2-decision.server.ts approvedPanel/resolveV2Decision | Single deployed content pointer; not required multi-bundle selector | AS-03 versioned deployment, resolver and policy-aware serving |
| Legacy contextual concepts | runtime.server.ts, AcquisitionAngle/CampaignMapping/ExperienceVersion; runtime tests | Prior-path scaffolding to reuse carefully | Do not bypass v2 governance/measurement by switching to legacy runtime |
| Storefront content | storefront/adaptive-panel-v2.js and ApprovedPanelV2 type | Headline, benefits and optional reassurance | Proof/FAQ schema+renderer, accessible and useful placement; broader modules deferred |
| Experiment preparation | autopilot-v2-orchestrator.server.ts startMessageTest | Explicit Original vs Universal default | New Original-vs-matched and Universal-vs-matched protocol paths and calibrated analysis |
| Assignment, reconciliation and financial outcomes | experiment-registration-v2, financial-ledger-v2, shopify-financial-v2, webhook-inbox-v2; related tests | Substantial reusable source; synthetic live lifecycle recorded | Multi-context experiment integrity and actual eligible-merchant efficacy evidence |
| Consent, privacy, erasure, recovery | privacy/customer-privacy services, suppression/recovery tests | Substantial reusable source; not blanket regulatory certification | New context/data contract review and remaining live release-specific evidence |
| Autonomous operations | jobs/outbox, automation/orchestrators, result-actions-v2 | Existing lifecycle and safety automation | Recurring campaign-change workflow and merchant-facing coverage; do not imply connected ad monitoring |
| Billing | subscription-v2 and shopify-app-pricing-v2 | Source present; latest saved checkpoint billing off | Owner-approved offer and bounded evaluation; billing-provider verification before charges |
| Fly and backups | docs26/59, fly.toml, backup/recovery scripts | Deployment/restore recorded, not checked live in this task | Fresh operational checks, incident-recovery evidence and launch gates |
| Behavioral adaptation | Inspected v2 request has product/visitor/session/consent/campaignRef/blockVersion | No behavioral decision loop established by inspected source | Separate Horizon C signal/privacy/shadow/experiment work |
| WooCommerce/BigCommerce/custom adapters | Current product relies on Shopify and Prisma-specific services | Not implemented | Internal seam first; extra platform only after demand validation |

## Critical source findings

1. app/services/v2-decision.server.ts accepts campaignRef, but the inspected use includes it in request identity, not a mapping-to-bundle resolution. approvedPanel reads a single contentVersionId from the deployment payload. New decisions record acquisitionAngle and mappingVersion as null. MATCHED enum/arm names are not evidence of actual personalization.
2. app/services/autopilot-v2-orchestrator.server.ts startMessageTest registers controlPolicy ORIGINAL and treatmentPolicy UNIVERSAL, with the first approved content version. This is consistent with doc24, but different from doc60's new product focus.
3. ApprovedPanelV2 and storefront/adaptive-panel-v2.js carry/render headline, benefits and reassurance. proofItemsJson in the database does not mean the v2 consumer renders proof; no FAQ appears in this inspected response contract.
4. app/routes/app.messages.tsx puts one-campaign matching in a secondary disclosure. It already requires exact campaign text; it is not a zero-work ad integration. message-diagnosis-v2.ts ranks supported source spans by campaign-token overlap, which should not be represented as a proven intent-learning model.
5. Current source is user-owned and untracked in Git. Preserve it; use existing source-bound release manifests for evidence rather than inventing a commit identity.

## Last saved deployment checkpoint, not freshly reverified

Doc59's final checkpoint is 2026-09-06T11:12Z: Fly reviewed-4f301154fcd9, 346/346 tests and builds recorded, Shopify extension released, synthetic order/refund inbox processed and test-only exclusion preserved. The approved test plan remained VERIFYING under an exact migration hold, with billing/model/shadow/offer disabled. No treatment, public launch or actual revenue-lift claim follows.

Recorded remaining gates: seven operator QA checks (mobile, desktop, standard checkout, accelerated checkout, Shop Pay, consent flows and performance); owner terms date; actual operational sending connection for bilgi@flapp.ist; independent recovery/usefulness/distribution evidence. Existing responsive/synthetic observations are narrower than final sign-off. Recheck this list against live state before acting.

## How the local documents fit together

| Documents | Meaning now |
| --- | --- |
| Original attachment and docs01–06 | Original thesis plus initial narrow governed pilot; preserve historical context |
| docs13/18/19 | Earlier public beta/pricing/autopilot proposals; not current pricing authority |
| docs21–23 | Audit and revised experience proposals |
| docs24–26 | Implemented v2 contracts and accumulated status; start with newest dated checkpoint, not old totals |
| docs27–59 | Financial/statistical/privacy/recovery/release evidence and bounded fixes; each scoped to its date/release |
| docs60–62 | Latest proposed adaptive direction, code gap assessment and ordered backlog; documentation only |

## What is needed from the owner

Before implementation: approve Horizon A as the next build scope, with behavioral adaptation and extra platforms explicitly later. Before pilot: choose/introduce a qualified store, provide actual campaigns/product evidence and approve customer-facing bundle/experiment package. Before commercial launch: approve price/evaluation/terms and necessary provider/distribution permissions. Do not send secrets in chat.

Engineering can draft contracts, implement/test the scoped policy flow and prepare previews without waiting for final price or an ad-platform connector. It cannot validate market lift, fabricate approval, or configure an external account without its actual authority/access.

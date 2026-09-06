# Pagnetic MVP v2 release handoff

Updated: 2026-09-05T17:55Z; corrected source-bound checkpoint  
Release state: **code-controlled MVP coherent; external deployment evidence open; not design-partner deployable; not public-acquisition ready**

This handoff is governed by the executable PRD and the evidence ledger in [26-mvp-v2-implementation-status.md](./26-mvp-v2-implementation-status.md). That ledger is the authoritative row-by-row status for R01–R14, S01–S10 and AT01–AT30; this document explains the release decision and next actions without duplicating or upgrading those states.

## Current conclusion

The ordinary code-controlled privacy/recovery P0 path is complete locally: exact encrypted intake, replay suppression, versioned key history, scheduled encrypted data-copy collection, exact scoped graph redaction, Shopify-account-owner-verified post-reinstall access, explicit signed delivery confirmation, encrypted restore-journal reapplication and authenticated audited technical reopening are implemented and tested. The terminal redaction state still requires backup deletion/legal review; delivery confirmation does not assert those reviews. See [46-encrypted-customer-data-copy.md](./46-encrypted-customer-data-copy.md) and [47-audited-recovery-reopening-and-delivery.md](./47-audited-recovery-reopening-and-delivery.md). Real production bucket/escrow, customer delivery and incident-drill evidence remain open.

The code-controlled v2 lifecycle now works locally from approved plan through Original/Original baseline, mature qualification, frozen Original/Universal experiment, financial reconciliation, exact final report and keep/revise/stop. Serving, plan transitions and evaluation consumption fail closed. The deterministic content path abstains when it lacks evidence. Billing verification is read-only and offer publication remains closed.

The corrected source-bound Node24 verification passes323/323 tests, typecheck, lint, React Router production build, Shopify app build, PostgreSQL-track freshness/rehearsal and the current independent statistical hashes. Its local checksum manifest is `docs/release-checks/local-dLdHFh/manifest.json`, source SHA-256 `875470a389d874efc4d2137c9c652523517106a2e0582f6bea37da4e75fc7275`; it is not signed CI provenance or a Git release because the repository has no commits. Current `pnpm check:partner` passes31/31. `pnpm check:production` fails16 local environment/recovery checks: production mode/credentials/URL, required secrets/services, durable database/capacity/single-writer/proxy/public identity and real off-volume backup/restore proof. Those local missing values are not evidence that the deployed Fly environment lacks every older application secret. Live read-only inspection confirms release13, one FRA machine and passing `/healthz`; the new backup/privacy/S3/alert configuration is absent. A green local suite must not be described as launch readiness.

## Release identity

- Package: `0.1.0`; Shopify Admin API: `2026-07`.
- Current Prisma schema source SHA-256: `a64d9a707d974d867772b9d512978f850c28783aa19b577699d6281d745ffcfd`; current SQLite history contains25 migrations through `20260906020000_privacy_delivery_audit`. Migration24 adds recovery quarantine/evidence/audit and migration25 adds tenant-independent signed delivery evidence. The PostgreSQL track is regenerated and has no schema drift; it is not approved/deployed to production.
- Theme extension UID: `06f03124-120a-6798-21c0-2bb4e2cf089ab2f75256`; Web Pixel UID: `9799ce6c-b318-995d-baa9-c13a2d72dbc4e4ffc9c3`.
- Built legacy/v2/vitals assets: 9,992/9,999/862 bytes; SHA-256 `2430605bba81f195c03fb525124d6fd8eea33db1b138a4ed9df653eb8a1a9c59`, `a946bb05fadcba246bfd337bfd2baa6a7057d65b50012710ee1460c31d484f1a`, `47cb08c2f6df419f6827bbfb62b7965bf59913add9ca10610b541ff5a6c98335`.
- V2, shadow serving, optional model, billing and new-offer publication default closed.
- The repository has no commits; every file remains user-owned/untracked. Do not infer rollback history from Git.

## Evidence completed locally

- 323 automated tests plus compile/lint/application/Shopify builds at the current source-bound release checkpoint. The final acceptance corrections authenticate terminal delivered-copy replay, retained historical backup keys and the restore-to-manifest CLI handoff; see docs48.
- Independent statistical reference: 45 Student-t comparisons, 24,000 null and 12,000 positive-effect experiments under current v2.3 hashes.
- Actual local PostgreSQL transfer/restore/concurrency rehearsal covers69 tables and15 fixture rows with12 exclusive job claims, held-transfer refusal, authenticated released-transfer acceptance, financial/lifecycle/deployment/privacy/report concurrency and dump/restore parity; this is not a managed-provider cutover. Evidence is [postgres-rehearsal.json](./audit-2026-09-05/postgres-rehearsal.json).
- Encrypted SQLite backup/readback/isolated-restore, tamper/corruption/staleness and no-overwrite tests.
- Four-tenant mixed service rehearsal at twice a declared synthetic fixture rate: latest12:22Z refresh has110 operations, zero errors, decision p95 23.327ms, all four tenants20/20, and four late mobile deliveries failed Original at1,500ms. This remains a tiny synthetic fixture, not production capacity. See [37-local-mixed-load-rehearsal.md](./37-local-mixed-load-rehearsal.md).
- Atomic deployment-authority rollback; expired/stale worker leases; dead-letter containment; frozen financial-as-of report; uninstall/privacy/evaluation-consumption regressions.
- Actual Linux container build on the existing Fly platform passed in build-only mode; the exported292MB image and source identity are recorded in [43-fly-container-build-only-check.md](./43-fly-container-build-only-check.md). A post-build read confirms the live app remains release13 on its old image. This is packaging evidence, not runtime/deployment approval.

These results establish local implementation behavior. They do not establish provider latency, real-store compatibility, production capacity, population Web Vitals, live refund semantics or customer value.

## Exact blockers before a design-partner deployment

0. **Customer privacy fulfillment evidence.** Exact scoped erasure, graph suppression, encrypted owner data-copy collection, authenticated owner access after reinstall, explicit signed delivery confirmation, restore-journal reapplication and audited technical reopening pass locally. The terminal redaction state intentionally remains backup-review, while delivery remains legal-review-required. Verify real backup retention/deletion, actual Shopify-owner delivery, over-limit handling and legacy lost-scope receipts before any production fulfillment claim.

   Independent active/previous privacy keys, per-record fingerprints, fail-closed omitted-key coverage, authenticated legacy adoption and per-request suppression progress pass; canonical writes recheck inbox authority before commit. Production still needs independently escrowed lookup/storage/backup keys and exact historical-key coverage. Do not treat local cryptographic fixtures as off-volume escrow.

1. **Production environment.** Preserve the existing Pagnetic Fly HTTPS URL, Shopify credentials, independent assignment/automation/field/funnel secrets and one-writer database configuration; these were confirmed by read-only configuration/secret-name inspection and do not need to be supplied again. Complete the new backup/alert configuration and release identity, verify a cohort-specific capacity cap and run `pnpm check:production` in that exact deployment environment. The new backend/container/extension release has not been deployed.
2. **Off-volume recovery.** Owner must provide an approved S3-compatible bucket/region/credentials and independently escrowed active/previous backup-key history. Execute one real encrypted upload/readback, isolated restore using its automatically preserved verified manifest, receipt replay, audited release and full application recovery drill. Record measured RPO/RTO. Local adapter tests are not a substitute.
3. **External alerting and scheduling.** Owner must provide an HTTPS alert destination and incident owner. Configure five-minute authenticated maintenance, six-hour backup and an external dead-man/health check; force one safe synthetic alert and verify remote2xx acknowledgment. Confirm process supervision and retention on the actual host.
4. **Shopify App Pricing.** Supply Partner organization/app identifiers, read-only Partner token and app handle; create/review the intended private no-charge development plan and pricing welcome link. Keep both commercial publication flags false until owner approval. No charge or plan has been created by Codex.
5. **Real Shopify/browser evidence.** On the exact published product template, verify one block only, product-specific acknowledgment, desktop/mobile, variants/quantity/selling plans, standard checkout, accelerated checkout, applicable Shop Pay, mixed cart, consent denied/allowed/late/revoked, two tabs, slow/offline proxy, pause, uninstall/reinstall and one refund. Record order joins and exact net-money change. Do not bypass authentication or fabricate N/A.
6. **Performance.** Record app-proxy/server latency and before/after LCP, INP and CLS on supported devices/geographies. Derive twice-peak input from the accepted partner forecast, add DB-wait/queue-worker observations, and repeat mixed load on the intended PostgreSQL/Fly topology. The local synthetic run cannot set a merchant cap.
7. **Financial contract.** Verify the pinned 2026-07 GraphQL queries and tax-inclusive refund convention using controlled Shopify orders/refunds. A paid-status screenshot alone is insufficient.
8. **Legal and distribution.** Preserve the already supplied company identity (Flapp Bilişim A.Ş.), Fly.io hosting choice and support/privacy addresses. Verify the effective legal documents/date/public URLs, nominated incident owner, pilot agreement, protected-customer-data status and final distribution/listing decision. Ask only for the still-missing decisions after checking existing evidence; engineering must not invent approval or make the owner repeat completed setup.
9. **Product/content review.** Complete the independent 50-fixture human review: zero fabricated claims/evidence and at least80% useful/clear output within the declared supported subset. Nominate the first low-risk design-partner product and confirm the baseline forecast is responsible.

Managed PostgreSQL is required before multiple unattended stores/replicas or removing the measured single-writer cap. A supervised one-store SQLite pilot is only admissible after the real off-volume backup/restore and single-writer gates pass.

## Safe deployment order

1. Freeze the release identity and capture the intended-store/schema/theme/pixel identifiers.
2. Back up and verify recovery before applying any release or migration. A restored database must remain quarantined until complete authenticated receipt replay, exact protected-data/schema/source checks and the signed audited hold-release transaction pass; `RELEASED` text alone is not authority.
3. Deploy with `PAGNETIC_V2_ENABLED=false`, billing/model/shadow/offer flags false and kill switch active.
4. Run current migrations once on the single writer; verify migration history, counts and health.
5. Complete authenticated admin, theme, pixel, webhook and privacy checks while serving Original.
6. Create a fresh v2 plan from the current product source and obtain explicit merchant approval.
7. Enable v2 only for the approved test store/product; keep commercial publication closed.
8. Start the fixed Original/Original baseline. Do not start Original/Universal without the exact mature measurement result, authoritative qualification and fresh scoped QA evidence.
9. During launch watch failures, server/client latency, render/bridge coverage, arm balance, webhook queue age, financial joins and incidents. Pause immediately on any stop condition.

## Rollback procedure

1. Use the authenticated pause action or kill switch. New requests must return Original immediately; the open cohort closes as interrupted while financial reconciliation/finalization continues.
2. Verify the product pointer now references an Original/PAUSED or Original/STOPPED immutable deployment revision. Do not edit a historical registration/result.
3. Stop new lifecycle roots for an uninstalled/stopped plan; retain bounded financial/privacy work that is legally required. Dead-lettered chains need explicit operator retry.
4. If application release rollback is required, keep the database on a schema compatible with the selected build. All current changes are additive, but there is no Git commit to select; create and review a release commit before production.
5. If the database is damaged, leave it untouched. Use `scripts/restore-sqlite.sh <manifest-object> /absolute/NEW-database.sqlite`; restoration refuses overwrite. Replay receipts and collect exact outstanding redaction/data-copy work while isolated, then use the shared audited release service only after review. Validate checksum, SQLite integrity, FK/count/hash/source evidence and application health before repointing the single writer.
6. Re-run health, automation, backup and product-specific Original-serving checks. Record the incident, exact revisions, data gap and recovery time before reopening.

Local tests cover pointer/transaction rollback and isolated database restore. A real host release rollback and full application recovery are still mandatory evidence.

## Customer-learning work after deployability

Public acquisition readiness cannot be automated. Retain the target learning cohort:8–10 discovery interviews,5–8 qualified assisted stores,4/5 unprompted usability completions, at least70% reaching a usable decision inside the forecast window, three independent paid continuations and two still paying/using another useful cycle at day60. Record negative, null, invalid and rejected outcomes without relabeling them as wins.

The next release decision is therefore **continue engineering and external readiness; do not launch publicly**.

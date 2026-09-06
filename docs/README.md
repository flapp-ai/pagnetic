# Adaptive Storefront Documentation

Development update (2026-09-06): the owner authorized the adaptive scope in [doc60](./60-adaptive-storefront-prd.md), with Luna implementing under [doc63](./63-luna-development-brief.md) and milestones tracked in [doc64](./64-adaptive-development-status.md). Earlier contracts and verification below remain historical/implemented baselines, not evidence that the new scope is built. New protocol changes must be versioned and reviewed; no active registrations or production authority change through this notice.

Status: Product-development baseline  
Version: 0.7  
Last updated: 2026-09-06

## Latest adaptive-storefront proposal — start here

- [Adaptive Storefront PRD](./60-adaptive-storefront-prd.md) — restored contextual-personalization direction, scoped horizons, requirements and acceptance.
- [Built versus required](./61-built-vs-required-assessment.md) — current local source evidence, partial capabilities and last saved deployment limits.
- [Ordered execution plan](./62-adaptive-storefront-execution-plan.md) — bounded packages, dependencies and acceptance cases.

Documents60–62 are the latest proposed direction, not an implementation or deployment claim. Documents24–26 remain the implemented v2 baseline until a versioned successor is approved, built and verified. For the latest saved live checkpoint use document59 and the top of document26; lower historical readiness statements are not current certification. No existing registered experiment is changed by these documents.

## Purpose

This document set converts the Adaptive Storefront kickoff thesis into a testable product and engineering plan.

The original pilot thesis was deliberately narrower than the long-term vision:

> Prove that matching a paid-acquisition message to an approved product-page selling experience creates at least 5% incremental revenue per eligible session.

The executable MVP-v2 plan now sequences source-backed page improvement before optional campaign matching. New v2 experiments measure net selected-product sales per assigned visitor as their primary endpoint; RPS remains secondary. This is a new protocol, not a change to existing registered experiments. Start with documents24–26 for implementation.

The documents are ordered by decision flow:

1. [Strategy memo](./01-strategy-memo.md) — market thesis, wedge, positioning, scope and decision gates.
2. [Pilot protocol](./02-pilot-protocol.md) — design-partner selection and the experiment that validates the thesis.
3. [MVP product requirements](./03-mvp-prd.md) — user flows, functional requirements, non-goals and acceptance criteria.
4. [Measurement specification](./04-measurement-specification.md) — randomization, metrics, attribution, statistics and reporting.
5. [Technical RFC](./05-technical-rfc.md) — Shopify integration, services, data model, runtime, reliability and delivery phases.
6. [Claims and safety policy](./06-claims-safety-policy.md) — evidence, approvals, prohibited transformations and incident handling.
7. [Pilot operations runbook](./07-pilot-operations-runbook.md) — ordered launch, monitoring, rollback, recovery and closeout procedures.
8. [Design-partner launch checklist](./08-design-partner-launch-checklist.md) — the non-bypassable commercial, infrastructure, browser and experiment gate.
9. [Security, privacy, and data operations](./09-security-privacy-and-data-operations.md) — data boundary, encryption, access, incidents, retention, backups and recovery.
10. [Design-partner onboarding guide](./10-design-partner-onboarding-guide.md) — merchant-facing installation-to-A/A instructions.
11. [Pilot release record](./11-release-record-template.md) — evidence template for each production release.
12. [Design-partner readiness report](./12-design-partner-readiness-report.md) — P0 traceability, verified evidence, live-launch gates and deferred scope.
13. [Public-beta product strategy](./13-public-beta-product-strategy.md) — pre-install value, free-until-result offer, funnel metrics and capacity boundary.
14. [Shopify App Store listing draft](./14-shopify-app-store-listing-draft.md) — copy, reviewer path and outstanding listing assets.
15. [Public-beta launch checklist](./15-public-beta-launch-checklist.md) — code, owner, deployment, submission and learning gates.
16. [Owner inputs for public launch](./16-owner-inputs-for-public-launch.md) — the identity, legal, hosting and pricing decisions engineering cannot make.
17. [Public-beta readiness report](./17-public-beta-readiness-report.md) — verified release evidence, capacity boundary and the remaining owner-controlled blockers.
18. [Hosting and pricing recommendation](./18-hosting-and-pricing-recommendation.md) — Fly.io deployment profile, current market benchmark and founding-beta price.
19. [Autopilot productization PRD](./19-autopilot-productization-prd.md) — zero-configuration merchant journey, automatic experiment orchestration, outcome-first reporting and implementation gates.
20. [Autopilot MVP launch readiness](./20-autopilot-launch-readiness.md) — required-scenario traceability, production evidence, release boundary and the exact owner-controlled launch gates.
21. [Astra market and product audit](./21-astra-market-and-product-audit.md) — current market challenge, reproduced measurement defects, architecture review, economics and recommended positioning.
22. [Customer value and experience PRD](./22-pagnetic-value-and-experience-prd.md) — proposed end-to-end journey, algorithms, screen states, results and recurring value.
23. [Improvement execution plan](./23-pagnetic-improvement-execution-plan.md) — ordered engineering backlog, acceptance cases, market learning and revised launch gate.
24. [MVP-v2 executable PRD](./24-pagnetic-mvp-v2-executable-prd.md) — resolved implementation contracts, 14 requirements, lifecycle/financial/statistical rules, UX, 10 work packages and 30 acceptance scenarios.
25. [Sol execution brief](./25-sol-execution-brief.md) — ready-to-use implementation instructions, dependency order, verification and authority boundaries.
26. [MVP-v2 implementation status](./26-mvp-v2-implementation-status.md) — current requirement/package/test evidence, independent review findings and outstanding launch gates.
27. [V2 financial field contract](./27-v2-financial-field-contract.md) — current Shopify field semantics, normalized ledger contract, reconciliation rules and required order/refund fixtures; implementation verification remains tracked separately.
28. [Encrypted backup and recovery](./28-encrypted-backup-and-recovery.md) — private off-volume backup contract, restore quarantine, authenticated receipt replay and audited reopening sequence.
29. [PostgreSQL migration rehearsal](./29-postgresql-migration-rehearsal.md) — separate PostgreSQL track, deterministic transfer and local concurrency/restore evidence.
30. [V2 statistical calibration](./30-v2-statistical-calibration.md) — independent estimator, null and power calibration evidence.
31. [Message quality evaluation](./31-message-quality-evaluation.md) — bounded deterministic message-quality harness and human-review boundary.
32. [Financial as-of and frozen reports](./32-financial-as-of-and-frozen-reports.md) — immutable financial revisions, cutoff semantics and final report pointer.
33. [V2 capture health and qualification](./33-v2-capture-health-and-qualification.md) — persisted denominators, checkout forecast and qualification gates.
34. [Original baseline source contract](./34-original-baseline-source-contract.md) — mature Original-only source rules for measurement bootstrap.
35. [Storefront request boundaries](./35-storefront-request-boundaries.md) — bounded body, timeout and fail-open transport behavior.
36. [Production supervision](./36-production-supervision.md) — migration/startup/process/HTTP supervision and operational limits.
37. [Local mixed-load rehearsal](./37-local-mixed-load-rehearsal.md) — synthetic twice-fixture-rate latency, queue and fallback evidence.
38. [Backup cache retention and headroom](./38-backup-cache-retention-and-headroom.md) — authenticated local retention and conservative space checks.
39. [MVP-v2 release handoff](./39-mvp-v2-release-handoff.md) — current source identity, evidence, blockers, safe deployment and rollback order.
40. [Local UI accessibility QA](./40-local-ui-accessibility-qa.md) — actual-component keyboard, zoom and viewport fixture evidence.
41. [Reproducible local release gate](./41-reproducible-local-release-gate.md) — source-bound Node24 test/build/schema/rehearsal manifest.
42. [PostgreSQL deployment contention](./42-postgresql-deployment-contention.md) — actual product-pointer contention and exact replay evidence.
43. [Fly container build-only check](./43-fly-container-build-only-check.md) — platform-integrated packaging evidence without deployment.
44. [Customer order privacy workflow](./44-customer-order-privacy-workflow.md) — exact scope, suppression, erasure, delivery and unresolved external review.
45. [Privacy key lifecycle](./45-privacy-lookup-key-lifecycle.md) — independent lookup/storage key rotation, coverage and adoption contract.
46. [Encrypted customer data copy](./46-encrypted-customer-data-copy.md) — scheduled exact-scope collection, verified-owner access and explicit delivery confirmation.
47. [Audited recovery reopening and delivery](./47-audited-recovery-reopening-and-delivery.md) — signed restore evidence/release chain, reinstall recovery and operator sequence.

## Product language

Use these terms consistently. Pagnetic is the public app name; Adaptive Storefront is the internal historical working name.

| Term                 | Meaning                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Adaptive Storefront  | Historical internal product working name; public app is Pagnetic, company is Flapp Bilişim A.Ş.                  |
| Eligible session     | A session that satisfies the active experiment's inclusion rules.                                               |
| Acquisition angle    | Merchant-approved label describing the promise in the incoming campaign, such as `comfort` or `sensitive_skin`. |
| Experience bundle    | Coordinated value proposition, benefits, proof and reassurance shown as one approved unit.                      |
| Adaptive panel       | The single V0 storefront block that renders an experience bundle.                                               |
| Original             | The merchant's page without the adaptive panel.                                                                 |
| Universal experience | One improved experience shown regardless of acquisition angle.                                                  |
| Matched experience   | An experience chosen because its angle matches the acquisition angle.                                           |
| Holdout              | Randomized traffic that remains on a comparison policy.                                                         |
| Decision             | The recorded selection of an experience for an eligible visitor.                                                |
| RPS                  | Revenue per eligible session.                                                                                   |

## Authority and change control

- The registered protocol and its versioned measurement specification are authoritative for each experiment. Document24 defines a new v2 protocol; historical registrations must not be rewritten.
- The claims policy is authoritative for content eligibility.
- The technical RFC is authoritative for system boundaries.
- The PRD is authoritative for user-visible behavior.
- A change that conflicts with another document must update all affected documents in the same review.
- Material experiment changes require a new experiment version; they must not silently modify an active test.
- For new v2 work, document24 resolves the proposals in documents19/22/23. Implementation must version/reconcile affected technical and measurement documents before release, not silently mix old and new rules.

## Current product gate

The 2026-09-05 audit supersedes the earlier assessment that only owner-controlled launch gates remain. The deployed release candidate has 79 passing existing tests and historical 7/9 test-store QA evidence, but new P0 findings concern storefront stage routing, result maturity, attribution and cohort integrity. Public acquisition is not recommended until the revised execution-plan gates pass.

Documents 21–23 are an audit and proposed improvements. They do not alter active experiment registrations, approved merchant authority, prices or production behavior. Existing measurement/claims requirements still apply; implementation must reconcile their versions explicitly. Contextual bandits, cross-merchant training and broad platform expansion remain deferred.

Documents24–26 make the proposed improvements executable and trackable. They do not themselves implement, deploy or verify them. The PRD-writing task leaves application code and production unchanged; the implementation tracker distinguishes engineering, design-partner and public-acquisition readiness.

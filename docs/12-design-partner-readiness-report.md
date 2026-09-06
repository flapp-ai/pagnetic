# Design-Partner Readiness Report

Date: 2026-09-02  
Build: Adaptive Storefront 0.1.0  
Decision: product build complete for design-partner onboarding; live launch remains gated by partner and hosting evidence

This report records the original design-partner gate. The implemented product-led public-beta extension and its current launch boundary are documented in [Public-Beta Product Strategy](./13-public-beta-product-strategy.md) and [Public-Beta Launch Checklist](./15-public-beta-launch-checklist.md).

## P0 coverage

| Requirement                          | Implemented evidence                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shopify installation                 | Embedded React Router app, offline sessions, scope sync and uninstall handling.                                                                    |
| Catalog/product understanding        | Product GraphQL sync, immutable snapshots, source-derived evidence, automatic brand voice profile and angle-ranked statements.                     |
| Claim extraction and safe generation | Versioned evidence, risk classes, deterministic draft library, merchant revision constrained to approved sources, immutable owner approval.        |
| Theme delivery                       | Adaptive Panel Theme App Extension; original, universal, matched and registered experiment modes; native commerce controls untouched.              |
| Traffic/intent                       | UTM capture, versioned exact mappings, explicit angles and conservative semantic inference; explicit unknown-traffic policy.                       |
| Anonymous decisioning                | Server-salted visitor assignment with session fallback, immutable reuse and permanent control.                                                     |
| Event/revenue measurement            | Consent-aware Web Pixel, allow-listed/idempotent ingestion, decision/render funnel, order/refund recovery and line-item attribution.               |
| Incrementality                       | Frozen A/A, Stage 1 and Stage 2 protocols; RPS analysis, cluster-aware interval, result snapshots and downloadable reports.                        |
| Merchant controls                    | Setup, qualification, preview, governed content, measurement and operations workspaces; owner/operator/viewer roles.                               |
| Safety/privacy                       | Hash validation, original fallback, kill switch, automatic rollback, incident/confounder logs, privacy webhooks, encrypted contacts and retention. |
| Operations                           | Health endpoint, authenticated five-minute maintenance, alerts, Docker image, durable pilot volume, backup/restore and release checks.             |

## Verified in the development environment

- Shopify app, Theme App Extension and Web Pixel builds succeed.
- Embedded Setup and Governed content routes render inside the authenticated development store.
- The active pixel endpoint automatically rotated to the current development URL.
- Two paid test orders are stored; one has an experiment attribution join.
- Public health returns success; unsigned proxy, missing scheduler credentials, malformed events and PII-shaped event payloads are rejected.
- Storefront runtime is 3.2 KB gzipped against the 50 KB target.
- Automated unit/contract suite, typecheck, lint, production application build, Shopify extension build and dependency audit pass.

## Non-bypassable live-launch evidence still required

These are deployment/partner facts, not unfinished product code:

1. select and contract the design partner and hero product;
2. deploy to a stable HTTPS host with production secrets and durable volume;
3. run a verified off-volume backup and isolated restore drill;
4. add and verify the Adaptive Panel on the partner's published product template;
5. enter real PDP history and pass product qualification;
6. approve the partner's generated brand profile, evidence and experience library;
7. map the partner's live campaigns and complete all nine checkout/consent/theme/performance QA checks;
8. validate A/A before starting Stage 1.

The application itself blocks experiment launch until the corresponding in-product gates pass. A live pilot should not be described as launched or revenue-ready until this evidence is recorded.

## Deferred beyond the first design-partner MVP

Contextual bandits, Meta/Google/TikTok API integrations, supported review-provider connectors, adaptive recommendations, multi-placement components, cross-store learning, multi-writer PostgreSQL production and uncapped App Store acquisition remain P1/P2. Guided self-serve acquisition for a capped founding beta is now implemented.

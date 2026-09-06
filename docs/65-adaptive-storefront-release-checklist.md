# Adaptive storefront AP-06 release checklist

Date: 2026-09-06  
Contract: `adaptive-a-1` / `adaptive-owner-review-a1`  
State: AP-06 application and Shopify extension deployed safely; all production infrastructure readiness checks pass. Live treatment/pilot approval remains closed pending external QA/content gates.

## Verified deployment target snapshot

Owner-authorized deployment on 2026-09-06 released source `720da7950b50a93dbffd86d6494e9229511081040b4eb8dfd5daf83db8fcf4f5` to Fly app `pagnetic` as release/machine version 23 and image `pagnetic:deployment-01M1VTZ60EF67QX1CYAS7QYC7K`. Machine `d8d1497a937658` is started in `fra` with 1/1 checks passing; `https://pagnetic.fly.dev/healthz` returns HTTP 200. The existing encrypted 5GB `adaptive_data` volume and installed secrets were preserved.

Startup applied only additive migration `20260906120000_adaptive_package_reviews`; Prisma reports all 28 migrations applied and the database schema current. Startup automation/privacy requests returned 200. A new encrypted off-volume backup was uploaded, read back and restored successfully at `2026-09-06T17:09:14.492Z`; remote backup objects were not removed.

The owner-approved terms date is active as `2026-09-06`. Production verification confirms Shopify billing, v2 serving, shadow mode, model use and offer publication are all explicitly `false`, so Original remains the serving state. A Make HTTPS alert endpoint accepted the setup payload with HTTP 200 and is installed as an encrypted Fly secret. After the secret rollout, machine version 24 is healthy with 1/1 checks passing, a new encrypted off-volume backup/readback/restore verified at `2026-09-06T18:51:50.373Z`, and **all 47 production readiness checks pass**. After repairing the Gmail authorization scope and reactivating the scenario, Make recorded the production-originated `EMAIL_DELIVERY_TEST` as a successful three-operation run at 2026-09-06 22:07 local time; the owner confirmed receipt at `bilgi@flapp.ist`. Shopify app/configuration extensions were also built, validated and released as `pagnetic-ap06-20260906` (version ID `1117888282625`). This release is not App Store publication or treatment activation.

## Code-controlled gate

| Gate | Local evidence | Release rule |
| --- | --- | --- |
| Exact package authority | Owner package binds product source/version/hash, exact campaign evidence, mappings, every bundle field, evidence trace, content hash and runtime authority hash. Mapping/source/content/review drift invalidates pre-deployment authority. | Any mismatch blocks approval/deployment; an already registered experiment retains its frozen package and never mutates in place. |
| Experiment question | `adaptive-original-vs-matched-a1` measures the total commercial policy effect. `adaptive-universal-vs-matched-a1` is a separately registered matching-specific question and requires a distinct frozen Universal control bundle. | Never describe Original-vs-Matched as proof that matching itself caused an effect. |
| Eligible denominator | Primary analysis continues to use all assignments. Coverage derives from all assignment decisions, retains assigned visitors across later campaign loss, includes render failures/missing render outcomes, and reports unmatched pre-enrollment context separately. | Never filter the primary result by engagement or successful rendering. |
| Runtime authority | Each adaptive decision verifies deployment/pointer authority, snapshot integrity, exact bundle IDs, content hashes, full text/FAQ/evidence authority hashes and frozen registration content. | Any failure serves Original without creating treatment authority. |
| Safe rendering | Text-only headline, two-to-four benefits, up to four sourced proof items, up to four evidence-linked FAQ entries using native `details/summary`, optional sourced reassurance; no generated HTML or external adaptive asset references. | Malformed/unsupported content is rejected and native price/inventory/cart/checkout remain untouched. |
| Performance contract | `adaptive-performance-a1`: selection-core p95 <=2ms locally; server-decision p95 <=100ms; browser request-to-decision p95 <=500ms; panel-render p95 <=16ms; CLS p75 <=0.05; >=1,000 eligible decisions in <=5 minutes; combined runtime gzip <=10KiB, v2 <=5KiB, CSS <=1KiB; viewports 320/375/768/1024/1440. | Asset/selection budgets are locally executable. Full-path latency/CLS require real supported-theme evidence and must not be inferred from unit tests. |
| Upgrade/rollback | Adaptive review migration is additive in SQLite/PostgreSQL tracks. Legacy single-content v2 payloads remain readable. Pause/kill switch and invalid authority return Original; rollback retains immutable registrations/reviews. | No destructive down-migration or historical registration rewrite. |

## Acceptance mapping

- AC-01–03, 06–10, 14–16, 21–22: targeted adaptive contract/runtime tests.
- AC-04–05: deterministic diagnosis/governance abstention and differentiation tests already in the source gate; human usefulness still requires owner review.
- AC-11–13: existing canonical financial, lifecycle, refund, sparse/null/negative and maturity suites in the full gate.
- AC-17: local semantic renderer, malicious-text and viewport contract coverage; actual theme/browser/performance measurements remain live gates.
- AC-18: supported Messages add/update campaign action creates immutable mapping/evidence versions and invalidates the prior review without mutating a frozen experiment. Merchant task time is a pilot-learning gate.
- AC-19: billing/public-offer flags remain closed; commercial approval is external.
- AC-20: local privacy/recovery suites remain required in the full gate; real off-volume recovery and alert delivery remain operational gates.

## Exact pilot sequence (not executed by this work)

1. Freeze a source identity and verify additive migrations on the selected environment.
2. Keep treatment, billing, model and offer publication disabled; hold serving at Original.
3. Select one supported active product and supply two or three exact real ad messages/references.
4. Prepare and owner-review the exact package UI. Approve only useful, distinct, fully sourced mappings.
5. Complete published-theme placement, consent, Web Pixel, checkout/refund and runtime evidence for that exact release/product/template.
6. Record full-path p95 latency and CLS p75 with the frozen window/sample contract. Reject the release if any budget fails.
7. Register the selected question prospectively. Original-vs-Matched is the first commercial policy test; Universal-vs-Matched is a separate later matching-specific test with its own approval and strong Universal control.
8. Run recovery/rollback and alert-delivery evidence, then enable only the explicitly approved store/product scope.

## External gates that local code cannot satisfy

- Real qualified merchant/product and actual ad evidence; independent owner judgment that at least two stories are useful and materially distinct.
- Fresh owner content/package/experiment approval and exact selected-store cutover receipt.
- Published supported-theme desktop/mobile/browser/keyboard/screen-reader evidence; actual variant, quantity, selling-plan, standard and accelerated checkout compatibility.
- Real consent denied/allowed/late/revoked behavior, Web Pixel linkage, paid/refunded non-test order reconciliation, and Shopify API field-shape evidence.
- Population full-path latency, CLS and capacity evidence on the intended Fly/PostgreSQL topology.
- Real encrypted off-volume backup/readback/restore/reopening drill and externally acknowledged alert destination.
- Legal identity/terms/privacy review, protected-data/distribution approval, incident owner, supported capacity, and any commercial pricing/billing publication.

Passing local checks authorizes none of these external actions and is not a launch or lift claim.

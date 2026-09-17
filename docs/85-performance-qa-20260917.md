# Performance QA — 2026-09-17

## Verdict

Bounded local performance QA **passes for the deterministic implementation and synthetic mixed-load rehearsal**. It does **not** pass the release's population-grade performance gate, and no performance receipt, serving-hold change, deployment, or production load test was performed.

The live mixed-load acceptance test is blocked honestly: the repository has no accepted partner cohort forecast from which to derive twice-peak traffic, and there is no approved scope for flooding the Fly/PostgreSQL production topology. A local SQLite rehearsal cannot substitute for that evidence.

## Acceptance contract checked

The current `adaptive-performance-a1` contract requires:

- selection-core p95 ≤ 2 ms locally;
- server decision p95 ≤ 100 ms;
- browser request-to-decision p95 ≤ 500 ms;
- panel-render p95 ≤ 16 ms;
- CLS p75 ≤ 0.05;
- at least 1,000 eligible decisions in at most five minutes;
- combined runtime gzip ≤ 10,240 bytes, v2 gzip ≤ 5,120 bytes, CSS gzip ≤ 1,024 bytes; and
- no external adaptive asset references.

The remaining PRD/test-store performance protocol additionally requires server p95 ≤ 150 ms under accepted mixed load, client p95 ≤ 1,000 ms with deterministic Original by 1,500 ms, real supported-device/geography LCP/INP/CLS distributions, queue age and database-wait observations, and a cohort-specific cap.

## Checks run

### Local asset and deterministic-core check

Command:

```sh
pnpm exec tsx --test tests/adaptive-performance.test.ts
```

Result: **3/3 passed**.

Measured from the current generated assets:

| Measurement | Result | Limit | Status |
| --- | ---: | ---: | --- |
| Combined runtime gzip (`adaptive-panel`, `adaptive-panel-v2`, `adaptive-vitals`) | 8,841 B | 10,240 B | Pass |
| Adaptive v2 gzip | 4,768 B | 5,120 B | Pass |
| Adaptive CSS gzip | 764 B | 1,024 B | Pass |
| Deterministic selection core p95 (10,000 samples) | 0.0049 ms | 2 ms | Pass |

Selection-core sample p50/p99/max were 0.0034/0.0108/0.4781 ms. These are local implementation timings, not browser or network timings.

### Isolated mixed-load rehearsal

Command:

```sh
pnpm exec tsx scripts/rehearse-mixed-load-v2.ts
```

The harness created a temporary isolated SQLite database with four tenants and ran the declared synthetic forecast at 2× for five seconds. It scheduled 16 decisions/s, 4 webhook accepts/s and 2 report reads/s.

| Measurement | Result |
| --- | ---: |
| Total operations | 110 |
| Decisions / webhooks / report reads | 80 / 20 / 10 |
| Errors | 0 |
| Decision p50 / p95 / p99 | 10.249 / 14.396 / 24.293 ms |
| Webhook p50 / p95 / p99 | 16.188 / 31.397 / 31.771 ms |
| Report p50 / p95 / p99 | 6.426 / 13.842 / 13.842 ms |
| Dispatch-lag p95 | 1.328 ms |
| Unexpected decision fallbacks | 0 / 80 |
| Tenant fairness | 4/4 tenants, 20/20 decisions each |
| Injected late-delivery Original fallbacks | 4/4 |
| Injected delivery / client deadline | 1,600 / 1,500 ms |
| RSS start / peak / end | 109,543,424 / 131,121,152 / 127,008,768 B |

The harness's prospective 150 ms server-decision check passed. The 1,500 ms client-deadline fault also behaved correctly: every delayed response returned Original. Twenty webhook jobs intentionally remained pending because this rehearsal measures concurrent acceptance, not worker processing; pending count was 20 and oldest age was 6,442 ms at capture. Database lock-wait duration was unavailable through Prisma.

### Additional 1,000-decision synthetic benchmark

To exercise the contract's minimum technical sample without touching production, the same harness was run in the isolated SQLite fixture for 60 seconds at 3× the declared forecast (`24 decisions/s`, `6 webhook accepts/s`, `3 report reads/s`). This produced **1,440 decisions**—above the 1,000-decision technical sample—in 61.470 seconds wall time, with zero errors:

| Measurement | Result |
| --- | ---: |
| Total operations | 1,980 |
| Decisions / webhooks / report reads | 1,440 / 360 / 180 |
| Errors | 0 |
| Decision p50 / p95 / p99 | 9.324 / 12.222 / 19.364 ms |
| Webhook p50 / p95 / p99 | 15.924 / 29.624 / 35.155 ms |
| Report p50 / p95 / p99 | 16.096 / 25.046 / 27.482 ms |
| Dispatch-lag p95 | 1.961 ms |
| Tenant fairness | 4/4 tenants, 360/360 decisions each |
| Injected late-delivery Original fallbacks | 4/4 |
| Pending jobs / oldest age | 360 / 61,454 ms |
| RSS start / peak / end | 99,188,736 / 144,801,792 / 144,048,128 B |

The synthetic 1,000-decision sample and local server budget pass are now evidenced. They still do not satisfy field performance or production-capacity acceptance: all decisions ran on one local SQLite writer, webhook work remained queued, and no supported device, geography, browser, Shopify proxy, PostgreSQL or Fly measurement was involved.

For completeness, a separate 25× burst attempt scheduled exactly 1,000 decisions but saturated the local SQLite fixture (1,232 errors, mainly database socket timeouts/transaction-start failures, decision p95 21,724 ms). It is retained only as a fixture saturation boundary and is not a product or production result. Raw capture: `/tmp/pagnetic-perf-qa-20260917/mixed-load-v2-1000-low-concurrency.json`; the failed burst's diagnostic output was not treated as a pass artifact.

## What remains open

- The additional local run now exceeds 1,000 decisions, but this is still a synthetic technical sample rather than a population sample.
- No supported iOS/Safari/Chrome device or geography sample was captured; LCP, INP and CLS distributions and confidence/sample reporting remain absent.
- No real browser request-to-decision or panel-render p95 was measured.
- No PostgreSQL/Fly/app-proxy capacity or queue-worker observation was measured.
- The synthetic input rates are declared fixture values, not an accepted merchant forecast and cannot establish a merchant cap.

Therefore the performance QA check remains **pending for Shopify/test-store acceptance**. The existing serving hold remains correct. This evidence supports local regression confidence only; it is not a production-capacity, launch-readiness, or population Web Vitals claim.

## Evidence identity

- Source checkout: `/Users/erenyigit/pagnetic-review-KqNpQ9`
- Mixed-load harness SHA-256: `09560eccad24a82ff879f4303bf0cfc0f67225e81a90b2a61c3f68929f00022f`
- Decision service SHA-256: `4a729087c39ec86c08881f6775f069e05ffc810bc82d3b49c11d1b5dcacae58a`
- Webhook inbox SHA-256: `ab43b0e7b5c02c01cfac3e79a2f3d194572fbca3594d5a4c4909000f979c452d`
- Report service SHA-256: `dd9e2a1cfe0d791fed90890612ed5ae34ece21d2c0ec499601bee77053875b55`
- Storefront runtime SHA-256: `f202a90185f31a30824b00c62876a5208618b61d961267fdddeded1ac2f492ec`
- Raw local captures during this run: `/tmp/pagnetic-perf-qa-20260917/mixed-load-v2.json`, `/tmp/pagnetic-perf-qa-20260917/adaptive-performance-test.txt`, `/tmp/pagnetic-perf-qa-20260917/local-budget-metrics.json`

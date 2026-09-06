# Local mixed-load rehearsal

Date: 2026-09-05. Scope: local AT27 engineering evidence only.

## What ran

`node --import tsx scripts/rehearse-mixed-load-v2.ts` creates a new private temporary SQLite database, applies the current migrations, and seeds four isolated merchants with registered v2 Original/Original deployments. It schedules real `resolveV2Decision`, financial webhook-inbox acceptance and experiment-report reads together for five seconds.

The declared synthetic pilot peak is 8 storefront decisions, 2 financial webhooks and 1 report read per second. The rehearsal uses exactly twice those rates: 16 decisions, 4 webhooks and 2 report reads per second. These inputs are an explicit fixture, not observed merchant traffic and not a store-cap claim.

It also executes four real decision requests whose response delivery is held for 1,600ms behind the 1,500ms client render deadline. The client boundary returns Original for all four. The existing generated-runtime VM regressions separately exercise the actual panel's deferred-response and consent-generation protection.

## Result

The machine record is [mixed-load-v2.json](./audit-2026-09-05/mixed-load-v2.json). The run completed 110 mixed operations with zero errors: 80 decisions, 20 durable webhook/job writes and 10 report reads. Decision latency was 10.066ms p50, 16.774ms p95 and 26.566ms p99. All four tenants completed 20/20 decisions; measured tenant p95 values ranged from 10.803ms to 18.922ms. There were no unexpected runtime fallbacks. All four delayed mobile deliveries produced Original at the deadline.

Webhook work deliberately remains queued because this rehearsal measures concurrent acceptance rather than a configured Shopify reconciliation worker. It records 20 pending jobs and a 6,445ms oldest age. RSS increased from 117,800,960 to 145,358,848 bytes, with a 144,982,016-byte sampled peak; allocator retention and the final point can exceed the sampled peak.

## What this does not prove

- Prisma does not expose database lock-wait duration, so the required DB-wait metric is explicitly unavailable here.
- Local SQLite does not establish PostgreSQL provider capacity, Fly-region performance, Shopify app-proxy latency or a safe merchant cap.
- The synthetic arrival rates are not a replacement for a forecast derived from the accepted partner cohort.
- This is not mobile-device Core Web Vitals evidence. Supported browsers/geographies still need before/after LCP, INP and CLS samples.
- Queue processing, age under a real worker, webhook replay from Shopify and reporting over production-shaped volumes remain release evidence.

Therefore AT27 advances from not started to local `IN_PROGRESS`; it is not VERIFIED and does not make the product design-partner deployable or public-acquisition ready.

## Refreshed 12:22 UTC checkpoint

After the deployment-lock correction and settled246-test release gate, the same declared fixture was rerun. The current machine JSON records110 operations, zero errors, decision p50/p95/p99 9.541/23.327/96.442ms, zero unexpected fallbacks,20/20 successful decisions per tenant and4/4 delayed-delivery Original fallbacks. The20 intentionally queued jobs have oldest age6,446ms. This refresh replaces no historical assertion above; the earlier figures remain dated evidence. All limitations still apply, and no production-capacity claim follows from either small run.

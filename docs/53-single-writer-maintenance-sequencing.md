# Single-writer maintenance sequencing

Date: 2026-09-06
Scope: S08 / AT25, supervised SQLite deployment
Status: deployed in reviewed-3cd01f44ba50; startup and two consecutive natural cycles verified

## Observed failure

On deployed `reviewed-65f2cb62a661`, the supervisor independently started automation and privacy every five minutes. At07:22:38Z, automationRun.create hit a5s database timeout; automation returned207 and privacy200 after roughly5s. At07:27:43Z, the next automatic cycle returned automation207 and privacy503, both after5s. Thus the problem was not limited to startup. Health remained200; the independent encrypted backup succeeded.

A bounded sequential authenticated run at07:26:12Z returned automation200 in483ms and privacy200 in7ms. This supports overlapping maintenance as a concrete contributor; it does not establish that every SQLite capacity/concurrency issue is solved.

## Correction

`requestLocalMaintenanceCycle` executes automation and then privacy sequentially. The production supervisor schedules that single bounded cycle every five minutes after completion. Each endpoint keeps its separate authentication and90s request deadline. A completed HTTP failure, including207, is retained as cycle failure but does not starve the other endpoint. Ambiguous network failures stop the cycle and retain the existing supervisor restart policy, because an aborted client request may still be executing server-side. Shutdown prevents the second request from starting.

Independent six-hour encrypted backups remain scheduled; no database timeouts, leases, reconciliation rules, failure statuses, privacy deadlines or launch gates were relaxed. This serializes only the supervisor's maintenance requests. It does not promise exclusivity against webhooks, manual calls or other processes, and it does not replace PostgreSQL for unattended multi-store use.

Changed paths:

- `scripts/lib/production-supervisor.ts`
- `scripts/supervise-production.ts`
- `tests/production-supervisor.test.ts`

## Local evidence

Pinned Node24.19.0: `pnpm exec tsx --test tests/production-supervisor.test.ts` passes10/10. Actual local HTTP regression holds automation open and proves privacy arrives only after its response. Further fixtures verify207 remains failure while privacy executes, ambiguous network failure stops the second request, and pre-aborted shutdown starts neither request. Existing child-process, timeout, periodic retry and independent-endpoint tests remain green. Focused ESLint passes.

## Deployment acceptance still required

Live follow-up on2026-09-06: retained Fly logs show consecutive natural cycles09:33:58Z (automation200/321ms then privacy200/8ms) and09:38:58Z (automation200/249ms then privacy200/8ms). This closes the bounded two-cycle observation for reviewed-3cd01f44ba50 alongside its successful startup and verified backup. Earlier intermittent maintenance207s were traced to upstream Shopify GraphQL500; do not promise uninterrupted external-service availability. No recurring5s SQLite timeout was observed in these accepted cycles. This remains single-writer supervised evidence, not multi-store capacity certification.

Run the integrated check after Sol's cutover package settles, then deploy the coherent reviewed release. Verify startup plus at least two natural scheduled cycles in Fly logs: both endpoints200, no recurring database timeout, healthy storefront and successful backup. Do not declare intended-environment resolution from these local tests or manually sequenced requests. Record source/image identity and exact timestamps in docs26.

# SQLite incident repair — 2026-09-18

## Observed incident and causal limits

Deployment 402fe1b55566b865f9a84092746bf9bd1c7e5f15 (Fly release 52) reported Prisma P1008 socket timeouts on automationRun.create, operationalAlert.upsert and acquisitionAngle.upsert during 17:40:53–17:41:24 UTC. A concurrent governance action returned 500 after 13.2 seconds, automation returned 207 after 35 seconds, and an outbox operation reported P2028 after exceeding its existing 5-second transaction limit. Health recovered at 17:41:33; later SELECT 1 succeeded in 20ms. These are parent investigation observations, not fresh production queries by this repair task.

Source confirms avoidable write amplification: every authenticated ensureMerchant previously rewrote four default acquisition angles concurrently and upserted entitlement, even for a fully initialized store; internal automation ran up to three merchants concurrently against one SQLite file. SQLite permits only one writer. A real migrated SQLite fixture reproduces P1008 when a 1.5-second transaction competes with a second transaction using two connections and a 1-second socket budget. Identical transactions succeed with one connection and the same socket budget. Short 150ms competition succeeded in the baseline, so concurrency alone does not explain every failure.

This proves a lock-contention mechanism and amplification paths, not the exact production transaction that held the writer. No lock-owner trace exists. The original incident may include long transactions or an external database client; neither is ruled out.

## Bounded implementation

- SQLite runtime datasource explicitly uses connection_limit=1, socket_timeout=2 and pool_timeout=5. Existing unrelated URL parameters and the file path are retained; non-SQLite URLs are unchanged. This queues single-process work before it takes competing database locks. No transaction timeout is increased.
- WAL, busy_timeout=2000 and foreign_keys are initialized sequentially on that one connection. Recovery-hold enforcement remains before exposure of the imported client.
- Existing fully initialized merchant access performs reads only. Missing/changed default angles repair sequentially; entitlement is created only when absent. Existing continuation/free-extension state is never reset. New-store capacity and existing transaction-client propagation remain intact.
- Internal automation processes merchants sequentially, retaining per-merchant local authenticated GraphQL context and per-merchant failure reporting.
- No transparent retries, new scheduler, paid resource, provider request, model call, merchant mutation, migration, public activation, Shopify submission, or QA-receipt rebinding is introduced by this repair. Existing job retry/lease/dead-letter controls are untouched. Financial authority and privacy/uninstall transactions remain unchanged.

Limits: transaction acquisition keeps Prisma's existing default maxWait (2 seconds) unless a caller already overrides it; queued ordinary operations retain the explicit pool budget. A writer in another process can still cause P1008 after the 2-second SQLite busy budget. Callers receive that failure; it is not replayed. A long transaction can also delay health reads on the shared connection. Serializing prevents same-process competing lock waiters, not all latency. No in-memory lock is claimed to coordinate external processes.

## Local verification

Six focused real-SQLite tests pass: URL policy; PRAGMA query_only proof of steady-state read-only access and seed repair without entitlement reset; eight rounds of concurrent two-tenant transactions/admin access/SELECT 1 with transaction-client ensureMerchant; baseline P1008 reproduction; single-connection success for identical held transactions; external-client writer failure within a 4.5-second test bound with no replay and subsequent SELECT 1 recovery.

Focused queue and privacy erasure regressions also pass (6 tests), including stale lease denial, dead letters and business-transaction rollback. Additional autopilot integration, financial adversarial, governance and privacy analysis regressions pass (35 tests), including cross-tenant rejection, uninstall disablement, frozen approval gates, financial provenance and privacy invalidation. TypeScript compilation and targeted lint pass before final documentation additions. All fixtures use temporary local migrated databases and remove only their own temporary directories.

Local fixture evidence is not production receipt or health proof. The parent task owns redeployment, current health/browser verification and truthful release-specific QA recapture. Old release QA receipts must remain old; never change their release identity to imply fresh execution.

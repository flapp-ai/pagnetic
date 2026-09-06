# PostgreSQL deployment contention regression

Status: reproduced and corrected on isolated PostgreSQL16; not a live provider deployment.

## Finding

Two actual Prisma clients concurrently installing a deployment with the same expected product revision exposed `P2002` instead of the required typed `STALE_REVISION`. An empty `RuntimeControl.upsert` update did not establish the write lock assumed by the subsequent receipt/revision reads. Database uniqueness prevented two same-revision records, but a raw constraint error was not a correct retry/idempotency response.

## Correction

`installV2Deployment` now performs a nonempty runtime-control self-update inside the same transaction before inspecting receipts or the current pointer. This acquires the row write lock and serializes deployment actions for that merchant. It retains decision lock ordering (runtime control before product/pointer). The runtime control's normal updated timestamp advances; kill-switch and activation/clear metadata are unchanged. No schema, historical registration, report or commercial authority changes.

All pointer revisions, authority callbacks, evaluation consumption, outbox events and action receipts remain atomic. The separate callback-failure test still verifies rollback of all changes, including creation of runtime control.

## Evidence

`scripts/lib/deployment-concurrency-rehearsal.ts` uses two actual database clients and its own synthetic product:

- Six rounds of conflicting actions at the same expected revision each yield one commit and one typed stale-revision rejection.
- Two simultaneous identical actions return the same deployment, with one creation and one idempotent replay.
- Exactly seven deployment revisions, seven receipts and seven outbox records remain, with one current product pointer.

Before the source correction, the actual PostgreSQL rehearsal failed on the expected typed-error assertion with `P2002`. After the correction, it passed. An initial test arrangement collided with another rehearsal's hard-coded product revision; the deployment race now owns a separate synthetic product rather than modifying the unrelated report fixture.

The refreshed complete PostgreSQL run also preserves15 seeded rows across61 tables,12 exclusive job claims, immutable financial/lifecycle/report interleavings and matching dump/restore readback. Its machine record now includes `deploymentConcurrency`. Focused SQLite deployment/runtime/autopilot tests pass23/23. This evidence covers actual local database contention, not provider network latency, multi-store operational capacity or real Shopify serving.

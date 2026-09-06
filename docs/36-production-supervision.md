# Production process and scheduler supervision

Date: 2026-09-05. Local S08/R11 evidence. Not a deployed restart, real scheduler run, storage approval or recovery-time certification.

## Entrypoint

`scripts/start-production.sh` now delegates to `scripts/supervise-production.ts`. The same image already ships Node, tsx and the backup TypeScript entrypoint. Before starting work it validates the listening port and the existing minimum32-character automation authority; no new credential is invented.

The supervisor runs migrations before the application, waits for health, then runs sequential maintenance and backup loops. The intervals remain five minutes and six hours. Each iteration completes or fails before its next interval; abandoned shell-loop PIDs are no longer invisible to the parent.

| Operation | Bound | Failure behavior |
| --- | --- | --- |
| Startup migration | 10 minutes | Stop; nonzero supervisor exit for platform handling |
| Initial application health | 2 minutes overall,5 seconds per request | Stop application group; nonzero exit |
| Local maintenance HTTP | 90 seconds | HTTP failure is reported; ambiguous network/timeout failure stops the application for restart |
| Encrypted backup child | 15 minutes | Terminate owned group; report failure; keep existing backup evidence unchanged |
| Child termination | SIGTERM, then SIGKILL after5 seconds | Includes owned descendants in the same dedicated POSIX process group |

The internal maintenance route uses HTTP207 for partial merchant failures. The supervisor therefore requires **HTTP200**, not merely `response.ok`. It does not log response bodies, shop data or authorization headers.

Aborting an HTTP caller does not cancel server-side GraphQL work. On an ambiguous maintenance connection/timeout failure, the supervisor stops its own application group instead of issuing further overlapping requests to potentially still-running work. Durable jobs and transactional state must recover after the platform restarts the process. Confirm actual Fly restart behavior and representative run duration before deployment; a90-second workload budget is not proof that all supported stores fit it.

Signals interrupt interval waits and active child processes. A migration error, failed startup, unexpected application exit or unexpected background-loop termination shuts down owned children. Operational failures remain visible through logs and persisted application/readiness evidence; this does not substitute for a configured remote alert destination.

## Local verification

Six tests in `tests/production-supervisor.test.ts` run under the pinned Node runtime:

- Real subprocess success, nonzero exit and bounded timeout.
- Shutdown of an active process and refusal to spawn after cancellation.
- A launcher with an actual HTTP-serving grandchild; group timeout closes the grandchild's listening server as well.
- Sequential failure/retry behavior with no overlapping task iterations.
- HTTP207 refusal and a bounded unhealthy startup wait.
- An actual loopback connection that never replies; the maintenance deadline aborts it.

All six pass. Focused uncached ESLint and shell syntax checks pass; the subsequent integrated Sol checkpoint passes233 tests, typecheck, ESLint and both builds. None of these tests runs the production migration or supervisor against the real database or Fly machine.

## Remaining operations work

Authenticated local encrypted cache retention and conservative storage preflight are now implemented and locally tested; see `docs/38-backup-cache-retention-and-headroom.md`. No real backup or user file was deleted. Off-volume credentials, key escrow, remote alert delivery, real restore drill, resource/load envelope and intended-environment restart verification remain release gates. Do not deploy the new backup/supervisor path into the existing environment before its backup configuration and legacy behavior have been reviewed.

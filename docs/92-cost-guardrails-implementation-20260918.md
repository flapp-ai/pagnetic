# Financial guardrails — 2026-09-18

The remote-alert webhook now reserves a durable global allowance before each network attempt. Maximum: 100 attempts per UTC calendar month across merchants, including HTTP errors, transport failures and retries. Configuration may lower this limit but cannot raise it above 100. Incident deduplication and the existing eight-attempt outbox retry ceiling remain in place. Local operational alerts remain OPEN and visible when remote delivery is deferred; outbox errors use ALERT_BUDGET_EXHAUSTED, ALERT_BUDGET_UNAVAILABLE or ALERT_BUDGET_CLOCK_ROLLBACK and delivery reports BUDGET_DEFERRED, never successful delivery.

Production defaults to /data/financial-guardrails; Fly explicitly configures that directory and ALERT_MONTHLY_SEND_LIMIT=100. Bootstrap must create a real directory mode 0700 and conservatively seed this month's predeployment attempts before rollout. Missing records are not silently initialized. Exported seedAlertBudget(directory, record) creates the record exclusively and never replaces existing accounting. Aggregate-only record monthly-alert-attempts.json (mode 0600):

```json
{"version":1,"month":"2026-09","attempts":100,"lastReservedAt":"2026-09-18T00:00:00.000Z"}
```

Seed attempts with the conservatively calculated existing aggregate, clamped to 100. Timestamp must be canonical UTC in the same month and no later than the first subsequent reservation. No merchant identities, payloads, endpoints, tokens or secrets are persisted. UTC month rollover happens only when the supplied current clock is later than the last reservation; backwards clock movement fails closed.

Exclusive directory locking serializes reservations. Writes use mode-0600 exclusive temporary files, fsync, atomic rename and directory fsync. Symlinks (including ancestor components), permissive directory/file modes, malformed records, missing records and lock contention all prevent network sends. A crashed reservation may consume allowance without sending, intentionally conservative. A stale lock requires operator inspection; do not delete/reset counters to restore allowance. This is a single persistent-volume accounting mechanism, not a distributed/multiple-replica budget. Missing/corrupt accounting requires explicit recovery based on verified history, not a zero reset.

Budget denial uses bounded outbox failures; deferred incidents may eventually become DEAD_LETTER under the existing retry ceiling and do not automatically resume next month. Operators must review local errors and deliberately replay still-actionable incidents when appropriate. Outside production, absent budget-directory configuration retains existing local/test behavior.

Rate-limit accounting has an absolute 10,000-live-bucket maximum. Expired entries are collected at capacity; new keys are denied conservatively if capacity remains full. Active entries are never evicted to reset their allowance. Invalid/overflowing numeric arguments are rejected. This remains process-local request throttling, not distributed abuse protection.

These safeguards bound this webhook's attempt count and local rate-limit memory, not the Fly account's total dollar charges or Make's entire account usage. No paid capacity/services, provider changes, merchant writes or external deployment are performed by this code package. The $15/month target still requires provider-plan/resource review and usage monitoring.

Local verification: 12 focused tests passed (alert delivery, persistent budget and rate limits); TypeScript no-emit check passed; focused ESLint passed. Tests include failed-HTTP allowance consumption, exhausted-budget zero-network retry and preserved local incident, UTC rollover, clock rollback, exclusive bootstrap, lock contention, cap enforcement, symlink/mode/corruption rejection, capacity denial without active-key eviction and expiry recovery.

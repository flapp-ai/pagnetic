# Confirmed uninstall: API maintenance selection — 2026-09-18

## Narrow repair

The internal automation route previously selected every merchant before requesting an offline Admin session. A merchant with confirmed uninstall and no remaining session therefore generated recurring 207 maintenance failures without useful work. Parent investigation also observed another merchant with a session remaining but an uninstall marker; session presence must not override the persisted stop signal.

API-dependent tenant maintenance now excludes only a runtimeControl with killSwitch=true AND reason exactly `App uninstalled`. Ordinary pauses, absent controls, null reasons, case-different text and a cleared kill switch remain selected. The Prisma query uses explicit OR branches for these permitted cases, including nullable relation/reason branches, rather than relying on SQL negation that could accidentally exclude nulls. No history, queues, sessions, alerts or financial records are removed or marked complete by selection.

Global public-funnel retention still runs after merchant maintenance, including when no merchants qualify. The separate internal privacy worker is unchanged and does not use this merchant filter. Existing legal privacy queues remain available to that worker. No new authority, local financial lane, provider request or billing-state transition is introduced.

## Financial/lifecycle scope and unresolved obligations

Financial webhook reconciliation stores a sanitized order identity and always fetches authoritative order facts through the Admin GraphQL callback. There is no persisted-canonical-document-only draining path in that worker. A missing-session uninstalled tenant could not reach reconciliation before this patch; pending work remains pending, not falsely successful.

The existing v2 local lifecycle worker can finalize eligible ENROLLMENT_CLOSED experiments using persisted facts without Admin. Uninstall cancels preparation and CLOSE_ENROLLMENT jobs but does not blanket-cancel FINALIZE_RESULT or financial reconciliation jobs. Excluding the API-maintenance route also means that route no longer reaches local finalization for a confirmed-uninstall tenant with a residual session. This is an explicit owner-review obligation: all queued financial/finalization history is preserved, and none is claimed processed, legally discharged or safe to finalize. A separately authorized post-uninstall policy/lane would be required to address it. This incident patch deliberately does not expand financial authority or change legal/privacy processing.

## Verification and release boundaries

A migrated real-SQLite fixture creates six merchants: missing control; kill=true/null reason; kill=true/ordinary safety pause; kill=false/exact uninstall reason; kill=true/case-different reason; kill=true/exact uninstall reason. The production helper selects exactly the first five and preserves all six merchant rows, pending FINALIZE_RESULT/RECONCILE_ORDER jobs and the global privacy request unchanged. Focused tests, TypeScript compilation and targeted lint verify the query without importing Shopify runtime or using provider credentials.

This task performs local edits/tests only. The parent task owns release identity, deployment, actual maintenance/health evidence and historical interrupted-run annotation. Orphaned records from a terminated old process are not evidence of live workers, nor may they be marked successful without execution.

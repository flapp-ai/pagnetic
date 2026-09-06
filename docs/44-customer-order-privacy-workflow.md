# Customer order privacy workflow

Release gate: **CODE-CONTROLLED PATH COMPLETE LOCALLY; PRODUCTION FULFILLMENT EVIDENCE OPEN.**

Latest follow-up: scheduled encrypted order-data copies, versioned storage keys, exact graph erasure, replay suppression, Shopify-account-owner-verified access after reinstall, explicit signed delivery confirmation and authenticated restore replay/reopening now pass locally. The intake checkpoint below is historical. Actual delivery in the intended Shopify environment, backup/retention/legal review, real off-volume recovery and over-limit handling remain open; no legal fulfillment claim is made.

Shopify supplies order identifiers for customer data-copy and redaction requests. A successful webhook acknowledgment is not fulfillment. Its documented workflow calls for fulfillment within30 days, subject to applicable retention obligations, and supplying the requested copy directly to the store owner. See [Shopify privacy-law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance). This is an engineering contract, not legal approval.

## Implemented intake

- Validate and normalize the exact supplied order list; reject malformed, unsafe numeric or oversized scope rather than silently dropping identifiers.
- Encrypt the versioned tenant/order scope with the independent field-encryption key. Do not retain customer names, emails, phone numbers or full webhook payloads.
- Keyed tenant/type/subject/request/scope idempotency; replay preserves processing status and attempts. A nonempty transactional update serializes simultaneous PostgreSQL intake.
- Independent queue primitives claim at most20 candidates per call, use60-second conditional leases with stale-token rejection, cap retries at10, and send unreadable scope/deadline/retry exhaustion to review. Strict scope reads reject plaintext, wrong-key, wrong-tenant and noncanonical scope. They do not require a merchant or Shopify session. Fulfillment and scheduler integration remain unimplemented; there is deliberately no generic completion method.
- Set a30-day deadline and `PENDING_ORDER_SCOPE`; missing order scope requires explicit review. Neither status claims delivery, erasure or completion. An existing merchant receives a deduplicated notice; an uninstalled merchant is not recreated.
- Additive SQLite migration18 introduces request queue fields and a keyed order-suppression table. Bounded staging and live code-path guards now exist (below); no fulfillment scheduler currently stages customer requests automatically.
- Intake checkpoint schema SHA256: `9af23d4778c2d7d84575f097a218405a2223d363d6185c3bf341f4e1bab3c21c`. The subsequent migration19/key-lifecycle source is recorded in docs45; no provider migration is approved/deployed to production.

Local privacy/foundation tests pass10/10, including exact-scope validation, deadline/retry escalation, stale lease rejection and rollback of merchant deletion when its receipt cannot be persisted. Actual isolated PostgreSQL rehearsal passes transfer/restore across62 tables, simultaneous duplicate intake, exactly one queue claim/reclaim between two clients and stale-worker rejection. These checks explicitly certify intake/queue mechanics only, not erasure or export. No real customer records were deleted and no live migration/deployment occurred.

## Fulfillment controls and remaining evidence

1. Implemented locally: scheduled encrypted export collection runs without an installed merchant or Shopify offline session. Exact graph erasure covers scoped v1/v2 financial, revision, attribution, measurement, identity and operational references with shared-identity/tenant guards and analysis invalidation. Collection or erasure alone is never completion.
2. Implemented locally: keyed order and identity suppression precede erasure and are enforced atomically in intake, in-flight canonical writes and legacy projections. Retained key history, reinstall and restore replay fail closed. Deferred fetch, lease replacement, replay and cross-tenant regressions pass.
3. Implemented locally: encrypted exact-scope access always requires fresh Shopify-account-owner verification. Same-generation access also requires the app `OWNER` role; an authenticated pre-uninstall v2 request can be recovered after a genuine reinstall without creating a new role. Explicit all-part delivery confirmation appends one signed audit, but keeps backup/legal review open and does not invent a recipient or email.
4. Implemented locally: the encrypted off-volume suppression journal is reapplied before a restored database can leave quarantine. Complete authenticated receipt replay reconstructs redaction and data-copy work. An audited technical release rechecks signed evidence and protected database/schema/source identity atomically; a `RELEASED` string is insufficient.
5. Required external evidence: real private off-volume upload/readback, independent key escrow, retention/deletion verification, retained-aggregate/legal review, an actual verified-owner download/attestation and full intended-environment recovery. Shop redaction remains `ACTIVE_DATA_ERASED_BACKUP_REVIEW`; data-copy confirmation remains explicitly legal-review-required.
6. Required controlled review: legacy receipts whose exact scope cannot be authenticated and requests that exceed bounded online export limits. They must remain review-required rather than silently broadened or truncated.

The corrected source-bound release evidence is `docs/release-checks/local-dLdHFh/manifest.json`:323/323 tests plus Node24 typecheck, lint, application/Shopify builds, PostgreSQL track/rehearsal and current statistical hashes. This still does not certify a real delivery, provider bucket, recovery drill or legal result. Keep the design-partner gate closed until those external controls are verified.

## Independent active-data graph audit

Read-only audit timestamp: 2026-09-05T13:00Z. The audit used the current SQLite schema and the customer-scope/intake/queue services; it did not delete customer data or edit privacy implementation code.

An exact scoped order can exist in all of these independently persisted branches:

| Branch | Exact records | Deletion/retention constraint |
| --- | --- | --- |
| Legacy financial | `StoreOrder`, child `StoreRefund`, child `OrderAttribution` | Deleting the exact tenant/order can cascade its legacy children, but the join to `Decision`/`Assignment` must be captured before deletion if linked pseudonymous data is in fulfillment scope. |
| V2 mutable financial | `OrderLedger`, `OrderLedgerLine`, `RefundLedger`, `AttributionV2` | `AttributionV2.orderLine` is `RESTRICT`, so exact attributions must be removed before lines/order. `RefundLedger.order` is `SET NULL` and retains `shopifyOrderId`; exact refunds therefore require an explicit tenant/order delete rather than relying on the parent relation. |
| V2 immutable financial | `FinancialOrderRevision`, `FinancialRevisionLink` | Revisions are independent of `OrderLedger`. Their canonical payload retains order, line/refund/transaction identifiers and signed assignment references; links cascade only when the exact revision is deleted. |
| Measurement/linkage | `CommerceEvent`, `Decision`, `Assignment`, `VisitorOutcome`, render records | A commerce event can retain order ID, checkout token and decision linkage. Order-linked assignment/decision scope must be resolved before destroying the financial join. `VisitorOutcome` is a derived per-assignment projection and cannot remain silently inconsistent after source erasure. |
| Durable ingestion | `WebhookInbox`, reconciliation `Job`, and related diagnostic/audit payloads | Inbox and job JSON can retain order identity after ledger deletion and can drive recreation. Terminal and leased work need exact cancellation/suppression semantics without disabling unrelated privacy or financial work. |
| Frozen aggregates | `ExperimentResultSnapshot`, qualification/baseline snapshots and post-finalization review records | These should never be silently rewritten. The product needs an approved rule distinguishing genuinely de-identified retained aggregates from pseudonymous personal data, plus a privacy-affected review marker where erasure changes an input to a frozen result. |

### Required transaction and replay order

1. Validate tenant and canonical order identifiers, then create the keyed suppression facts before deleting any active row. A suppression insert and the fulfillment state transition must use the privacy lease token and unexpired deadline as compare-and-swap authority.
2. Every legacy/v2 webhook accept path and the final canonical financial write transaction must check the same suppression key. Checking only before a Shopify fetch is insufficient: a worker may already hold the order snapshot when erasure begins.
3. Resolve the complete order-to-assignment/decision graph, invalidate or mark affected unfinished analyses, delete in FK-safe order, and recompute or anonymize derived projections under an explicit policy. Never broaden an unknown order scope to every merchant order.
4. Complete a privacy request only after active-data verification and the applicable export-delivery or erasure evidence is durable. A stale worker must not complete after losing its lease; a changed replay of the same Shopify request identity must conflict instead of creating contradictory fulfillment.
5. Restore must load the off-volume suppression/erasure journal before accepting webhook, reconciliation or report work. Reapply it to restored active data before the application can serve; backup expiration alone is not a replay guard.

### Adversarial cases still required

- Privacy suppression commits while an older financial worker is paused after fetch; the older worker resumes and cannot recreate any scoped revision, ledger, attribution or projection.
- A new/replayed order or refund webhook arrives after active erasure, after reinstall, and immediately after restore; all paths preserve suppression without affecting another tenant or another order.
- Two privacy workers contend, one lease expires, and only the current token can delete, export, record evidence or change final status.
- An order is linked to multiple lines and one visitor has multiple orders; exact scope removes only authorized records while the documented linked-identity policy remains deterministic.
- A real merchant graph containing experiments, result snapshots and `RESTRICT` relations completes shop redaction or rolls back atomically. A minimal merchant-only cascade fixture is insufficient evidence.
- Customer data export is an encrypted, expiring exact-scope artifact released only under verified owner/operator authority. Artifact generation and confirmed delivery are separate states, and neither requires an offline Shopify session after uninstall.

The operator UI must continue to return an allowlisted privacy-request summary only. Encrypted scope, subject hash, idempotency key and lease material are server-side data and must not be serialized to the merchant browser.

## Implemented suppression checkpoint

The shared runtime write lock now precedes order suppression lookup in v2 webhook intake, canonical financial reconciliation, legacy order/refund transactions and order-bearing Pixel ingestion. The canonical lookup occurs inside the final write transaction, after any external fetch. A suppressed webhook receives an authenticated204 acknowledgment rather than an endless Shopify retry; an already claimed inbox is marked suppressed with its order payload cleared. Unrelated financial/privacy work is not cancelled.

`stagePrivacyOrderSuppression` authenticates the encrypted scope and exact current lease, persists at most100 keyed order digests per transaction and refuses a skipped preceding batch. Repeating a batch is safe. It verifies authority again before committing. Suppression survives merchant deletion/reinstall because its tenant digest is independent of the merchant row ID. Raw order/shop identifiers are not stored in suppression rows.

Tests prove delayed-fetch rejection before any immutable revision or ledger write, new and same-event replay rejection, legacy write rejection, same-order/other-tenant isolation, reinstall preservation, checkout-event rejection and untouched unrelated orders. The integrated project test command passes267/267. Typecheck and focused uncached lint pass; actual isolated PostgreSQL transfer/restore and existing financial/lifecycle/report/deployment races pass on the62-table track. Synthetic financial test IDs were made valid positive Shopify order identifiers; the prior zero/alphabetic IDs cannot be supplied by a real Shopify order resource. The older financial race paused a worker while holding the new shared lock and awaited a competing commit, an impossible ordering; its interleaving now pauses immediately before that lock and verifies an older source cannot overwrite the newer committed revision.

This is not full fulfillment: existing linked records are not yet erased, inbox/job/visitor identity cleanup remains, suppression has not been wired to the scheduled privacy worker, and no independent off-volume journal has been applied after restore. Keep the current privacy lookup key stable; key rotation/history and an approved retained-aggregate policy remain explicit open gates. The267-test result is a test checkpoint, not a new source-bound full release/build or launch approval.

### Independent guard audit follow-up

Sol independently reviewed all guarded paths and passed the26 targeted financial/privacy/Pixel tests. The common runtime-lock ordering and delayed-fetch/reinstall/tenant isolation are sound. Before enabling any fulfillment worker:

- P0: replace the API-credential-dependent suppression lookup with a durable, versioned privacy lookup-key contract and verified rotation/reindex/restore behavior. Current `SHOPIFY_API_SECRET` rotation would otherwise hide existing tombstones.
- Recheck exact inbox lease authority inside the canonical financial transaction, not only immediately before it. Suppression already blocks erased-order recreation, but replacement/stale worker ownership needs an explicit transactional check.
- Record per-request suppression/journal evidence when different requests reuse a tombstone. Persist safe progress or deliberately replay from offset0 after a lost final response; caller cursor alone is not completion evidence.
- Production authority checks must use a live clock. Fixed `now` arguments are deterministic test injection, not a worker scheduling strategy.
- Duplicate Pixel acknowledgment currently happens before suppression lookup; it performs no new write. Decide response semantics without interpreting that acknowledgment as retained-data/fulfillment evidence.

### Implemented key/lease/progress follow-up

The first three audit findings above now have local implementation evidence. Production uses an independent durable privacy lookup key with retained previous versions, per-record fingerprints and fail-closed unknown/null-key detection. Authenticated legacy adoption cannot relabel a wrong key or out-of-scope tombstone; default CLI verification performs no writes. Exact canonical inbox authority is checked in the shared transaction both before writes and before commit, and crossing expiry rolls back financial records before replacement recovery. Per-request suppression scope/key/progress metadata now survives shared tombstone reuse; a terminal cursor verifies preceding records and safely replays. Its off-volume journal flag remains false.

At this historical checkpoint, integrated tests passed272/272 and targeted privacy/key/inbox recovery tests18/18, with typecheck, focused uncached lint and the then-current62-table PostgreSQL rehearsal passing. Details and production upgrade/escrow requirements: [45-privacy-lookup-key-lifecycle.md](./45-privacy-lookup-key-lifecycle.md). Full erasure, owner delivery and restore reapplication were still open here; the consolidated checkpoint below supersedes those code-gap statements. Legacy lost-scope review remains external.

Later independent review also corrected cross-key receipt duplication and incomplete legacy-adoption evidence. Current migration20 uses a stable per-store intake lock; exact retained-key replay remains one receipt, changed Shopify request scope conflicts, and missing expected tombstones block adoption. The final current checkpoint is274/274 tests plus typecheck/focused lint and actual63-table PostgreSQL rehearsal. Docs45 records the precise upgrade and two-phase rotation contract. Full fulfillment remains open.

## Current consolidated checkpoint

The sections above retain the sequence of audit findings and intermediate evidence. The current implementation supersedes their former code-gap wording:

- Exact suppression, graph discovery, FK-safe financial/identity cleanup, analysis invalidation and verification run under bounded leased authority. Encrypted graph evidence remains for controlled backup/legal review; unrelated tenants/orders and shared out-of-scope identities fail closed.
- The encrypted sidecar plus complete authenticated receipt inventory are reapplied on restore before service. Exact redaction requests re-run; exact data-copy requests are recollected to owner-ready state. An authenticated evidence/audit chain is required for technical reopening, and neither startup nor PostgreSQL transfer trusts an unsigned state string.
- Customer copies can be reviewed after uninstall/reinstall only with fresh Shopify account-owner verification and a different authenticated installation generation. Explicit all-part delivery attestation appends a signed audit without granting a role or claiming backup/legal completion.
- Current corrected source-bound evidence is323/323 tests and the manifest `docs/release-checks/local-dLdHFh/manifest.json`; actual local PostgreSQL rehearsal covers69 tables. Completed-delivery replay, retained recovery-key rotation and the emitted restore-manifest handoff are covered. See docs46–48 for stable workflow and recovery contracts.

The remaining gate is evidence, not an inferred green state: real independently escrowed keys, off-volume provider upload/readback/retention, full recovery, actual verified-owner delivery, over-limit/lost-scope review and legal/retained-aggregate decisions. No production fulfillment occurred.

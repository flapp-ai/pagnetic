# Immutable financial facts and frozen reports — v2.2

2026-09-05. This closes a code-level S03/S04 reporting gap; it is not a live financial reconciliation or launch approval.

## Authority

`FinancialOrderRevision` retains the sanitized canonical financial payload, Shopify source watermark/hash, first observed time and canonical revision hash. `FinancialRevisionLink` retains only server-verified tenant/experiment/assignment/product-line linkage. Identical facts fetched later are idempotent. A source revision that is stale for today's `OrderLedger` still remains available to reconstruct an earlier cutoff. Current ledger and visitor projections remain operational views, not immutable report authority.

The additive SQLite migration is `20260905140000_financial_revisions`. PostgreSQL has its separate reviewed provider migration `20260905101252_61b881806941`; neither rewrites historical migrations. `Experiment.finalResultSnapshotId` is a nullable legacy-safe pointer. All reads validate both snapshot identity and experiment/merchant ownership; an unrelated pointer cannot authorize a report.

No mutable current row is backfilled into an invented historical observation. Existing linked v2 orders without immutable evidence produce `IMMUTABLE_FINANCIAL_HISTORY_MISSING` until authoritative replay supplies the relevant facts. Legacy experiment reports retain their old protocol and routes.

## Financial cutoff

`loadFinancialAsOfV2` reconstructs the assigned-visitor outcome from immutable revisions through the experiment's frozen financial cutoff:

- Select complete order facts by source time, not webhook receipt time. Missing historical line/payment allocation, a newer incomplete pre-cutoff revision or contradictory equal-watermark facts blocks reconciliation.
- Include verified focal lines only. Preserve zero-order assigned visitors in the analysis. Test orders, gift-card products, unsupported selling plans and foreign-tenant data cannot contribute.
- Verify that successful capture/sale transactions satisfy the obligation by the cutoff; unknown or later capture timing cannot certify earlier paid revenue.
- Reconcile refund allocation by its source time and actual successful transaction timing. Late delivery of pre-cutoff facts is included once. Later settled refunds do not change the frozen amount. Unknown historical refund timing/allocation and inconsistent equal-watermark refund amounts stay explicit gaps.
- For split refunds, full settlement is no earlier than the last successful component transaction. The adapter now requests `processedAt` on refund transactions. Shopify models this as a nullable `OrderTransaction` field; an existing Refund object alone does not prove successful payment reversal. See [OrderTransaction](https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderTransaction) and [Refund](https://shopify.dev/docs/api/admin-graphql/latest/queries/refund).

The policy is conservative where Shopify's latest representation cannot establish historical allocation. Do not substitute a newer line total, silently zero the order, infer a settlement timestamp or create a monetary headline to bypass this uncertainty. The current policy and its real-store missing-timestamp/refund behavior still require intended-store validation.

## Finalization and later facts

Financial revision writers and report finalization serialize on the experiment row. Finalization reads one coherent fact set, stores an immutable snapshot, and pins its ID atomically. Every subsequent report request returns that exact version, even if today's ledger or health state differs. Provisional snapshots are not final claim authority.

New financial revisions received after finalization are retained and produce `V2_FINANCIAL_REVISION_AFTER_FINALIZATION` audit evidence. They do not overwrite the historical report. S06 displays a separate Pagnetic-review notice. A later refund is not automatically evidence that an earlier report was invalid; operator review must distinguish genuinely new out-of-window events from newly discovered pre-cutoff errors. Automated review/alert handling remains part of S08.

Financial revisions and their links contain pseudonymous order/assignment context and must follow privacy deletion/retention policy. Merchant deletion cascades revisions and revision links. Targeted order/visitor privacy cleanup and bounded retention must explicitly include these new models; raw canonical payloads must not appear in merchant exports, public previews or telemetry.

## Verification evidence

- Nine synthetic as-of tests cover post-cutoff settlement, late pre-cutoff refund delivery, missing historical authority, equal-watermark conflicts, newer incomplete revisions, future captures, refund conflicts, test/foreign-tenant exclusion and split settlement timing.
- Twelve financial-adversarial database tests include immutable revision replay/stale retention, different current vs historical net amounts, final snapshot pinning after a later change, audit emission and cross-tenant report rejection. Combined focused run: 21/21 passing.
- The existing financial/lifecycle suites remain passing; schema-to-migration diff reports no difference. Typecheck and focused no-cache ESLint pass. Sol's integrated S06 checkpoint passes 175 tests plus application/Shopify builds; see the tracker for exact checkpoint scope.
- `scripts/lib/report-concurrency-rehearsal.ts` uses two actual PostgreSQL clients and the production reconciliation/finalization functions. A financial update commits while finalization is waiting for its lock; the frozen report includes 8,000 minor units. A later update moves the operational projection to 4,000 while the same report ID/payload remains at 8,000. The full migration, three concurrency scenarios and dump/restore rehearsal passes across 60 tables; machine output is `docs/audit-2026-09-05/postgres-rehearsal.json`.

Still unverified: intended-store GraphQL/refund timing contracts, tax-inclusive refunds, real reordered Shopify delivery, production scheduling/alerts/privacy retention and full load behavior. No production migration, deploy, customer message, financial transaction or commercial setting was changed by this work.

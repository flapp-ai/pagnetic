# Audited recovery reopening and customer data-copy delivery

Status: code-controlled local checkpoint, 2026-09-05T17:24Z. No production restore, customer delivery, legal determination, provider change or deployment was performed.

## Why this exists

A successfully decrypted SQLite file is not safe to serve automatically. It may predate customer privacy requests, contain data that has since been erased, or omit current delivery work. Pagnetic therefore treats restore, privacy replay, technical release and application cutover as separate authorities.

## Quarantine and replay contract

Every newly restored database receives one signed `_PagneticRecoveryHold`. Fresh databases with no hold can start normally; a restored database cannot start or transfer to PostgreSQL while the hold is HELD or READY. Legacy, malformed, duplicated, unsigned or extra hold rows fail closed.

The replay step requires:

- the exact verified backup manifest and artifact identity;
- a complete authenticated privacy-receipt inventory read twice without change;
- every retained receipt-encryption key needed by that inventory;
- the original request deadlines and exact encrypted order scopes;
- a bounded deterministic fingerprint of the restored protected data and schema.

Redaction receipts run through the existing leased suppression, discovery, financial deletion, identity deletion and verification path. Unfinished data-copy receipts are reconstructed and collected to `EXPORT_READY_OWNER_DELIVERY`; replay never invents delivery. A request already in `OWNER_CONFIRMED_SECURE_DELIVERY` is accepted only after its retained storage/lookup keys, exact receipt scope and signed request/shop/actor/part-count/timestamp delivery audit verify. It is not recollected, its deadline is not extended and expired/purged download artifacts need not be recreated. Missing or tampered terminal delivery evidence fails promptly instead of entering the collection loop. Unreadable, legacy, ambiguous, expired unfinished or over-limit work remains review-required.

The protected-data fingerprint is deterministic and bounded: at most256 tables, 1,000,000 rows,128 MiB encoded input and1 MiB per row, using primary-key or full-column ordering in pages of200. Exceeding a bound blocks reopening for controlled review instead of producing a partial identity.

## Audited technical release

`releaseRecoveryHold` is the single shared transaction used by the release CLI. It locks the one READY hold, then revalidates:

- the hold signature and exact current replay-evidence pointer;
- replay-evidence signature, hash, nonfuture freshness and ordered timeline;
- backup manifest/artifact hashes, schema fingerprint and protected-data fingerprint;
- complete current receipt-inventory digest and retained-key fingerprints;
- the current erasure/suppression graph;
- bounded immutable operator, privacy, backup, legacy-inventory and receipt-quiescence references.

Only then does it append one signed `_PagneticRecoveryReleaseAudit` and atomically change the hold to signed RELEASED. Concurrent release has one winner. Any audit-write, identity, freshness, key, inventory, data, schema or graph failure rolls back the release.

Startup and SQLite-to-PostgreSQL transfer do not trust the word `RELEASED`. They verify the signed hold, the referenced signed replay evidence, the referenced signed release audit and all cross-record bindings. New backups are signed with the active backup key. Historical manifests and recovery chains select the exact matching active/previous key from the bounded retained ring; rotation with the old key retained remains valid, while absent, corrupt or ambiguous history fails closed. Restoring an older backup creates a new recovery cycle and resets the current evidence pointer; an earlier release audit cannot authorize the new cycle. Evidence and release audits are append-only.

Technical release does not start the app, point `DATABASE_URL`, lift a kill switch, enable storefront serving, send a message or approve legal fulfillment. Those remain explicit operational actions after isolated validation.

## Owner data-copy access and confirmation

Customer data-copy artifacts remain encrypted, exact-scope, contiguous and expiring. Manifest, download and delivery confirmation require a fresh Shopify token exchange proving that the authenticated subject is the current Shopify account owner.

During the same install generation, access also requires the app's persisted OWNER role. For a request captured before uninstall, the encrypted v2 request scope includes a domain-separated installation-generation hash. After a genuine reinstall, a different current generation plus fresh Shopify account-owner proof allows recovery without recreating a local app role. This exception is request-specific and does not grant general app authority.

Downloads append access-only audit entries. After the same verified owner has downloaded every current unexpired part, the owner may explicitly attest secure delivery and submit a bounded immutable evidence reference. Pagnetic stores only its HMAC digest and one signed tenant-independent `PrivacyDeliveryAudit`, then sets `OWNER_CONFIRMED_SECURE_DELIVERY`. Replay, another actor, missing/expired parts and audit tampering fail closed.

This state means only that the verified owner attested to delivery of the active encrypted copy. `backupErasureVerified` stays false, `legalReviewRequired` stays true and no customer contact address or email delivery is invented.

## Rehearsed evidence

The corrected source-bound Node24 release gate at `docs/release-checks/local-dLdHFh/manifest.json` passed:

- 323/323 automated tests;
- TypeScript, full ESLint, React Router production build and Shopify app build;
- current SQLite/PostgreSQL migration parity;
- actual isolated PostgreSQL transfer, concurrency and dump/restore rehearsal;
- current independent statistical source hashes.

Focused recovery fixtures cover fresh database startup, restore quarantine, redaction and data-copy replay, authenticated terminal-delivery replay after artifact purge, operational-reference leakage, signed release, concurrent single-winner release, rollback, active-key rotation with retained historical validation, wrong/missing/malformed key history, stale/future/mutated evidence, oversized fingerprints, malformed/legacy/extra rows and a second recovery cycle. Customer access fixtures cover same-generation role enforcement, verified reinstall recovery, all-part confirmation, merchant uninstall survival and signed-audit tamper rejection. The exact final-audit reproduction now returns `data-copy-delivery-authenticated` instead of `PRIVACY_RECOVERY_STEP_LIMIT`.

The PostgreSQL rehearsal currently covers69 tables,15 seeded rows and12 exclusively claimed jobs plus deployment, lifecycle, financial, privacy and report interleavings. This is local fixture evidence, not a managed-provider cutover or measured full RTO.

## Operator sequence

1. Restore to a new absolute SQLite path using the authenticated remote manifest; never overwrite the damaged source. The restore command exclusively preserves the exact verified input beside it as `<NEW.sqlite>.verified-manifest.json` and prints that path. A collision leaves the existing file untouched and removes only the newly created unusable database.
2. Keep serving, outbound jobs and billing disabled.
3. Run `pnpm exec tsx scripts/replay-privacy-receipts.ts /absolute/NEW.sqlite /absolute/NEW.sqlite.verified-manifest.json` with the complete retained receipt/recovery-key environment.
4. Review zero-unresolved replay evidence, exact receipt inventory, privacy/backup/legacy policy and isolated application/schema checks.
5. Run `pnpm exec tsx scripts/release-recovery-hold.ts /absolute/NEW.sqlite /absolute/NEW.sqlite.verified-manifest.json evidence-id operator-identity privacy-review-ref backup-review-ref legacy-inventory-ref receipt-quiescence-ref` with real immutable references.
6. Verify startup and intended database transfer accept the signed chain while serving remains disabled.
7. Only under the incident runbook, stop old writers, deploy the matching reviewed release, point one writer at the released database, reconcile health/financial queues, and separately authorize serving.

## External evidence still required

- Independently escrowed backup, privacy lookup/storage and receipt-key histories.
- A real private S3-compatible upload/readback, isolated restore and measured full application RPO/RTO drill.
- Provider retention/deletion and retained-aggregate/legal review.
- An actual Shopify-account-owner manifest/download/confirmation flow in the intended embedded environment.
- Controlled resolution of legacy lost-scope and over-limit export requests.
- Alert destination, dead-man monitoring, scheduler, single-writer/capacity and production database evidence.

Until those exist, this package closes the ordinary code-controlled recovery/reopening gap only; it does not authorize deployment or claim compliance.

# Durable privacy lookup-key lifecycle

Engineering contract: implemented locally. Production setup/legacy adoption, off-volume journal and full fulfillment remain launch gates. Docs46 adds storage-key fingerprints/history and encrypted data-copy processing; its22-migration/64-table schema supersedes the historical migration20 identity below.

## Why a separate key

Order suppression must survive Shopify API credential rotation. Production no longer derives its lookup key implicitly from `SHOPIFY_API_SECRET`. `PRIVACY_LOOKUP_KEY` is an independent durable random secret, at least32 characters; never reuse the API credential or field-encryption key. It belongs in the host secret store and independent recovery escrow, not source control or command-line arguments.

`PRIVACY_LOOKUP_PREVIOUS_KEYS` is a JSON array containing every previous lookup key still referenced by retained records. At most8 distinct active/historical/legacy keys are accepted. New privacy receipts/tombstones record a domain-separated SHA256 key fingerprint, not the secret. Workers can resolve the exact historical request key by fingerprint. The merchant operations query includes all retained key versions without sending any key/hash/scope to the browser.

Every protected order-write transaction checks the recorded key fingerprints before lookup. Missing historical keys fail closed with `PRIVACY_LOOKUP_KEY_HISTORY_MISSING`, even for a different order. This deliberate operational stop prevents a forgotten key from making older tombstones invisible. Do not remove a key merely because it is no longer active.

## Upgrade existing data

SQLite migration19 adds nullable `lookupKeyId` fields/indexes to privacy receipts and suppression rows without rewriting old hashes or identifiers. Migration20 adds a stable public-store-digest intake lock for cross-key replay serialization, including after uninstall. Separate PostgreSQL migrations `20260905132658_43e08d53369d` and `20260905134440_a94d9a90a726` are generated/reviewed locally but not deployed. Current canonical schema SHA256: `4e446ae480d34b44c953463689067cf9bc6931ddad7dd1a3674dc5449021bd59` (63 tables).

Null fingerprints are legacy, not automatically trusted. They stop protected writes with `PRIVACY_LOOKUP_LEGACY_REINDEX_REQUIRED`. Preserve the exact old key in `PRIVACY_LEGACY_LOOKUP_KEY`. If it was API-derived, this is the old API-secret value from when those records were created—not the current credential after rotation.

On the target host, with the intended database and independently restored field key configured:

1. Keep serving/activation closed and take a verified recovery copy.
2. For each legacy order-scoped request, run `pnpm exec tsx scripts/adopt-legacy-privacy-key.ts --request-id ID`. This default path is read-only.
3. The command decrypts authenticated original scope, verifies tenant digest using the supplied legacy key and checks each referenced tombstone against that exact order list, in500-row reads. Wrong key, wrong scope, orphaned/unreadable scope or mismatched identity cannot be silently relabeled.

   For redaction, every expected scope tombstone must exist; shared rows originally staged for another request are verified too. Missing rows keep adoption blocked. A legitimate unstaged legacy redaction must first be staged by the exact-scope authorized privacy worker; do not bypass this check by relabeling a request or inventing a completion record.
4. Only after reviewing successful verification, add `--apply` for that exact request. The transaction changes key fingerprints only; it preserves request status/deadline, original encrypted scope, financial records and tombstone digests. A mismatch rolls back all changes. Repeating a successful adoption is safe.
5. Recheck that no order-scoped receipt or suppression record has an unknown/null key fingerprint. Orphaned legacy tombstones need recovery of original authenticated scope or explicit operator investigation; do not invent a key association.

The repository script does not load arbitrary local files, print secrets or accept secrets as arguments. No production adoption has been run by this checkpoint.

## Rotation and restore

- Use a two-phase rollout: first distribute the new key in every reader's retained-key set while leaving the old key active; then promote the new active key and retain the old one. This avoids unnecessary fail-closed stops on an older reader. Existing scope/tombstones stay readable; newly received requests use the new fingerprint. Shopify API rotation alone leaves this configuration unchanged.
- Restore the complete required key history from escrow together with the independent field/backup keys. Missing history stops protected writes. This is a safety stop, not proof that erased data has been reapplied or that recovery meets RPO/RTO.
- An independent off-volume suppression/erasure journal must still be restored and applied before restored customer records can be served or reported. Do not reopen solely because key coverage succeeds.
- There is intentionally no automatic old-key deletion or bulk rekey command. Pruning/reindexing requires a verified retained-record and backup inventory and the approved retention policy.

## Evidence and boundaries

Tests cover unchanged lookup authority after API rotation, previous-key tombstone lookup, forgotten-key fail-closed behavior, request-specific historical key resolution, strict configuration, read-only verification, idempotent application and rollback on an out-of-scope tombstone. The integrated suite passes272/272 at this checkpoint. Typecheck, focused uncached lint and actual isolated PostgreSQL transfer/restore/concurrency pass. These are local engineering checks, not production deployment or full privacy fulfillment.

Suppression batches also persist per-request scope-hash/key/progress evidence, including when another request already owns the shared tombstone. A terminal cursor can safely replay only after verifying all preceding tombstones. This local record explicitly leaves `backupJournalVerified=false`; it never claims external journal delivery, customer erasure or overall completion.

## Rotation replay correction

Intake searches candidate idempotency identities under all retained keys while holding the stable per-store intake lock. Exact replay keeps the original receipt, scope, key identity and processing status. For new Shopify data-request IDs, changed order scope or subject conflicts instead of creating another fulfillment. The previous scope-based receipt identity remains readable for exact legacy replay; lost old identity/scope cannot be invented.

An older process missing a newly recorded fingerprint fails intake closed; it cannot create a second receipt under its own old key. Actual PostgreSQL tests cover simultaneous cross-key intake without a merchant row and verify exactly one receipt. This supplements, rather than replaces, the two-phase key rollout and complete historical-key inventory.

Final migration20 checkpoint: integrated tests274/274, typecheck, focused uncached lint and actual63-table PostgreSQL transfer/restore/concurrency pass. No production secret, migration, key adoption, customer deletion or deployment was performed.

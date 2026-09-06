# Backup cache retention and storage headroom

Status: local code and regression evidence, not intended-environment operations approval.

## Local cache policy

`scripts/backup-sqlite.ts` validates `BACKUP_LOCAL_KEEP` (default8, minimum2, maximum30) before creating a backup. Only after the new snapshot has passed remote readback, authenticated restore and publication does it call `pruneLocalVerifiedBackups`.

The cache directory must be absolute, private against group/world writes, an actual directory rather than a symlink, and not the filesystem root, home directory or working directory. Scanning is limited to1,024 entries. Only generated artifact-manifest names are candidates. Each candidate must have a valid keyed manifest, matching configured destination, successful restore proof, plausible timestamps and ciphertext checksum/size; both files must be regular, singly linked entries. Unknown files, malformed/old-key manifests, destination mismatches and substituted links are preserved and reported for operator review.

The newest configured number of valid copies and the current latest pointer are preserved. The latest proof must be at most24 hours old. Before any deletion, the retained latest ciphertext is downloaded again from the configured store and its checksum verified. An outage, stale proof or corruption prevents pruning. Each candidate and current pointer are rechecked immediately before unlinking the exact obsolete local artifact and its manifest. The object-store adapter has no remote-delete method.

The helper supports a no-deletion dry run. Pair deletion is not filesystem-transactional: interruption between the two unlinks can leave an orphan manifest for review. The checks are not a defense against a malicious concurrent same-UID process. Run one supervised backup writer; do not run competing manual prune jobs. A retention failure after successful backup publication is reported separately and exits nonzero. It does not rewrite the new verified proof or claim that an earlier successful backup failed.

## Free-space preflight

Before snapshot creation, `assertBackupHeadroom` reads actual database and WAL sizes and available filesystem blocks with exact integer arithmetic. Its conservative estimate is twice database-plus-WAL size (plus one page). It budgets one estimate for ongoing source growth, six for scratch snapshot/encryption/readback/restore copies and one for the new encrypted cache copy. It sums demands on the same device and adds a256MiB reserve per filesystem; separate filesystem capacity cannot offset a full source volume. Measurement errors and insufficient space fail before creating snapshot files or uploading anything.

This is deliberately conservative and may reject a backup even when its actual footprint would fit. It is not a reservation, quota, continuous disk monitor or guarantee against concurrent database/other-process growth. Existing old cache entries count against available space; the process never deletes them first to force a new backup through. If capacity is already insufficient, the operator must restore safe headroom under an approved procedure. Remote retention/versioning, local orphan review and host crash cleanup remain separate policies.

## Verified evidence

Pinned Node24.19.0 focused run passes12/12: ten actual SQLite/encryption/restore/retention tests and two exact headroom accounting tests. Real backup roundtrips execute the filesystem preflight. Retention tests cover dry run, five-copy pruning, unchanged remote objects, unrelated files, stale proof, remote outage, malformed manifests, unsafe links and restoration of the retained latest row. Headroom tests cover shared/separate devices, exact reserve boundaries, integers beyond JavaScript's safe-number range and invalid measurements. Focused uncached ESLint passes.

Only disposable fixture artifacts were deleted; no real backup or user file was removed. Production snapshot/prune/restore has not been run. Current live Fly read-only inspection still shows release13, a single started machine in FRA, and no installed backup-encryption or S3 credential secrets. That does not substitute for checking an approved bucket, separate key escrow, actual RPO/RTO drill, restart behavior or delivered operational alerts.

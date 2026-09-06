# Tigris storage setup evidence — 2026-09-05

Status: storage setup and compatible runtime activation verified. Independent key retrieval is owner-confirmed. The supervisor's first automatic encrypted backup passed. Full application recovery and customer-facing v2 launch acceptance remain open.

## Runtime activation — 2026-09-05T20:34Z

- Deployed reviewed source to existing machine, version14, image `deployment-01M1SMB1C9M9M9BE491RJZ9GKN`, image digest `sha256:d4e04be3d58b9c3250acf03856fc0c22ad000ba595b8763e8d61ff0c23d26fc0`. Source manifest was unchanged; the remote application build passed.
- All25 migrations applied; one merchant retained. All14 secrets are now Deployed, including the eight previously staged values. Existing secret digests remain unchanged.
- Public health returned200 and Fly reports1/1 passing checks. The single-machine replacement had a brief startup interruption; this was not a zero-downtime deployment.
- Supervisor automatically generated `pagnetic-4e0f8d71-6ee6-4ff9-97e5-bb1e59f8ec54.sqlite.enc` at20:34:33.780Z,1,773,568 encrypted bytes; ciphertext SHA256 `aeda400570264d36c2e0fa4a37ce8e20d1e912a76696fcd0a70a63b86287c148`. Tigris readback and isolated integrity/FK restore passed at20:34:35.342Z. Encrypted privacy journal also uploaded/read back, zero rows.
- Backup schedule is immediate on startup then six hours after each completed run. First automatic run observed; a second six-hour recurrence has not yet been observed.
- Privacy scheduler returned200. Initial automation returned207 with a SQLite timeout during concurrent startup work; a bounded authenticated retry after startup returned200. Record this contention for operational acceptance; do not call recurrence/load testing complete.
- Billing remains disabled. V2 serving, shadow, model and offer publication are explicitly disabled. This deploy does not publish Shopify extensions or approve public launch.

Activation preflight: live release13 has one merchant, 11 applied migrations and zero `PrivacyRequest` rows. There are no existing request rows requiring legacy lookup-key adoption in this database. Accepted source manifest reverified unchanged before deployment. Compatible runtime deployment started with v2, shadow, model and offer publication explicitly disabled; billing remains disabled.

## Destination and least privilege

- Owner-created standalone Tigris organization: `bilgi org`; bucket `pagnetic-backups`, single region `fra`, Standard tier. This is not assumed to be billed through Fly.
- Endpoint `https://t3.storage.dev`, S3 signing region `auto` (not a storage-location change), application prefix `pagnetic-backups/`.
- Created policy `pagnetic-backup-writer`, attached to dedicated key `pagnetic-fly-backup-writer`. Exact non-secret policy: `tigris-backup-writer-policy.json`.
- Real SDK verification passed eight checks: encrypted object PUT/GET, prefix list, conditional overwrite returns412, delete returns403, out-of-prefix PUT returns403, organization-wide bucket listing returns403, anonymous GET returns403, original encrypted object remains unchanged.
- Initial verification showed organization listing was not denied implicitly. Added explicit `s3:ListAllMyBuckets` deny and reran successfully. No other bucket or customer data was accessed.
- Tigris IAM documents only a subset of AWS condition operators. The key can list the dedicated bucket; provider-enforced prefix-only listing and mandatory conditional-write headers are not claimed. Object read/write is prefix-restricted and deletes are explicitly denied. Application writes use `If-None-Match: *`. Keep unrelated data out of this dedicated bucket. These limitations do not establish tamper-proof/WORM storage or approve a retention policy.
- Two61-byte encrypted, non-customer permission-test objects remain under `setup-check-*.enc`; no production data was deleted. Final test object: `setup-check-304b03fc-d629-4622-a17c-08ab16ccd6e5.enc`, ciphertext SHA256 `58b187d10e9bca25cb5495596db9354dafcd10d3182f476322344ad796322e20`.

## Recovery keys and Fly configuration

- Generated independent backup-encryption and privacy-lookup keys. Retained their values and the one-time storage credential only in process memory until writing them directly into the owner's existing protected `Pagnetic Recovery` note. No secret values were printed in chat, written to project files or passed as process command-line arguments.
- Retrieved only the six named existing Fly application secrets into memory and added them unchanged to that note. No field, assignment, automation, funnel or Shopify key was rotated. Verified all expected values were present without exposing their text, then closed the note's lock and verified Notes showed the password-required locked screen.
- Owner reports the note uses iCloud and subsequently confirmed independent retrieval with "verified". This is owner-attested off-machine key retrieval, not an independently executed full application recovery drill.
- Staged eight new configuration values through `flyctl secrets import --stage` over stdin. `flyctl secrets list` confirms Staged, while the six prior keys remain Deployed. No app restart, migration or new image deployment was requested.

## Actual release13 database backup

FileVault is OFF on the local Mac, so no plaintext production database was downloaded here. A one-shot helper bundles the existing backup implementation (no replacement backup algorithm), runs on the current Fly machine, and receives only required storage configuration through SSH stdin. Temporary DB files remain on the encrypted Fly data volume under a private scratch directory and are removed by the existing backup/restore cleanup paths.

- Live machine: `d8d1497a937658`, Frankfurt, Node22.23.2, release13 image `deployment-01M1Q6NJ0MKBEKF1CJZ84TZZWJ`.
- Snapshot uses SQLite `VACUUM INTO`; no live database file is overwritten or migrated.
- Artifact: `pagnetic-6c2e74ce-63f1-4bdb-af82-9ff84a7d91a4.sqlite.enc`.
- Manifest object: same name plus `.json`, inside the configured bucket/prefix.
- Created: `2026-09-05T19:34:41.708Z`; encrypted size1,245,184 bytes.
- Ciphertext SHA256: `353034c719149e3c0ffdca5099ea12f22348550bc5bdbf6c7003bfaf6bfbb42e`.
- Source schema SHA256: `95237a9b0be62c9ba240157232e4f789b6b4160b6664796fc845099804069d89` (release13 database, not the v2 migration target).
- AES-256-GCM; upload, download, plaintext checksum verification, SQLite integrity and foreign-key checks passed. A signed recovery hold was applied only to the isolated restored copy. Remote signed-manifest upload/readback also passed.
- Restore/readback verification finished at `2026-09-05T19:34:42.584Z`, measured794ms for the implementation's upload/readback/DB-restore interval. This is NOT a full application RTO, independent-host recovery or post-snapshot privacy-receipt replay certification.
- The release13 snapshot has no privacy journal in its signed manifest. Legacy receipt inventory/backfill and retained-key adoption still require review before v2 activation; do not infer missing requests from that absence.
- Local encrypted cache and signed latest-proof file are on Fly `/data/backups`. Non-secret helper source is `tmp/run-tigris-bootstrap-backup.ts`; code-only remote helper files are under `/app/.pagnetic-storage-setup.GhYTiZ`. No secrets are embedded in them.

## Remaining steps

1. Independent protected-note retrieval confirmed by the owner. Do not solicit keys/screenshots in chat.
2. Review legacy privacy/key/receipt coverage, storage-retention choice and monitor destination. No automatic remote expiry or paid monitoring was enabled.
3. Compatible runtime activation and first automatic backup are complete. Longer-run scheduling/load acceptance and startup contention remain to be checked.
4. Complete full isolated application recovery, supported Shopify/browser/commerce and other PRD acceptance. This storage checkpoint does not close the launch goal.

Sources: [Tigris IAM policy support](https://www.tigrisdata.com/docs/iam/policies/), [conditional operations](https://www.tigrisdata.com/docs/objects/conditionals/). CLI and actual provider responses, not documentation alone, establish the bounded checks above.

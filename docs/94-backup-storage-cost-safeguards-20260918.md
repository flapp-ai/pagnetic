# Production backup storage safeguards — 2026-09-18

## Scope and known inventory

Parent investigation measured the dedicated Tigris bucket at 283 objects / 278,450,159 retained bytes (about 0.28 decimal GB), with a 5,222,400-byte database. This task did not contact the provider or change that inventory. Existing credentials allow ListBucket, GetObject and PutObject, not DeleteObject. No permission expansion, remote deletion or retention changes are implemented.

## Guard before each upload

Only NODE_ENV=production enables the economic guard. Each adapter serializes its PUT calls. Across adapters and manual/supervisor processes on the same mounted volume, a fixed mkdir lock at /data/.pagnetic-backup-s3-upload.lock excludes overlapping list-and-PUT sections. Lock acquisition fails immediately on overlap or a crash remnant. It never automatically removes a stale lock; the acquired directory's identity is checked before release. An owner must confirm no uploader remains active before resolving a stale lock. Missing/unwritable /data fails closed.

Every guarded PUT lists the entire bucket with ListObjectsV2, deliberately without Prefix, so encrypted database snapshots, privacy companions, manifests and unrelated current objects all count. Pages request at most 1,000 entries; at most four pages and a shared 10-second abort budget are allowed. Permission failures, provider errors, malformed sizes, missing/cyclic pagination and an incomplete inventory at the page cap block the upload. No cached inventory bypasses these checks.

| Setting | Default and immutable maximum | Override |
| --- | ---: | --- |
| Retained bucket bytes including proposed object | 4,000,000,000 | BACKUP_BUCKET_MAX_BYTES may only lower |
| Individual object bytes | 67,108,864 (64 MiB) | BACKUP_OBJECT_MAX_BYTES may only lower |

Overrides must be positive decimal safe integers; larger or invalid values fail closed. No additional environment setting is required. Listing and lock limits cannot be increased through environment variables. The existing upload timeout remains 120 seconds and SDK retry maximum remains three attempts; there is no added application replay. Downloads and restore verification are unchanged.

## Failure and retention tradeoff

Reaching either cap blocks future uploads and propagates the error. It does not mark a failed backup successful or refresh backup evidence. Existing freshness/hold monitoring must surface stale backup proof. Old backups and privacy journals/manifests remain retained, so the owner needs a reviewed retention decision before the cap is reached; this guard does not silently purchase capacity or delete recovery evidence.

At four backups/day with three uploaded objects each, one listing page per PUT adds approximately 360 listing requests per 30 days. Four-page listings and existing SDK retries can multiply this; PUT, readback GET, retention readback and restore requests also count. The page limit bounds each guard's request growth, but this is not an account-wide request quota. Actual backup sizes and cadence determine when the byte cap or inventory-page cap blocks uploads.

## Verification and residual limits

Local pure-helper and filesystem tests cover lower-only configuration, all-page aggregation/exact cap, oversized object and cumulative rejection, denied/malformed/cyclic/excessive inventory, FIFO serialization without replay, overlapping adapters, stale-lock preservation and refusal to unlock a replaced directory. All six guard tests pass; the combined backup/headroom regression run passes 20 tests, including corruption/failed-upload refusal, privacy-journal restoration and retention safety. TypeScript compilation, targeted lint and whitespace checks pass. Temporary test directories are the only removed files. No provider requests, paid capacity, deployment, push or backup-bucket mutation were performed by this task.

The fixed filesystem lock coordinates this one deployment volume, not a second machine, a different mounted volume, another credential holder or unrelated uploads. Listing reflects current visible objects, not hidden versions, incomplete multipart uploads, in-flight external writes or account billing categories. Account-wide other buckets/copies, network egress, provider pricing changes and other services remain outside this guard. Consequently these safeguards reduce scoped storage/request risk but cannot guarantee an absolute $15 account-wide bill. Provider billing controls and an owner-approved retention policy are still required for a hard financial ceiling.

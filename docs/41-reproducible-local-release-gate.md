# Reproducible local release gate

Status: full local release gate passed on the corrected checkpoint recorded in `docs/release-checks/local-dLdHFh/manifest.json`:323/323 tests, typecheck, lint, application/Shopify builds, current25-migration PostgreSQL track, real isolated69-table transfer/concurrency/restore/reopening rehearsal and matching independent statistical source hashes. Later source edits require a new run. This is not an intended-environment or launch certificate.

## Run

Use the pinned project Node/pnpm runtime:

```sh
pnpm exec tsx scripts/check-release.ts
```

The gate captures a deterministic SHA-256 source manifest, runs the full `pnpm check`, checks that the separate PostgreSQL migration track is current, runs the actual isolated PostgreSQL transfer/concurrency/restore rehearsal, and requires the recorded independent statistical calibration to pass and match its current source hashes. PostgreSQL server/client utilities must be installed for that local rehearsal; no existing database is targeted. A final source capture must match the initial capture exactly. Concurrent source edits make the gate fail rather than attach passing tests to a different build. Generated theme assets are included, so stale generated assets must first be rebuilt and reviewed before a stable release run.

Only after all steps pass does the script exclusively create a new `docs/release-checks/local-*/manifest.json`. It records runtime, exact local commands, timestamps, source files/bytes/hashes and the statistical evidence hash. It explicitly records deployment, design-partner and public-acquisition approval as false. Failed checks never publish a passing record.

To compare the present source to a previous record:

```sh
pnpm exec tsx scripts/check-release.ts --verify /absolute/path/to/manifest.json
```

This second command verifies only source identity; it does not rerun tests, prove authenticity of an untrusted manifest, verify external services or assert that the matching code is deployed. These are local checksum records, not cryptographically signed CI provenance. Hosted CI and a container build still require an actual chosen runner; no repository, remote workflow, Git commit, container image or cloud job was created by this change.

## Source and privacy boundary

The manifest uses a versioned explicit scope: root build/deployment/package configuration and recognized source/static-file types under `app`, `extensions`, `prisma`, `public`, `scripts`, `storefront` and `tests`. It excludes environment secrets, databases, temporary output, logs, dependency caches and generated extension distribution folders. The template `.env.example` is included. Paths, lengths and digests are recorded, not file contents. Unsupported new file types/root input paths must be added to the manifest scope before being relied on as release identity.

Source symlinks, missing required package/schema/Docker files, oversized files and files changing during hashing fail closed. This does not reserve the worktree or replace a reviewed immutable release commit/archive. Release work must still stop concurrent editing while the gate runs.

The Docker context exclusions also cover environment-file variants, local Shopify state, generated local route/cache state, database files and private-key file extensions. Existing `.env` was already excluded. No current secret value was inspected. The later Fly build-only run successfully built the actual container with this ignore file; see docs43. This does not establish runtime startup/recovery or exhaustive inspection of image contents, and no new release was deployed.

## Local evidence

Fixture tests pass for deterministic identity, changed/added source detection, forged file-list rejection, runtime-file exclusion, source-link rejection and missing required files. Foundation lease tests remain green; production lease enforcement was not weakened. The current manifest records315 source files and source SHA-256 `875470a389d874efc4d2137c9c652523517106a2e0582f6bea37da4e75fc7275` under Node24.19.0, completed at `2026-09-05T17:55:14.628Z`. Documentation edits are outside that explicit source scope; use `--verify` after documentation-only updates and rerun the full gate after any source change.

The complete command includes local build/test/schema-track and isolated PostgreSQL rehearsal checks only. Managed-provider PostgreSQL operation, real Shopify requests, billing verification, mobile/assistive-technology QA, encrypted off-volume recovery, remote alert delivery, real performance and owner/legal decisions retain their separate PRD gates.

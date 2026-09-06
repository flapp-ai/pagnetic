# Astra final acceptance audit — 2026-09-05

Candidate reviewed: `docs/release-checks/local-rvqmid/manifest.json`, source SHA-256 `f8d8b17bd675c21b086d58438c9a1e01a332dfce5beef78cc97d8d127d071787`, 25 SQLite migrations, schema SHA-256 `a64d9a707d974d867772b9d512978f850c28783aa19b577699d6281d745ffcfd`.

Decision: local release candidate requires the corrections below. Design-partner deployment and public acquisition remain unverified. Passing the recorded 322-test gate does not cover the newly reproduced completed-delivery replay case.

## Findings sent to Sol as one correction batch

| ID | Finding and evidence | Acceptance required |
| --- | --- | --- |
| A01 | `privacy-recovery.server.ts` recognizes a ready data copy but not `OWNER_CONFIRMED_SECURE_DELIVERY`. An isolated migrated database with actual intake, collection, owner access and signed delivery confirmation reproduced `PRIVACY_RECOVERY_STEP_LIMIT`; its signed delivery audit remained present. Reproduction: `pnpm exec tsx tmp/astra-final-audit-completed-copy.ts` under Node 24. | Restore and replay a completed delivery, verify its signed audit and original scope/deadline, and preserve completion without recollecting. Missing/tampered audit must fail promptly. Purged/expired downloaded artifacts must not turn authenticated historical delivery into a retry loop. |
| A02 | `recoveryBackupKey` selects only the active backup key; startup authenticates the historical release chain with that key, despite the configured retained-key history. Changing the active key invalidates verification of the previous release chain. | Verify a released database through active-key rotation with the old key retained; reject absent or corrupted required history. Verify startup, restore/release and transfer using authenticated key selection. |
| A03 | `restore-sqlite.ts` removes its downloaded verified manifest with its scratch directory, while both following recovery commands require that manifest as a local file. The documented command sequence does not produce this required input. | Preserve the exact verified manifest at an explicit exclusive output path, report that path, and exercise the CLI handoff without undocumented retrieval or overwriting existing files. |

The existing release, receipt and migration evidence remains useful for its tested scope. Sol owns the bounded correction batch and refreshed release evidence. No unrelated product rewrite is requested.

## Production facts checked during this audit

- `flyctl status -a pagnetic --json`: release 13, one started FRA machine, old image `deployment-01M1Q6NJ0MKBEKF1CJZ84TZZWJ`, passing recorded health check. The new candidate is not deployed.
- `flyctl secrets list -a pagnetic --json`: existing assignment, automation, field-encryption, funnel and Shopify credentials are present. No backup encryption, privacy lookup, S3 credential or incident-destination secret is listed. Machine environment also lacks the corresponding new recovery/alert configuration.
- Existing company/support identity and Fly deployment authorization are preserved. Do not ask the owner to repeat them.
- The 16 local production-readiness failures are not 16 proven missing values on Fly. Intended-environment checks must be performed after the actual missing configuration is supplied.

## Remaining launch evidence

The implementation tracker remains the R01–R14 / S01–S10 / AT01–AT30 ledger. Real backup upload/readback/recovery and key escrow, delivered alerts/scheduler observation, supported Shopify browser/commerce/privacy flows, intended-store capacity and financial convention, human content review, and legal/distribution/partner qualification are still unverified. They cannot be inferred from fixture counts or approved automatically by this audit.

No production deployment, migration, secret change, external message, real order, or commercial action was performed during this audit.

## Sol correction evidence — 2026-09-05T17:55Z

All three bounded findings are corrected in the final source-bound candidate `docs/release-checks/local-dLdHFh/manifest.json`, source SHA-256 `875470a389d874efc4d2137c9c652523517106a2e0582f6bea37da4e75fc7275`.

| ID | Correction | Evidence |
| --- | --- | --- |
| A01 | Terminal data-copy replay authenticates the retained request scope/key and signed request/shop/actor/part-count/timestamp delivery audit, then returns without collection or deadline changes. Missing/tampered audits fail immediately. | The exact isolated reproduction now prints `Replay: {"ok":true,"action":"data-copy-delivery-authenticated"}` and one audit. A real SQLite backup→restore→receipt replay regression passes after confirmed artifacts expire and are purged, preserving original completion/deadline and rejecting tampered/deleted audits. |
| A02 | A bounded active/previous recovery key ring selects the exact historical manifest/recovery key. New backups continue to use the active key. | A released database starts after active-key rotation with the old key retained and passes recovery authority before a synthetic PostgreSQL connection failure. Missing or malformed history rejects startup; manifest replay/release CLIs select by authenticated key ID/signature. |
| A03 | Restore preserves the exact downloaded verified manifest beside the new database at `<NEW.sqlite>.verified-manifest.json` and prints that path. | Backup tests compare exact manifest bytes, reject overwrite and prove a manifest collision leaves the existing manifest untouched while removing only the database created by that failed restore. Docs28/47 use the emitted path directly in replay/release. |

Focused recovery/privacy/backup/access tests pass25/25. The refreshed full Node24.19.0 release gate passes323/323 tests, typecheck, full ESLint, React Router production build, Shopify app build, current PostgreSQL migration track/rehearsal and statistical hashes. The local PostgreSQL evidence remains69 tables,15 seeded rows and12 exclusive claims. These corrections change no Prisma schema or migration count.

Decision after correction: the bounded local acceptance defects A01–A03 are closed. The production facts and external launch evidence above remain unchanged; this is not deployment approval or compliance evidence.

## Astra independent correction acceptance — 2026-09-05

Verified the final `local-dLdHFh` manifest against the current source: exact match. Independently reran the original completed-delivery reproduction: replay succeeds with `data-copy-delivery-authenticated` and retains one delivery audit. Independently reran the four targeted recovery-reopening, privacy-recovery-integration, sqlite-backup and customer-privacy-access suites: 25/25 pass, zero failures. Read the corrected terminal replay branch, retained-key startup authentication and verified-manifest restore handoff. A01–A03 are accepted for their bounded local scope; no further correction batch is outstanding.

The full 323-test/build/PostgreSQL release gate is Sol's recorded source-bound evidence, not a second full run by Astra. The completion monitor has been removed because Sol finished. Production setup and live acceptance remain open as listed above; the launch goal is not complete and the new candidate has not been deployed.

# V2 legacy activation regression

Date: 2026-09-06  
Scope: AT29 activation dispatch only  
Status: corrected locally and compatible backend deployed; v2 activation remains disabled

## Finding

The activation entry point previously selected the orchestrator only from the process-wide `PAGNETIC_V2_ENABLED` flag. It did not inspect the plan that the merchant approved. Consequently, turning the flag on could send an already-approved v1 `VERIFYING` plan into the v2 orchestrator. If the v2 gates passed, that path could create a v2 baseline experiment and deployment from authority that approved the legacy protocol. This violates the PRD requirement that new metrics and protocols must not be applied retroactively and AT29's legacy compatibility contract.

The test-store plan observed before this correction is a legacy approval (`safetyPolicyVersion=pilot-safety-v1`) with no v2 deployment history. No live state was changed while diagnosing or correcting the defect, and `PAGNETIC_V2_ENABLED` remains false.

## Correction

`AutopilotPlan.orchestrationProtocolVersion` is now the persisted plan-origin discriminator:

- `autopilot-plan-v1` is the database default and migration backfill for every pre-existing plan.
- `pagnetic-autopilot-plan-v2` is written explicitly only when a new plan is prepared with the v2 protocol enabled.
- New approval records bind the same discriminator.
- Historical approval records without this new field remain valid only as legacy approval authority. Their absence can never authorize v2.
- V2 classification additionally requires both frozen experiment protocol snapshots to name `pagnetic-effect-v2`. A legacy marker paired with either v2 snapshot, or an unknown, contradictory, malformed, or approval-mismatched v2 marker, fails closed as `PROTOCOL_MISMATCH`.
- Generic advancement always sends persisted legacy plans to the legacy orchestrator, regardless of the global flag. A persisted v2 plan enters v2 only when the flag is enabled; otherwise it returns `V2_DISABLED`.
- Direct v1/v2 orchestrator entry points also reject a plan from the other protocol.

Plan hashes and old approval JSON were not rewritten. The additive migration changes only the new discriminator column and index, preserving existing plan ID, state, approval record, plan hash, content, and transition history.

## Changed paths

- `prisma/schema.prisma`
- `prisma/migrations/20260906030000_autopilot_protocol_boundary/migration.sql`
- `prisma/postgresql/schema.prisma`
- `prisma/postgresql/migrations/20260906070900_3f3882ab2dde/migration.sql`
- `prisma/postgresql/source-version.json`
- `app/services/mvp-v2.ts`
- `app/services/autopilot-preparation.server.ts`
- `app/services/autopilot-orchestrator.server.ts`
- `app/services/autopilot-v2-orchestrator.server.ts`
- `tests/autopilot-integration.test.ts`

## Evidence

Pinned runtime: Node 24.19.0.

- `pnpm exec tsx --test tests/autopilot-integration.test.ts` — 16/16 pass.
- The new migration regression applies the SQLite migration to a populated pre-change plan and verifies that `VERIFYING`, `planHash`, and `approvalRecordJson` are unchanged while the row is backfilled as `autopilot-plan-v1`.
- The activation regression recreates a historical approval with no discriminator in its approval JSON, enables the v2 flag in-process, advances the plan, and verifies that it starts the legacy `autopilot-aa-v1` experiment with lifecycle version 1 and creates zero `DeploymentVersion` or `ActiveDeployment` rows.
- Boundary fixtures verify that a persisted v2 plan returns `V2_DISABLED` while the feature is off and that a legacy marker paired with frozen v2 protocol snapshots returns `PROTOCOL_MISMATCH`, with zero experiment or deployment writes.
- The v2 integration path verifies that a newly prepared and approved v2 plan persists and approval-binds `pagnetic-autopilot-plan-v2`, then reaches the v2 baseline through the generic dispatcher.
- `pnpm typecheck` — pass.
- Focused ESLint on the changed TypeScript files — pass.
- `pnpm exec tsx scripts/prepare-postgres-track.ts --check` — provider-specific schema track current. The generated PostgreSQL migration is additive and reviewed locally; no database was changed.

## Release boundary

This correction was deployed on 2026-09-06 under `reviewed-65f2cb62a661`, Fly image `deployment-01M1TSC2XS2SC02491GCXA3VX3`. Live migration26 backfilled the original plan as `autopilot-plan-v1`; its VERIFYING state, plan hash and approval JSON hash matched the recorded predeployment values. Public health200 and Fly1/1 checks passed. Full local `pnpm check` completed with exit0 before deployment; the exact total count was unavailable in the truncated recovered output. PostgreSQL track freshness passed separately, not a new full PostgreSQL rehearsal.

V2, shadow, model, offer publication and billing remain false. Enabling v2 does not migrate or reinterpret an old approval; a fresh v2 plan and fresh merchant approval are required. Subsequent production-path inspection found the explicit selected-store cutover receipt and authenticated activation-evidence writer still missing; Sol is implementing that separate package. This bounded regression is not proof of complete S10 or launch readiness.

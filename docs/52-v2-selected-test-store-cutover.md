# Selected test-store v2 cutover

Status: deployed in reviewed-3cd01f44ba50 on2026-09-06; not activated. The v2
serving flag remains off. Live evidence and remaining gates are in docs55.

## Contract

The migration is an explicit, store-and-product-scoped workflow. It does not
reinterpret a legacy approval when `PAGNETIC_V2_ENABLED` changes.

1. Only a Shopify store named in `PAGNETIC_V2_CUTOVER_SHOPS` can display or
   submit the cutover action. The authenticated app route still requires an
   active Pagnetic `OWNER` or `OPERATOR` role.
2. The action performs a current Shopify catalog sync, then compares the exact
   product source version and hash shown to the operator. Drift aborts before
   any retirement or receipt is committed.
3. `beginSelectedTestStoreV2Cutover` locks merchant runtime authority and writes
   one idempotent `SELECT_TEST_STORE_V2_CUTOVER` `ActionReceipt`. In the same
   transaction it preserves the legacy plan hash, approval and transitions;
   invalidates only that legacy plan; closes an Original/Original QA experiment
   without rewriting its registration; and activates an Original-serving
   migration hold. An active real experiment, mismatched experiment history or
   unrelated safety hold aborts the whole transaction.
4. The preparation job is keyed by the receipt and selected product, refreshes
   Shopify catalog data again, and creates a v2 plan only from that exact current
   source. Ordinary loader preparation cannot race a receipt into a new legacy
   plan. A product with insufficient source or no supported opportunity produces
   the existing honest abstention state; it does not receive invented claims and
   Original remains served.
5. The v2 plan hash and approval record both bind the receipt ID. A new owner
   approval is required; the legacy approval can never authorize v2.
6. Theme verification uses the authenticated Shopify App Bridge extension
   inventory plus a recent, consented storefront runtime acknowledgement for
   the exact product after the fresh approval. It records `ThemeActivation`
   `verifiedAt`/`verifiedBy` and only the two checks actually observed:
   `placement` and `original_fallback`. The fallback acknowledgement must be a
   v2 `KILL_SWITCH_ACTIVE` Original response. Both records are backed by
   immutable evidence receipts bound to the runtime event digest and app
   release.
7. The remaining checks enter through `scripts/record-v2-qa-evidence.ts`. It
   requires an already authorized active `OWNER` or `OPERATOR`, an actual local artifact,
   a credential-free opaque reference to its private evidence-store object and
   explicit `--apply`. The server computes the artifact SHA-256 and derives the
   result; no merchant/client `PASSED` flag is accepted. `NOT_APPLICABLE` is
   permitted only for accelerated checkout and Shop Pay capability evidence.
8. Hold release requires every `QaEvidence` key and its immutable
   `RECORD_V2_QA_EVIDENCE` receipt to match the exact cutover, theme, template,
   pre-deployment context and `APP_RELEASE`. It clears only the exact migration
   hold. Missing evidence or a changed safety reason remains fail-closed. A
   durable release audit makes a successful retry idempotent.
9. Baseline activation additionally requires `PAGNETIC_V2_ENABLED=true`, exact shop
   membership in `PAGNETIC_V2_ENABLED_SHOPS`, and all
   existing v2 activation gates. This code does not turn that flag on.

## Local evidence

Focused regression coverage is in:

- `tests/test-store-cutover.test.ts`: selected-store permission, exact receipt
  replay, legacy approval and QA-registration preservation, stale source,
  wrong product, active real experiment, unsupported-product abstention, fresh
  v2 approval binding, real theme/runtime evidence, incomplete QA and unrelated
  safety-hold rejection, exact release replay.
- `tests/autopilot-preparation-worker.test.ts`: a pending ordinary loader job
  cannot race a receipt-bound worker into a legacy plan; the cutover job forces
  one fresh catalog read.
- `tests/autopilot-integration.test.ts`: v1/v2 dispatch remains protocol-bound,
  disabled v2 fails closed, and a receipt-bound v2 plan can start only after
  complete activation evidence and explicit hold release.

The first pinned Node 24.19.0 focused run on 2026-09-06 passed 30/30 tests across
those three files, followed by TypeScript, focused ESLint, Prisma validation and
PostgreSQL-track source-parity success. The real local PostgreSQL rehearsal then
matched 15 transferred rows across 69 tables, exclusively claimed 12 jobs and
passed its existing concurrency/restore suite. This is local provider-track
evidence, not a managed production cutover.

The pre-follow-up pinned-runtime `pnpm check` passed 336/336 tests. After closing
the executable evidence/reselection gaps, the bounded Node 24 run passed 32/32
relevant integration tests plus TypeScript and focused ESLint, followed by the
React Router production build, Prisma validation and PostgreSQL-track
source-parity check. The final pinned Node 24.19.0 `pnpm check` passed 338/338
tests, TypeScript, full ESLint, the React Router production build, rebuilt theme
assets and `shopify app build`. Its release-source SHA-256 was unchanged before
and after the run:
`3cd01f44ba501a0ab381be8cabe387b1582c9a4a66e8812bc4757266d3d4548d`.
No deployment, feature-flag change or provider write was part of this package.

## Exact test-store execution after deployment review

1. Keep `PAGNETIC_V2_ENABLED=false`; set
   `PAGNETIC_V2_CUTOVER_SHOPS=test1-eczm2zce.myshopify.com` and deploy the
   reviewed source/migrations.
2. Open Pagnetic Overview as an authenticated owner/operator. On the legacy plan
   select **Record cutover and sync source**. If Shopify changed the source,
   reload and review before retrying.
3. Wait for receipt-bound preparation. If the result is **No responsible test
   path yet**, stop: Original is correctly retained. The currently observed
   Complete Snowboard description is too limited to justify fabricated message
   claims. The explicit reselection UI appears while the migration hold remains
   active. A new product must first be active and freshly synced; a Shopify
   draft is deliberately excluded. Selecting it writes a new idempotent receipt
   linked to the prior receipt and is allowed only before any v2 plan,
   deployment or experiment exists.
4. If a sourced v2 opportunity exists, an owner reviews and approves the new
   plan. This is a fresh approval, not a migrated approval.
5. Save the `adaptive-panel` block on that product's published template. The
   exact migration hold is still active, so Original remains authoritative.
6. Deploy the reviewed configuration with `PAGNETIC_V2_ENABLED=true` and
   `PAGNETIC_V2_ENABLED_SHOPS=test1-eczm2zce.myshopify.com` only after
   confirming that exact hold and selected scope. Before this point the endpoint
   correctly returns `V2_DISABLED`; after it, the still-active hold returns
   `KILL_SWITCH_ACTIVE`, `ORIGINAL`, and no assignment. Load the exact storefront
   product with analytics and preferences consent, observe that response, then
   select **I saved it — verify now**.

   The runtime enabled-shops list is separate from `PAGNETIC_V2_CUTOVER_SHOPS`:
   cutover permission alone never enables serving, orchestration or ingestion
   behavior. Empty runtime membership fails closed even with the global flag on.
   An `App uninstalled` hold is not the migration hold. After reinstall, follow
   the explicit owner-approved recovery workflow; do not clear an unrelated hold
   or reuse invalidated plan approval merely to continue this sequence.
7. Capture the remaining scoped QA evidence from actual tests: mobile, desktop,
   standard checkout, accelerated checkout, Shop Pay (or evidenced absent/N/A),
   consent flows and performance. Store each artifact in the approved private
   evidence bucket and run, using the product's internal Pagnetic ID and the
   pre-authorized owner or operator actor key:

   ```sh
   APP_RELEASE=<deployed-release> pnpm exec tsx scripts/record-v2-qa-evidence.ts \
     --apply \
     --shop test1-eczm2zce.myshopify.com \
     --product-id <pagnetic-product-id> \
     --check-key mobile \
     --applicability APPLICABLE \
     --artifact-file /absolute/path/to/captured-evidence \
     --artifact-ref qa-artifact:v1:<sha256-private-object-key> \
     --actor-key <existing-operator-actor-key> \
     --idempotency-key v2-qa:<cutover>:mobile:v1
   ```

   The private object must use a non-semantic SHA-256 key; the receipt therefore
   cannot contain a URL, credential, filename or shopper identifier. The CLI
   does not upload or publish the artifact and cannot grant itself a role. It
   records only after the private object and exact operator authority exist.
8. With all nine authenticated receipts present, use
   **Activate verified Original baseline**. The server rechecks receipt, source,
   approval, theme, every QA record and the exact migration hold atomically.
9. Verify the product-specific Original deployment acknowledgement and rollback
   before allowing any message-test phase.

## Evidence still external

- AT01 needs the deployed route, migrated production database and actual
  product-specific Shopify acknowledgement.
- AT19 requires the published theme/template checks, including custom-template
  and duplicate-block recovery, in the real test store.
- AT20 requires actual standard/accelerated checkout and Shop Pay capability
  evidence. Unknown is pending; absent is N/A only with evidence.
- No current product facts justify an active treatment for the observed Complete
  Snowboard. Local fixtures are synthetic and do not authorize live claims.
- No commercial store, customer, pricing or billing action is authorized by the
  migration receipt.

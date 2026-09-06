# Source-invalidated legacy cutover recovery

Date: 2026-09-06. Status: implemented locally; not deployed by this change.

## Observed blocker

The live selected-store catalog refresh correctly invalidated the approved
legacy plan with `FROZEN_INPUT_DRIFT` before a cutover receipt existed. The
Overview then hid the cutover action and the service rejected every
`INVALIDATED` plan, even though this specific invalidation is the safe reason to
require a fresh-source v2 plan.

## Bounded correction

- The Overview exposes the existing cutover action for an approved legacy plan
  only when its latest transition is the system-owned
  `FROZEN_INPUT_DRIFT -> INVALIDATED` transition and its exact open
  `SOURCE_CHANGED` notice exists.
- The cutover service rechecks that authority under the merchant runtime lock,
  requires current catalog source/version freshness and refuses unrelated
  invalidations or runtime safety holds.
- The receipt binds the immutable source-invalidation transition ID. Receipt
  loading and all later receipt-bound preparation fail closed if that history
  is missing or changed.
- The legacy plan hash, approval JSON and transition history are retained. No
  `INVALIDATED -> INVALIDATED` transition is invented. The source notice is
  resolved, not deleted, only in the same transaction that installs the exact
  cutover hold and receipt.
- One merchant can have only one root cutover receipt. Exact retries replay the
  existing receipt; a different key cannot mint a second migration authority.
- A newly prepared v2 plan still uses only the refreshed current product source
  and still needs a fresh owner approval. The old approval is never revived.

## Verification

Focused production-path coverage exercises the real legacy drift detector,
transition and notice writer before invoking cutover. It also covers exact
replay, second-receipt refusal, unrelated lookalike invalidation, active safety
hold, immutable approval/hash retention and tampered transition rejection.

The first pinned Node 24.19.0 focused run passed 34/34 tests across
`test-store-cutover`, `autopilot-preparation-worker` and
`autopilot-integration`; TypeScript and focused ESLint passed. After the
concurrent owner-evidence permission change and this correction were both
frozen, the final `pnpm check` passed 340/340 tests, TypeScript, full ESLint, the
React Router production build, rebuilt theme runtime and `shopify app build`.
The release-source SHA-256 was unchanged before and after that gate:
`c1ce8652c265d6dde2b88fdbfcf434f934ef26f6f887bedff965922260eb6884`.

No Shopify, Fly, feature flag, database, product or provider state was changed
by this implementation.

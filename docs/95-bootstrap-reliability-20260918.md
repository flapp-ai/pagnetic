# First-install role bootstrap reliability — 2026-09-18

Root integration found concurrent embedded loads could both see an empty role table and collide while creating the same actor's OWNER role (Prisma P2002). Distinct actors could also pass the former non-atomic authorization count and each become OWNER.

ensurePilotRole keeps its existing-role fast read, preserving role, active state and grant metadata exactly. New-actor bootstrap now uses one SQLite transaction. A parameterized Merchant id=id no-op update acquires the database writer lock before authorization reads, avoiding deferred read-to-write lock upgrades and preserving timestamps/business fields. The transaction rechecks the exact actor, then checks active roles, and creates the first OWNER only if no active role exists. Existing active roles prevent another actor from bootstrapping. An existing inactive role is returned unchanged and is not revived. Normal requirePilotRole still rejects inactive roles.

P2002 recovery is narrowly limited to rereading the exact merchant/actor key and returning that existing role unchanged; missing matches rethrow the original error. Other errors propagate. No transaction replay, added timeout, permission upgrade, network call, schema migration or external write is introduced. This is SQLite-specific single-database serialization, not support for distributed multi-replica installs.

Focused real-SQLite tests cover simultaneous same-actor embedded loads, distinct actors with connection_limit=1 and connection_limit=4, unchanged Merchant timestamps, OPERATOR/inactive preservation and new-actor denial when an active role exists. These local fixtures do not constitute Shopify review or merchant-production proof.

Verification: all six focused fresh-install tests passed; TypeScript no-emit and focused ESLint passed. Both same-actor and distinct-actor bootstraps were exercised with one and four SQLite connections.

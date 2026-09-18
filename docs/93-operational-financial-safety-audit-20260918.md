# Pagnetic operational and financial safety audit — 2026-09-18

## Owner boundary

Target: **$15/month for Pagnetic operations**. Obtain owner approval before any increase in capacity, paid service, or operating budget. This is an approval policy, not a provider-enforced account spending ceiling. No new subscription, capacity, paid AI integration, GitHub CI run, or public treatment rollout is authorized by this repair.

## Verified infrastructure and provider observations

Before repair: Fly release 52, one fixed shared-CPU machine (1 CPU, 1,024 MB) in Frankfurt, one encrypted 5 GB mounted volume, shared IPv4 and IPv6. No autoscaler, volume autogrowth, extra app replica, external database, or enabled paid model provider was found in Pagnetic's deployment. Restart policy is on-failure, maximum 10 retries.

Fly's authenticated billing page showed an upcoming organization invoice of **$10.54**; Cost Explorer subsequently showed **$10.57** accrued for September 1–October 1. These are changing account-level observations, not a final invoice or Pagnetic-only monthly forecast. The organization has other apps/resources; they were not changed. Pagnetic's modest fixed machine/volume is approximately $6–8/month before variable charges, taxes, build usage and other account resources. A full monthly run of other apps may take the total account bill above $15 even when Pagnetic itself stays small.

Read-only Tigris inventory: **283 visible objects, 278,450,159 bytes** in the dedicated bucket. Production SQLite: **5,222,400 bytes**. Mounted filesystem available: approximately 4.8 GB. The inventory does not include hidden versions, soft-deleted objects, other buckets, or other clients' future writes. Backup credentials allow listing this bucket, reading/writing its dedicated prefix, and explicitly prohibit deleting backups.

## Loops and variable costs

| Activity | Actual behavior / guardrail |
| --- | --- |
| Maintenance | Runs immediately at supervisor startup, then waits five minutes **after completion**. A single scheduler does not overlap its own cycles. Tenant maintenance is now sequential for SQLite. HTTP deadline 90 seconds. The follow-up repair excludes confirmed uninstall markers rather than repeatedly calling their lost Admin sessions; the global privacy worker remains separate. |
| Supervisor failure | Ambiguous maintenance network timeouts stop its owned application process group instead of accumulating abandoned requests. Shutdown escalates to kill after five seconds. Fly restarts are bounded. Restart exhaustion requires operator recovery; fixed compute billing continues while a machine remains allocated/running. |
| Backup | Immediately at startup, then six hours after completion. Overall process deadline 15 minutes; S3 operations bounded, SDK maximum three attempts. Local cache keeps eight verified backups by default. Remote uploads now stop at a 4 GB visible-bucket limit or 64 MiB object limit, listing errors, page/deadline limits, or upload-lock conflicts. No remote deletion added. |
| Email alerts | Incident deduplication remains. Important failures are not muted. New durable, global maximum **100 outbound webhook network attempts per UTC month**, including retries/failures. Seed prior attempts conservatively before deployment; missing/corrupt accounting fails closed. In-app incidents remain visible when email delivery is deferred. |
| Outbox / workers | Existing retry ceilings and dead-letter handling remain. Onboarding preparation maximum five attempts, privacy maximum ten, ordinary outbox default eight; lifecycle has its own finite higher ceiling. No blanket replay or indefinite immediate retry was added. |
| Memory rate limits | Maximum 10,000 live key buckets. Expired entries can be cleaned; a full map denies a new key rather than evicting a live allowance. This bounds limiter memory, not total network ingress/egress. |
| Paid AI | Disabled and no deployed model-provider credential found. Any later enablement needs owner cost approval and a separate usage budget. |

The present Make scenario has webhook → iterator → Gmail. One single-alert delivery ordinarily consumes approximately three module operations; 100 attempts leaves headroom in a 1,000-credit free allowance. Failed requests, scenario changes, other scenarios and paid/AI modules can change credit consumption. Actual current Make account usage/plan has not been verified in this audit; no automatic upgrade is authorized. This guard does not prevent charges originating elsewhere in that account.

At current scheduled volume, approximately 120 backups/month produce up to roughly 360 new objects and corresponding verification reads when a privacy-journal sidecar exists. One-page inventories add roughly 360 list operations/month before retries, startup/manual runs or growth. These are workload estimates, not an account request ceiling. Four-page listing and deadlines bound each upload attempt. Repeated deployments/restarts add backup attempts; they are not free by definition, but retained storage remains guarded.

## Reliability repair and honest residual limits

Real SQLite tests reproduce P1008 under competing pooled transactions; the same work succeeds with one pooled connection. Initialization is awaited, reads of already-initialized merchants avoid unconditional seed writes, and scheduled merchants run sequentially. No transaction replay or increased transaction timeout was introduced. The precise writer that held the database during the September 18 production incident remains unproven. A long transaction or external writer can still delay/fail work within the configured bounds; single-process SQLite is not certified for 25 busy stores.

Automation history grows with scheduled cycles (up to 288 cycles per tenant per day before execution time). It is currently small, but retained audit/financial/privacy evidence is not automatically deleted by this work. A fixed 5 GB volume does not automatically increase its bill; filling it can still cause outages. Backups preserve a disk reserve and fail before exhausting space. A future evidence-retention change needs explicit scope and approval rather than silently deleting history.

When the remote backup cap is reached, future uploads stop and backup freshness expires. The production-readiness command fails on stale evidence until the owner approves a safe retention or capacity decision. This backup freshness check currently belongs to that command; do not claim it is an automatic storefront serving gate or a dedicated proactive backup email alarm. The supervisor logs backup failures and the database continues running. The owner needs a periodic operational review of backup freshness and provider usage; no recurring agent monitor was created by this audit. This is a deliberate cost-versus-recoverability boundary, not proof of indefinite healthy operation. Stale upload locks also need verified operator recovery; never auto-unlock an operation that might still be active.

No Pagnetic monitor was found in the local persisted Codex automation files inspected during this audit. An unrelated paused automation was left untouched. This is not an inventory of every cloud-scheduled task in the account. The OpenAI Docs workflow guided this narrowly scoped check; no automation settings were changed.

No provider hard $15 cap is established. Fly bills variable egress, snapshots above allowance and other resources. Public static downloads and malicious traffic can produce bandwidth charges even with fixed CPU and backend rate limits. Soft-deleted/versioned Tigris objects or external writers are outside visible inventory enforcement. Domain registration, Shopify fees, Codex development credits, taxes and unrelated apps are excluded from the Pagnetic fixed-host estimate. Do not describe any of these as a guaranteed zero or included cost.

## Release and launch boundaries

Deployment proof and fresh production recovery results must be recorded separately after verification. A changed APP_RELEASE invalidates prior release-bound QA; old browser artifacts must not be copied into new-release PASS receipts. Shopify review receipt is not approval or public availability. Public serving holds and consent/authority/privacy/financial controls must remain unchanged.

## Sources checked during this audit

- [Fly cost management](https://fly.io/docs/about/cost-management/): allowances are not hard spending caps; Fly does not currently provide billing alerts.
- [Fly pricing](https://fly.io/docs/about/pricing/): regional compute, $0.15/GB-month volumes, snapshot allowances and network charges.
- [Tigris pricing](https://www.tigrisdata.com/pricing/): Standard's 5 GB, 10,000 Class A and 100,000 Class B free allowances; stored soft-deleted data still counts.
- [Make pricing](https://www.make.com/en/pricing) and [credits](https://help.make.com/credits): free allowance and scenario-dependent credit accounting.

Implementation and regression evidence: documents 91, 92 and 94.

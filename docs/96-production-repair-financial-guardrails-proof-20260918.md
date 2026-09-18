# Production repair and financial safeguards — verified 2026-09-18

## Deployed identity

Final Fly release **54**, complete, created **2026-09-18T18:10:33Z**.

- APP_RELEASE: `22469dd74ef72d7d31d6c574cc7d926375fac80e`.
- Image: `registry.fly.io/pagnetic:deployment-01M2TV8Q53FV8R275QKEP4AR6A`.
- Build manifest digest: `sha256:b62197a5db117c163152e94a6d7d21f98bd0e2b9adf07a3f576122be2f7710ba`.
- Same single machine `d8d1497a937658`, Frankfurt, shared 1 CPU / 1,024 MB.
- Same encrypted 5 GB volume `vol_v8edxqoz37ne0jyv`, mounted `/data`.
- Restart policy still on-failure / maximum 10 retries; shared IPv4 and existing IPv6 retained. No HA replica, capacity upgrade, autoscaler, new persistent service, paid AI enablement, pricing change, external charge approval, or GitHub push/CI occurred.

The initial repair was deployed as release 53 / `98bc3f423a7abbc3f1398ea0ca4b5891abd8a52b`. Post-deployment verification identified unnecessary calls to confirmed-uninstalled merchants; the narrow follow-up was reviewed, tested and deployed as release 54. Both deployments targeted only the existing machine with HA disabled, update-only, no new public IP allocation, and deployment retries disabled. Routine remote image builds used the existing Fly/Depot workflow; transient build/network usage can be billable and is not described as free.

## Local verification

- Supported bundled Node 24: complete **438-test suite passed**, typechecking, lint and production build passed.
- An earlier Node 20 run exposed an intermittent existing first-install P2002 race (437/438). Rather than treating the supported-runtime pass as proof the race did not exist, atomic owner-role bootstrap was fixed and **six focused real-SQLite install tests** passed afterward, including one- and four-connection pools and distinct actors. Typecheck, lint and production build were rerun successfully after that change.
- Follow-up uninstall selector: migrated real-SQLite test passed; parent typecheck and targeted lint passed. The final production image build passed. No duplicate full-suite run was performed for the small selector-only follow-up.
- Detailed concurrency, no-replay, alert-budget, rate-limit, backup corruption/privacy/retention and uninstall obligations are recorded in documents 91, 92, 94, 95 and 97. Local fixtures are not merchant traffic, capacity certification or sales-lift evidence.

## Fresh production results

Public `https://pagnetic.fly.dev/healthz` returned `200` with `ok=true` after the final update. Fly's HTTP service check is passing. A rolling-startup health request during the earlier release 53 update timed out; it subsequently recovered, and final release 54's public check succeeded.

One authorized, bounded verification cycle on release 54 used the existing internal maintenance authority, without exposing its value:

| Check | HTTP | Outcome | Duration |
| --- | ---: | --- | ---: |
| Local database-backed health | 200 | `ok=true` | 83 ms |
| Tenant maintenance | 200 | `ok=true`; two selected merchants, zero tenant failures | 607 ms |
| Global privacy worker | 200 | `ok=true` | 36 ms |

Follow-up database inspection: **zero RUNNING maintenance markers**, **zero failed maintenance runs started since final release creation**. These are point-in-time observations, not a guarantee against future errors.

Original incident `cmu78w84h058iq6lbowg0vs39` is RESOLVED, with provider database timestamp **18:02:40.725Z**. This resolution preceded deployment of release 53; do **not** claim the patch caused that particular transition. The patch's contention mechanism is proven in fixtures and its new-release runtime checks succeeded. The original precise production lock holder remains unproven.

Ten historical RUNNING records dated before release 53 creation were confirmed to belong to the terminated prior application process. A count-guarded update annotated them FAILED with `APP_PROCESS_RESTART_INTERRUPTED`; none was deleted, marked successful or replayed. Actual worker/job/financial/QA completion was not fabricated.

## Backup and alert-budget proof

Before repair, the independently checked existing backup/readback/privacy-sidecar/isolated-restore evidence passed at **16:52:23.281Z**.

Final release's startup backup:

- Created **18:11:27.508Z**.
- APP_RELEASE matches `22469dd74ef72d7d31d6c574cc7d926375fac80e`.
- Encrypted artifact **5,197,824 bytes**.
- Isolated restore verified **18:11:29.522Z**.
- `checkBackupEvidence` passed signature, artifact/privacy-sidecar checksums, freshness, configured off-volume destination and isolated SQLite integrity/foreign-key evidence.
- No upload lock remained afterward.

The independent receipt replay/full incident recovery drill remains a separate requirement; a verified backup does not certify that larger drill.

The durable alert counter was explicitly seeded before deployment using **12 total retained historical alert-outbox attempts**, conservatively counting them all against September rather than subtracting previous-month activity. At final verification it still recorded **September / 12 attempts**, with mode **0600**; the retained outbox total also remained 12. The cap is 100 per UTC month and accounting survives deploys/restarts on the same volume. No test email or alert flood was generated by these production verification cycles. Budget denials remain local/visible and do not falsely mark delivery successful.

No remote backup deletion, retention-policy change, object-publicity change, new credentials or provider permission expansion occurred. The new production bucket/object caps passed a genuine upload/readback/restore cycle with the existing dedicated Tigris credentials.

## Browser and public-launch boundaries

The deployed embedded test1 Settings page loaded and displayed Shopify-confirmed plan state with an expiry date and a top-level Shopify View plans link. The overview loaded on the final release and reported **VERIFYING / Original fallback protected**. No Resume, baseline activation, package approval, demo authorization, checkout/payment or public-store rollout was performed by this repair.

The overview correctly identifies old-release runtime evidence and requires fresh release-bound QA. Existing historical PASS labels are not fresh release-54 receipts. No old artifact was rebound into a new PASS record. Full browser/merchant performance/capacity/activation proof and Shopify approval remain distinct from these hosting checks.

## Budget verdict and one remaining provider check

Owner policy: **$15/month target, approval before an increase**. Fixed modest Pagnetic hosting is approximately $6–8/month before traffic, snapshots outside allowance, build usage, taxes and unrelated resources; this is an estimate, not a hard account ceiling. Authenticated Fly observed $10.54 upcoming invoice / $10.57 Cost Explorer accrued organization spend, including five apps, during this audit. Other apps were not changed. Their spend can take the total account bill beyond Pagnetic's target.

Make's live login page requires sign-in. Its current account plan, remaining credits and any purchased-credit/overage settings therefore remain **unverified**. Owner action: sign into Make so the existing plan/usage can be checked read-only; do not buy credits or upgrade. The application-side 100-attempt quota is deployed regardless, but cannot certify shared account spend or remaining current-cycle allowance.

The fixed infrastructure, disabled paid AI, finite retries/schedules, bounded limiter memory, durable alert quota and conservative upload caps reduce runaway cost risks. They do not provide an absolute $15 provider spending stop or indefinite healthy operation. Periodically review backup freshness and provider usage; when guards block backups, approve safe retention/capacity explicitly rather than weakening guards or silently deleting privacy/recovery evidence. See document 93 for complete financial limits and official pricing sources.

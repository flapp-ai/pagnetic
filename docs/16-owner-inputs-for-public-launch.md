# Owner Inputs Required for Public Launch

Everything below changes commercial identity, legal obligations, external accounts, or pricing. The application cannot choose it safely on the owner's behalf.

## Required before deployment

| Input                | Environment/configuration | Owner decision                                     |
| -------------------- | ------------------------- | -------------------------------------------------- |
| Public app name      | `PUBLIC_APP_NAME`         | Confirmed: Pagnetic; pagnetic.com purchased. |
| Legal operator       | `PUBLIC_COMPANY_NAME`     | Confirmed: Flapp Bilişim A.Ş.                      |
| Support contact      | `SUPPORT_EMAIL`           | Confirmed: support@flapp.ist                       |
| Privacy contact      | `PRIVACY_CONTACT_EMAIL`   | Confirmed: privacy@flapp.ist                       |
| Hosting provider     | `HOSTING_PROVIDER_NAME`   | Confirmed: existing Fly app `pagnetic`, Frankfurt. |
| Terms date           | `TERMS_EFFECTIVE_DATE`    | Date after legal approval.                         |
| Production account   | host login/billing        | Fly account/billing and deployment authorization already supplied. Do not request again. |
| Domain               | `SHOPIFY_APP_URL`         | Existing HTTPS origin: `https://pagnetic.fly.dev`; custom-domain DNS/TLS remains separate. |
| Incident destination | `ALERT_WEBHOOK_URL`       | Slack/PagerDuty/other monitored endpoint.          |

Never paste passwords, payment-card details, Shopify secrets, encryption keys, or host tokens into project documents or chat. Enter them in the provider's secret manager when prompted.

## Current blocking setup — checked 2026-09-05

### Latest connection update

Superseding activation update20:34Z: owner confirmed independent recovery-note retrieval. Fly version14 now runs the reviewed compatible runtime; all14 secrets are deployed, all25 migrations applied, health passes and the first supervisor-triggered encrypted Tigris backup/readback/isolated DB restore passed. Billing and v2 features remain disabled. No further owner action is needed for this storage connection. Full recovery, incident destination and broader launch acceptance remain separate; see docs49 for exact evidence and startup maintenance timeout/retry.

Storage checkpoint superseding the initial empty-bucket state below: the owner created `pagnetic-backups` in Frankfurt/Standard. Dedicated restricted access passed real provider tests, eight settings are staged in Fly, and one actual release13 encrypted database backup/upload/readback/isolated DB restore passed. Keys were saved directly into the owner's protected recovery note and its lock closed. Independent off-machine note retrieval and scheduled runtime activation remain pending. Full evidence and limitations: docs49. Do not request another bucket or manually created API key.

The owner created a standalone Tigris account and completed CLI browser authorization. The official `@tigrisdata/cli@3.11.0` is runnable through the cached pinned `pnpm --package=@tigrisdata/cli@3.11.0 dlx tigris` command with Node24.19.0. OAuth login, `whoami` and a read-only bucket listing succeeded for `bilgi org`; the bucket list is empty. This account is not assumed to share Fly billing. Subsequent invocations set `TIGRIS_NO_TELEMETRY=1`. No bucket, persistent storage access key, production secret, data upload or deployment was created by this connection step.

The owner chose a locked iCloud note instead of a password manager or USB and reports that it is prepared. Its locked state, synchronization, independent retrieval and actual key contents remain unverified. Do not generate the only recovery-key copy in chat or an unencrypted project file, and do not mark key custody complete from the owner's preparation report alone.

Sol's corrected local release has passed its source-bound gate and Astra's bounded correction acceptance (docs48). This does not establish live readiness. The existing Fly release13 is still the older application.

Read-only `flyctl orgs list --json` returned the personal organization (`flapp academy`). `flyctl storage list --org personal` exited successfully with no bucket rows. This confirms no Fly-integrated Tigris bucket is available in that organization; it does not rule out independently owned AWS/S3-compatible storage. The live configuration audit in docs48 also found no new backup/privacy/S3/alert configuration. No resources were provisioned and no credentials were changed.

| Next dependency | Exact owner input/action | Engineering preparation and following verification |
| --- | --- | --- |
| Private off-volume backup storage | Identify existing approved S3-compatible storage or approve a specific new provider/region/cost before provisioning. Supply endpoint, region, bucket and approved retention; enter dedicated credentials through a secret manager, not chat. | S3 adapter and encrypted snapshot/receipt/restore paths are implemented. Configure the exact `BACKUP_S3_*` fields in docs28, then verify actual upload, readback, privacy receipt inventory and isolated full application recovery. |
| Independently recoverable keys | Name the approved password/secret vault and person responsible for recovery. Preserve existing field/application keys and all required history; generate separate backup/privacy keys through that process. | Active/retained-key authentication is tested. Verify off-machine access and an actual recovery drill; storing only in Fly or the backup bucket is insufficient. |
| Delivered incidents and outage detection | Name the incident responder and monitored HTTPS alert destination; arrange an independent uptime/dead-man check. | Outbox delivery/retry and process supervision are implemented. Enter `ALERT_WEBHOOK_URL` securely and prove receipt, maintenance execution, backup cadence and outage detection. |

After those prerequisites: build/deploy the exact accepted backend with serving/billing/new offers closed, verify migrations and recovery on intended infrastructure, then release compatible extensions and run the supported authenticated Shopify/browser/checkout/refund/privacy acceptance matrix. Do not treat the old successful test orders as v2 acceptance. Keep one supervised SQLite writer until the managed-database gate is met.

Design-partner onboarding still needs qualified store participation, capacity/financial-convention evidence, human content review and legal/distribution approval. Public acquisition and paid continuation have additional customer-learning gates. None of these is waived by a code test count.

## Required before paid continuation

- Decide the monthly price and currency after the first valid result.
- Decide whether negative and inconclusive results receive extended free access.
- Approve the exact plan name and feature boundaries.
- Enable Shopify billing only after checkout, cancellation, reinstall, frozen-store, and webhook QA pass.

The MVP can launch as a free founding beta with `SHOPIFY_BILLING_ENABLED=false`. That is the fastest path to learning and creates no charge before value is demonstrated.

Current pricing recommendation: first 25 stores pay nothing until a valid real experiment result. After a positive result, offer a founder-locked price of USD 49 per store per month for 12 months. After a negative or inconclusive result, allow one revised experiment or 30 additional days free before asking the merchant whether to continue. Keep billing disabled until this policy is approved and its Shopify billing flow is verified.

## Required before Shopify submission

- Confirm the public distribution decision.
- Approve the listing draft, icon, screenshots, and demo store.
- Approve the privacy policy and obtain legal review of the terms.
- Confirm support hours and response owner.
- Complete the Partner Dashboard protected-customer-data declaration and App Store submission.

# Public-Beta Launch Checklist

Status: release gate  
Scope: first 25 stores, one application writer, one hero product per store

## Code and product

- [x] Public product URL scanner with HTTPS-only input, private-address blocking, bounded redirects, response size, timeout, and request rate.
- [x] Source-only opportunity score and Original, Universal, Comfort, Performance, and Value previews.
- [x] One-click sample preview for visitors who do not yet have a public product URL.
- [x] Anonymous scan telemetry without storing product URL or product copy.
- [x] Seven-stage embedded activation journey with next-action guidance.
- [x] Hero-product selection and immediate draft-library creation.
- [x] Free-until-result entitlement; A/A excluded from the trigger.
- [x] Automatic entitlement reconciliation from mature result snapshots.
- [x] Authenticated 30-day aggregate funnel endpoint at `/internal/funnel`.
- [x] Public privacy, terms, support, and service-health pages.
- [x] Multi-merchant isolation on store-scoped records and explicit owner/operator/viewer roles.
- [x] Single-writer SQLite WAL profile, capacity gate, parallel bounded maintenance, retention, backup, restore, alert, and kill-switch controls.

## Owner inputs

- [x] Confirm company/legal identity: Flapp Bilişim A.Ş.
- [x] Supply support and privacy email addresses.
- [ ] Confirm the public app name.
- [ ] Approve governing law and final terms with counsel.
- [ ] Choose production hosting account and domain.
- [ ] Choose price after the first valid result, or confirm a permanently free founding beta.
- [ ] Approve icon, screenshots, and listing copy.
- [ ] Supply support hours and incident destination.

## Deployment

- [ ] Provision stable HTTPS application origin.
- [ ] Attach encrypted durable volume and set `DATABASE_URL=file:/data/pilot.sqlite`.
- [ ] Set every required secret and public identity variable from `.env.example`.
- [ ] Keep `APP_INSTANCE_COUNT=1` and set an explicit `PUBLIC_BETA_MAX_STORES`.
- [ ] Update and deploy Shopify application, redirect, proxy, and webhook URLs.
- [ ] Schedule `/internal/automation` every five minutes.
- [ ] Monitor `/healthz` externally and test alert delivery.
- [ ] Run nightly online backups, copy them off-volume, and complete an isolated restore drill.
- [ ] Run `pnpm check`, `pnpm check:partner`, and `pnpm check:production`.

## Shopify submission

- [ ] Select or confirm public App Store distribution.
- [ ] Complete listing, pricing classification, demo store, and reviewer instructions.
- [ ] Submit minimum protected customer data request only; do not request name, email, address, or phone fields.
- [ ] Confirm all current App Store requirements against the release build.
- [ ] Pass review and set listing visibility.

## Launch and learning

- [ ] Verify the full reviewer path on a clean development store.
- [ ] Watch preview failures, install starts, activation, A/A validity, experiment completion, and support load.
- [ ] Interview merchants who preview but do not activate and merchants who activate but do not complete A/A.
- [ ] Do not claim PMF from installs. Review result completion, continued use, willingness to pay, and repeated merchant demand.

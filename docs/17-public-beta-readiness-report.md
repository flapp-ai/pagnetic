# Public-Beta Readiness Report

Status: code-complete; awaiting owner-controlled production launch inputs  
Release candidate: 0.4  
Verified: 2026-09-03

## Outcome

Adaptive Storefront is ready to deploy as a capped, single-writer founding beta. A merchant can see value before installation, install into Shopify, follow one guided activation path, keep the native storefront as the fallback, validate measurement with A/A, and run the first real revenue comparison. The free-access entitlement ends only when a mature real experiment produces a positive, negative, or inconclusive result; A/A validation never triggers it.

No product-code gate remains open for this release profile. Public deployment and Shopify submission remain blocked by real external configuration and owner decisions listed below.

## Verified release evidence

| Gate | Result |
| --- | --- |
| Automated tests | 53 passed, 0 failed |
| TypeScript | Passed |
| ESLint | Passed |
| React Router production build | Passed |
| Shopify app and extension build | Passed |
| Partner readiness | 26 of 26 passed |
| Database migrations | 10 found; schema up to date |
| Production dependency audit | No known vulnerabilities |
| Production-process smoke | Landing page and `/healthz` returned HTTP 200 |
| Public browser QA | Styled landing page, sample preview, five angle cards, and safe URL rejection passed |
| Embedded Shopify QA | Dashboard and seven-stage `/app/get-started` journey rendered in the connected development store |
| Protected internal metrics | `/internal/funnel` returned HTTP 401 without its bearer secret |
| Public operational pages | `/privacy`, `/terms`, `/support`, `/healthz`, and favicon returned HTTP 200 |

## Release boundary

- Maximum store count is explicit through `PUBLIC_BETA_MAX_STORES` and defaults to 25.
- The application runs as one writer with SQLite WAL on an encrypted durable volume.
- Multiple app instances, an uncapped cohort, or operation beyond the observed capacity envelope requires managed PostgreSQL and a new capacity review.
- Billing stays disabled for the founding beta until price and billing behavior are approved and tested.
- Public legal pages deliberately display a prelaunch notice until the owner identity fields are configured.

## Owner-controlled blockers

1. Confirm the app name, legal operator, support email, privacy email, hosting provider, and terms effective date.
2. Approve the privacy policy and terms with appropriate legal review.
3. Create or approve the production hosting account, stable HTTPS domain, encrypted volume, off-volume backups, scheduler, uptime monitor, and incident destination.
4. Enter production Shopify credentials and independently generated application secrets in the host secret manager.
5. Decide the post-result price and whether billing remains disabled during the first cohort.
6. Approve App Store icon, screenshots, listing copy, reviewer instructions, protected-data declaration, and submission.

Use [Owner inputs for public launch](./16-owner-inputs-for-public-launch.md) for the exact handoff and [Public-beta launch checklist](./15-public-beta-launch-checklist.md) for the ordered release procedure.

## Final production command gate

Run these inside the real production environment after secrets, storage, alerts, backups, and public identity are configured:

```bash
pnpm setup
pnpm check
pnpm check:partner
pnpm check:production
```

The release is authorized only when `pnpm check:production` reports zero failures and a dated release record is completed from [the release template](./11-release-record-template.md).

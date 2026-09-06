# Hosting and Pricing Recommendation

Status: recommendation awaiting owner approval  
Prepared: 2026-09-03

## Hosting decision

Use **Fly.io in the Frankfurt (`fra`) region** for the first capped cohort.

Recommended production profile:

- One always-on shared-CPU Machine with 1 GB RAM.
- One 3–5 GB encrypted Fly Volume mounted at `/data`.
- `DATABASE_URL=file:/data/pilot.sqlite` and `APP_INSTANCE_COUNT=1`.
- Fly-managed HTTPS on the initial `*.fly.dev` hostname; attach a Flapp subdomain after smoke testing.
- `/healthz` service check every 15 seconds.
- Daily Fly volume snapshots with extended retention plus a nightly application-consistent backup copied to separate object storage.
- External five-minute scheduler for `/internal/automation` and an external uptime/alert monitor.
- Initial infrastructure budget: approximately USD 10–20 per month, excluding unusual bandwidth, external monitoring, and domain costs.

Why this is the best MVP fit:

- The repository already contains a production Dockerfile and Fly configuration.
- Fly has first-party Shopify deployment guidance, managed TLS, health checks, encrypted persistent volumes, and daily volume snapshots.
- A single Machine matches the application's explicit SQLite single-writer safety boundary.
- Frankfurt is the closest currently listed Fly region to the initial Turkey/Israel operating area and supports a later migration to managed PostgreSQL.

The tradeoff is deliberate: a single local volume is not highly available. The 25-store cap, off-volume backups, restore drill, health monitoring, and original-storefront fallback contain that MVP risk. Move to managed PostgreSQL before adding application replicas or removing the cohort cap.

## Market pricing snapshot

Current Shopify App Store entry prices observed on 2026-09-03:

| Product | Relevant entry price | Positioning |
| --- | ---: | --- |
| Visually A/B Testing & CRO | USD 15/month up to 100 orders; USD 80 up to 600 orders | Low-entry, broad testing and personalization |
| Intelligems Smart Content | USD 69/month | Content testing and audience personalization |
| ABConvert Starter | USD 99/month | Broad testing with 1,000 test orders |
| Shoplift Core | USD 99/month | Theme, template and URL testing |

Sources: [Visually](https://apps.shopify.com/visually-io), [Intelligems](https://apps.shopify.com/intelligems), [ABConvert](https://apps.shopify.com/a-b-convert-price-a-b-test), and [Shoplift](https://apps.shopify.com/shoplift).

## Recommended offer

### Founding beta — first 25 stores

- Free preview before installation.
- Free installation and A/A validation.
- Free until the first valid real experiment result.
- **USD 49 per store per month after a positive result**, locked for 12 months.
- One revised experiment or 30 extra days free after a negative or inconclusive result.
- Cancel at any time.

This price is high enough to test willingness to pay but below the established USD 69–99 entry point of more mature testing platforms. It also reflects the MVP's narrower one-hero-product scope.

### Later public price

After the first cohort demonstrates repeat activation, valid-result completion, and continued use, test a **USD 79/month standard plan**. Do not add tiers until merchant behavior shows a real segmentation need.

## PMF pricing signal

Do not count free installs as pricing validation. The useful signal is the percentage of merchants who:

1. reach a valid result;
2. see the USD 49 continuation offer;
3. start paying without manual discounting; and
4. remain active for at least three paid months.

Treat five or more independently acquired paying stores with repeated experiment use as an early signal, not proof of PMF.

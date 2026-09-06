# Security, Privacy, and Data Operations

Status: design-partner baseline  
Review cadence: before each pilot and after every material data-flow change

This is an engineering control record, not legal advice. Counsel must confirm the merchant/app privacy notices, contracts, supported markets, and controller/processor roles.

## Data boundary

Adaptive Storefront personalizes from acquisition intent, not protected identity. The storefront receives only approved product content and opaque decision references. The Web Pixel sends an allow-listed event shape only when analytics processing is allowed. It does not send names, emails, addresses, phone numbers, full URLs, free-form shopper text, or payment details.

Raw commerce and render events use configurable retention. Scheduled maintenance deletes expired raw rows while preserving de-identified decisions, attributed order totals, experiment registrations, immutable result snapshots, and audit records required for causal analysis.

## Encryption and secrets

- HTTPS is required in production.
- Shopify tokens remain in server-side session storage.
- Incident-contact fields use AES-256-GCM authenticated encryption with `FIELD_ENCRYPTION_KEY`; legacy local rows are re-encrypted when saved.
- Assignment, automation, encryption, and Shopify secrets must be independent values in the hosting secret manager.
- Never put secrets in `.env.example`, source control, browser payloads, screenshots, or support tickets.
- Rotate credentials after personnel changes, suspected exposure, or annually. Rotating the assignment secret requires a new registered experiment version.

## Access

The first authenticated Shopify identity becomes pilot owner. Owners can grant `OWNER`, `OPERATOR`, or `VIEWER` to exact Shopify staff user IDs. Content approval, qualification override, and launch are owner-only. Every material governance or operations mutation creates a merchant-scoped audit entry.

## Abuse and failure controls

- Shopify authentication/HMAC protects admin, webhook, and app-proxy routes.
- Public ingestion has payload-size limits, schema allow-listing, hashed token authentication, idempotent event IDs, and rate limiting.
- The scheduler endpoint uses a constant-time bearer-secret comparison and does not accept GET.
- Runtime validation checks approval, content, evidence, source, policy, and hash integrity on every served version.
- Any timeout, invalid state, missing content, kill switch, or technical failure leaves the native product page unchanged.

## Shopify privacy webhooks

Customer data request, customer redact, and shop redact endpoints are registered. Identifiers used to locate privacy work are one-way keyed hashes. App uninstall pauses experiments, disables the pixel and runtime, deletes sessions, and records pending shop deletion work.

## Incident response

1. Detect through external health monitoring, scheduled guardrails, alerts, merchant report, or audit review.
2. Activate the kill switch for any storefront, measurement-integrity, privacy, or content-safety incident.
3. Record severity, description, experiment, detection time, and owner in Pilot operations.
4. Preserve minimal logs and immutable experiment/audit evidence; do not copy shopper data into tickets.
5. Contain and rotate affected credentials, correct the defect, and complete required merchant/regulatory notifications with counsel.
6. Verify fallback and event integrity before resolving. Record root cause and preventive action.

## Backup and recovery

The one-partner pilot uses a single SQLite writer on a durable encrypted volume. The production supervisor runs `scripts/backup-sqlite.sh` every six hours; also run it before deployment. The v2 script requires an independent backup encryption key and an approved S3-compatible off-volume bucket. It takes a consistent SQLite snapshot, encrypts and uploads it, then downloads and restores it into an isolated temporary database before publishing signed evidence. See [the current recovery runbook](28-encrypted-backup-and-recovery.md). Configure the approved remote retention schedule separately; no arbitrary destination-directory deletion is performed.

Before launch and quarterly, retrieve a verified manifest and restore into a NEW isolated database with `scripts/restore-sqlite.sh <manifest-object-name> /absolute/new-database.sqlite`. Existing databases are never overwritten. Follow the runbook to verify migrations, experiment/audit counts and application recovery without sending jobs or notifications. Record full recovery time and evidence in the pilot release record; automatic SQLite integrity checks alone do not certify application RTO.

SQLite is intentionally limited to one application writer. Move to managed PostgreSQL with point-in-time recovery before multiple concurrent production instances or more than one design partner.

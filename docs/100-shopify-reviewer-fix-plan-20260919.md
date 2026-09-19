# Shopify reviewer remediation — integrated fix and release gate

Date: 2026-09-19
Status: **DEPLOYED AND LIVE-QA PASSED — RESUBMISSION NOT AUTHORIZED**

This is the implementation record for the findings in [doc99](./99-shopify-reviewer-qa-20260919.md). It supersedes doc98's earlier candidate design. The live Fly release remains unchanged until the owner approves release.

## Fix plan and completion

| Workstream | Implemented result | Verification |
| --- | --- | --- |
| Reviewer access | The first authenticated actor remains OWNER. Later Shopify-authenticated actors receive narrow SETUP access, not OPERATOR. SETUP can sync/select products and build/revise campaign drafts, but cannot approve or publish, change serving, clear safety holds, verify billing, export data, view privacy artifacts, grant roles, or enter operator workspaces. | Real-SQLite concurrent bootstrap and route-policy denial tests. Read-only Settings hides privileged controls and links. |
| Fresh campaign setup | Current low-risk evidence approval, campaign mapping, diagnosis and draft creation run in one transaction. Unsupported or failed drafting rolls back all four; no orphan mapping or partial evidence approval remains. | A fresh product creates a source-backed draft without a prerequisite error. Unsupported ad evidence leaves zero mappings, diagnoses, drafts and approved evidence. |
| Source freshness | Source version now includes the normalization policy and content hash. Structured Shopify list/break boundaries remain distinct. A fact change stales DRAFT and APPROVED_ACTIVE experiences, diagnoses and package reviews; source documents/evidence are refreshed consistently. | Exact regression changes `Dishwasher and microwave safe` to `Hand wash only / Not microwave safe`; the prior draft becomes `STALE_REVIEW_REQUIRED` and disappears from current eligible drafts. |
| Reviewer UI | `EXPERIENCE_DRAFTED` renders as success; abstention, stale and pending states are distinct; source review remains retryable; campaign fields survive errors; unknown campaign errors become a safe Original-fallback message. | Server-rendered UI tests cover success, abstention, stale, field preservation, read-only Settings and empty Results. |
| Empty/status states | Settings cannot claim reviewed authority without a plan. Results disables its action until an experiment exists. Limited users see neither operator controls nor owner-only links. | Component render tests and production build. |

## Integrated release evidence

- Final full suite: **459/459 tests passed**.
- TypeScript: passed.
- ESLint: passed.
- React Router production client/server build: passed.
- Shopify app/theme/measurement extension build: passed.
- Partner readiness: **31/31 passed** against a disposable database containing all 29 repository migrations.
- `git diff --check`: passed.
- The corrected source is pushed and the evidence bundle is deployed through Fly release 58 on the existing single machine. The invited reviewer store is configured through a source-backed draft only; no storefront activation, experiment, paid capacity, reviewer response or resubmission occurred.

The check aligns with Shopify requirements 2.1.1/2.1.2 for critical/minor UI failures and 2.1.4 for accurate synchronized data. Local evidence does not replace Shopify's requested live reviewer-store proof.

Local environment note: Prisma's macOS schema-engine command returned a generic error when asked to run `migrate deploy` against a new temporary SQLite file, while the same 29 SQL migrations and Prisma query passed through the repository's established fixture/readiness path. This candidate adds no migration. Treat successful migration/startup on Fly's Linux release as a mandatory deployment check rather than claiming the local CLI behavior proves production startup.

## Post-approval deployment and reviewer QA

1. Deploy this candidate to the existing single Fly machine only; add no service or capacity.
2. Confirm migration/startup, `/healthz`, machine health, logs and repeated embedded navigation with a fresh session.
3. In Shopify's invited store, refresh the catalog and complete the exact reviewer UTM/ad flow from a SETUP account. Confirm no owner/operator capabilities are exposed.
4. Have the actual store OWNER approve the exact source-backed message/package. SETUP must remain unable to do this.
5. Verify the approved message on the published supported theme using the exact campaign URL; verify an unknown campaign returns Original; verify consent and native checkout without placing a real order.
6. Edit the selected product fact and confirm the old draft/approved content immediately becomes unavailable and Original is served.
7. Repeat Overview, Get started, Messages, Results and Settings navigation; confirm no blank page, redirect loop, 4xx/5xx or raw internal error.
8. Record one continuous English reviewer-store screencast showing onboarding, product/source review, UTM configuration, approval boundary, storefront result, Original fallback and expected result.
9. Prepare the Shopify response with the new video and exact steps. Stop for explicit owner approval before sending or clicking resubmit.

## Release decision

Deployment and invited-store QA now pass. The final response and store-specific video are prepared in [doc101](./101-shopify-reviewer-store-release-20260919.md). It is **ready for owner review but not authorized to click Resubmit**.

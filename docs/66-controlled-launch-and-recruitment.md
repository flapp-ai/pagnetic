# Public applications and controlled onboarding

Approved direction: 2026-09-06. Owner explicitly approved pricing, Public distribution with limited visibility, and proceeding to Shopify review submission. Public free preview and email applications; first cohort of five active stores, expanding toward a maximum 25 founding stores after reviewing support and capacity. This document supersedes previous free-until-result marketing recommendations, not existing merchant agreements or production billing behavior. Limited visibility is discoverability control, not an access secret: anyone receiving the approved listing link may reach it.

## Offer and entry path

- Free product/ad preview without installation. No live personalization on the free preview.
- Founding Beta: USD 49/month, 30-day trial, one active product and up to three campaign messages. First 25 accepted stores.
- Public application by email to support@flapp.ist. Submission occurs when the applicant sends their email, not when they click the link. No extra CRM or application database is required for the first cohort.
- Ask for store/product URLs, exact ad messages, approximate product-page monthly traffic/orders, owner or agency role, and acquisition source. No customer-level data needed.
- Applications and previews never trigger billing. Prepare installation, content and measurement first; offer the subscription trial at activation readiness. Shopify subscription approval starts the actual billing trial clock. Do not promise a delayed clock if Shopify has already started it.
- Existing free-until-result grants must be honored. Billing remains disabled until the 30-day offer is configured, reviewed, and tested. Do not silently migrate existing merchants.

## Selection and operation

Owner/operator: Eren, assisted by Codex. Review applications in the support inbox. Use labels Applied, Qualified, Invited, Installed, Activated, Paying, Deferred, Declined. Retain only necessary correspondence under the published privacy policy; no marketing enrollment implied.

Qualify an operating Shopify store with a supported theme, an active product, paid traffic, two distinct source-supported ad messages, and someone authorized to approve changes. Assess baseline traffic and conversion against a prospective experiment sample-size estimate. There is no universal traffic threshold and no guarantee of a result within 30 days. Explain low-traffic limitations before acceptance.

Invite five qualified stores initially. A manual invitation coordinates onboarding; it is not a security boundary. Existing application authentication and runtime deployment approvals remain authoritative. Do not claim a technical invite-token restriction has been implemented.

For each accepted store: inspect preview → confirm fit → send an authorized Shopify installation path when distribution permits → prepare and approve exact content → verify measurement and supported theme → obtain subscription approval when ready → approve that store's experiment scope. No application itself authorizes treatment or billing.

Expand only after checking onboarding completion, support effort, runtime capacity, measurement integrity, and rollback readiness. The infrastructure cap of 25 is a ceiling, not evidence that every traffic mix fits the instance.

## Recruitment experiment

First two weeks: prepare 40 carefully selected merchant candidates and 10 Shopify/paid-media agency candidates. Produce a specific ad-to-page observation and preview for each suitable merchant. Seek five activations; do not count applications or installs as activations.

Outreach requires an explicitly authorized recipient batch before sending. No bulk messages, purchased lists, or invented performance claims. Draft:

> I noticed your ad emphasizes [verified promise], while the linked product page leads with [verified observation]. Pagnetic previews a product message aligned with that ad and tests whether it improves sales. Would you like to see a preview for [product]? We are onboarding five Shopify stores, with a 30-day trial and $49/month afterward.

Agency draft:

> We are looking for Shopify stores running multiple ad messages to one product. Pagnetic helps align the page message and measure the result. Could one suitable client review a free preview? The first cohort is five stores; no promised lift or required theme rebuild.

After 20 delivered personalized contacts, inspect responses before scaling. Low replies: revise targeting or the observation. Interest without applications: simplify the request. Applications without activation: inspect setup friction, traffic suitability and trust. Positive product feedback without payment: revisit value and price through interviews. These are decision checkpoints, not industry conversion benchmarks.

Planning scenario only: 200 contacts × 10% interested × 25% activated = five active stores. Test actual conversion before spending on 200 contacts. Agency introductions may improve acquisition efficiency but are not guaranteed.

Weekly aggregate report: contacts, replies, qualified applications, invites, installs, activations, valid measurement, completed experiments, paying stores, acquisition source, and operator minutes per activated store. Report denominators and reasons for loss. Keep manual recruitment counts separate from existing anonymous in-app telemetry.

## Remaining launch gates

- Verify pagnetic.com routing separately from the already-published Fly origin.
- Configure and test approved pricing/trial in Shopify, preserving legacy entitlements.
- Resolve Shopify public distribution/review and obtain a valid installation path; limited listing visibility is not an approval bypass.
- Meet store-specific treatment/QA gates in doc65 before activation.
- Source and approve an initial outreach batch. No outreach was sent by this implementation.

No customer acquisition, revenue uplift, automatic application processing, or public App Store availability is claimed by this plan.

## Verified Shopify checkpoint, 2026-09-06

Partner organization 5157971 lists Pagnetic (app 418274574337) as **Public app / Draft / 0 installs**. Opening Manage submission redirects to `https://partners.shopify.com/5157971/apps/register`: the organization must complete its associated-account declaration, Partner Program Agreement verification, and one-time $19 registration payment. Owner input is required for the factual account declaration and payment. Pricing configuration, limited visibility and submission have not been saved in Shopify by this work. The complete first-pass listing copy and required image assets are prepared locally, ready to upload after registration.

Protected customer data draft has App functionality and Analytics selected, no optional name/email/phone/address fields selected, and 9/9 protection questions complete. Shopify states review happens after App Store listing submission. This is a completed draft, not production access approval.

The `https://pagnetic.com` connection timed out in this check; use the verified Fly origin until domain routing is repaired and verified. Do not advertise the custom domain as operational based on ownership alone.

## Deployment evidence

Public landing and terms changes deployed as `pagnetic:deployment-01M1W2VMAT1SKV1YCXYVEW8WMX`, machine version 25. TypeScript, lint and production build passed for the landing change; TypeScript and build passed again after the terms update. Fly health recovered after normal startup and returned 200 at 19:27:00Z; automation/privacy returned 200 and encrypted backup/restore verified at 19:27:04Z. Browser inspection of `https://pagnetic.fly.dev/` confirmed the new message, $49/30-day offer, five-store cohort and correctly addressed email application link. No billing or treatment flag was enabled.

DNS check: apex currently resolves to `31.186.11.254`; www points to the apex. Fly lists both custom-domain certificates as Not verified. Custom-domain launch remains open.

## Latest reviewed deployment, 2026-09-06

The approved commercial contract was corrected in code to the Founding Beta: USD 49/month, 30-day trial, one active product and up to three campaign messages. The older USD 99 draft remains historical and cannot be selected as the active offer. Shopify App Pricing verification requires the exact configured plan handle, monthly USD 49.00 contract and active state; Shopify's zero-cost development-store representation is accepted only for an explicitly allowlisted shop. Both billing and offer-publication flags remain off until the dashboard plan and end-to-end no-charge development-store path are verified.

Pinned Node 24 verification passed 360/360 tests, typecheck, lint, application build and Shopify extension build. Fly image `pagnetic:deployment-01M1W3XVM47FJF814A99ZKD94E` is running as machine version 26 with 1/1 health checks passing. Startup found all 28 migrations current, automation/privacy returned HTTP 200, and encrypted backup `pagnetic-993315cb-5051-420d-83ec-9f97d5315be9.sqlite.enc` passed remote readback and isolated restore. The production checker passes all 47 infrastructure checks. Billing/treatment flags were not enabled.

Listing assets are prepared in `docs/app-store-assets/`: 1200x1200 PNG icon, 1600x900 feature media, and three 1600x900 actual-interface screenshots. The remaining Shopify-controlled sequence is registration/payment, App Pricing plan configuration, listing upload, automated checks/protected-data review, no-charge development-store billing test, and submission.

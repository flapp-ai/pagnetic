# Shopify reviewer-store remediation candidate — September 19, 2026

Status: **LOCAL RELEASE CANDIDATE — NOT DEPLOYED OR RESUBMITTED**

## Current Shopify feedback

Shopify kept requirement 2.1.1 open after its reviewer store first showed a blank embedded document and then `Application Error`/HTTP 500. The prior stale-session repair remains deployed and the invited reviewer store now renders Overview and Messages. Shopify's latest 15-second recording shows a second usability blocker: a campaign attempt ends with `That campaign did not produce a distinct supported message. No treatment was created.` Shopify asked Pagnetic to configure the initial UTM setup in its store and provide a new store-specific screencast.

## Fresh reproduction

- Accepted the invitation sent to `bilgi@flapp.ist` and opened Shopify's `MugJestic` test store.
- Pagnetic Overview and Messages rendered inside Shopify Admin without a blank screen or `Application Error`.
- The invited account could view products but `Find a message opportunity` returned `This operation requires one of these pilot roles: OWNER, OPERATOR.` The first reviewer actor had received Pagnetic OWNER at installation; the later Shopify-authenticated setup account had no app-local role.
- The selected reviewer products use ordinary Shopify rich-text descriptions. Shopify's plaintext `description` field flattened HTML list items into one long run of text, leaving too few source boundaries for a safe three-fact draft even when the product page visibly contained several facts.

## Candidate repair

1. A later user who is already authenticated by Shopify and allowed to open the installed app is bootstrapped as Pagnetic `OPERATOR`. The first app user remains `OWNER`. Existing inactive roles stay inactive. Operator setup actions work; owner-only approvals, privacy access, billing controls, and role grants remain restricted.
2. Catalog sync requests Shopify's documented `descriptionHtml` in addition to plaintext. HTML paragraph/list boundaries are converted to text separators only when Shopify plaintext has fewer than three usable statements. Existing well-formed plaintext remains canonical, limiting source-hash churn.
3. Campaign fields open by default when no draft exists and explain that mapping does not edit ads or start a test.
4. A valid mapping is reported as saved even when the evidence-safe composer abstains. The UI names the exact recovery: choose another product or provide at least three factual benefits, with one supporting the ad message. Original remains active.
5. Unsupported content still cannot create a treatment. The fix improves access, source parsing, and recovery language; it does not weaken claims controls or auto-approve content.

## Local verification

- Full `pnpm check`: **445/445 tests passed**.
- TypeScript, ESLint, production app build, and Shopify extension build passed.
- Concurrent-role tests cover one OWNER plus later OPERATORs on SQLite pool sizes 1 and 4, preserve inactive roles, allow operator work, and reject owner-only work.
- Product-source tests preserve HTML list boundaries, retain already-good plaintext unchanged, and produce a supported campaign diagnosis for an Ariel Mug fixture using the exact source statement `Dishwasher and microwave safe`.
- No production deployment, reviewer-store configuration, public visibility, charge, order, experiment, or Shopify response changed during this local gate.

## Exact post-approval sequence

1. Deploy this candidate to the existing single-machine Fly release; do not add capacity or paid services.
2. Verify `/healthz`, Fly machine health, and repeated embedded Overview/Messages/Results/Settings navigation in both the owned development store and `MugJestic`.
3. Refresh `MugJestic` catalog through the normal authenticated app workflow.
4. Select `Ariel Mug`, run the source review, and configure:
   - UTM source: `shopify_review`
   - UTM campaign: `mug_safe_20260919`
   - UTM content: `dishwasher_microwave`
   - Message angle: `Universal`
   - Exact ad message: `Dishwasher and microwave safe Ariel Mug.`
5. Confirm a source-backed draft is created from the store's exact facts. Do not perform owner-only approval from the invited Operator account and do not activate an experiment.
6. Record one continuous English screencast in Shopify's store showing install access, product selection, UTM/ad configuration, source-backed draft, exact evidence, Original fallback, and navigation without HTTP errors. Do not expose tokens, customer/order details, or claim lift.
7. Host the reviewed video at the existing bounded reviewer path, confirm HTTP 200/full playback, and prepare the requirement 2.1.1 proof text.
8. Stop for owner approval before sending the Shopify response or clicking the final resubmission control.


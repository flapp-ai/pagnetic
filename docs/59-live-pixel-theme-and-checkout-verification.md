# Live pixel, theme and checkout verification

Date: 2026-09-06. Operator: Astra, under the owner's approved synthetic test plan.

## Release

- Source SHA-256: `04527209ccd80f350c3fc83f8dc256e83a2469d21730d69605714119e6fe7db5`, independently matched after Sol's unchanged-source full check (343/343 tests, typecheck, lint, application and Shopify builds).
- Fly release: `reviewed-04527209ccd8`; image `deployment-01M1V51R2B8QRVV4QVEA1F73MT`, digest `sha256:420373328c62c2ba85780c0c96f770996de45f51a8a9836523f938dfd7a51d0e`.
- Machine `d8d1497a937658`, version20, Frankfurt. Public health200 and Fly1/1 passed after the normal restart. Startup automation/privacy200 at10:46Z.
- Shopify version `pagnetic-v2-04527209-20260906`, version ID `1117666115585`, released successfully to the existing Pagnetic app. Both extensions built.
- Pre-deployment encrypted backup `pagnetic-5a929703-ef11-4aed-abf3-13b287a1d932.sqlite.enc` restored in1102ms. Post-deployment automatic backup `pagnetic-c6e2ac5f-77be-477a-832a-2288b3c70207.sqlite.enc` restored in1008ms. Local obsolete verified cache pairs were pruned; remote objects were retained.

## Retained scope and approval

Only merchant: `test1-eczm2zce.myshopify.com`. V2 enabled to observe the held runtime; shadow/model/offer/billing remain disabled. The exact selected-product migration kill switch remains active. No treatment or baseline activation was performed.

Owner-approved plan `cmtpnibba00slq6ld06vi5haa`, hash `9c3d1d834014e84d4e850dbf1795d75d82fc9afe4f1608a54ac5c32e60ec40db`, approval timestamp `1788690016791`, receipt `cmtpmvlu500f3q6lbj336xp2g`. Product: internal `cmtpl078j0042q6m2tyug5g3t`, Shopify `gid://shopify/Product/10345426977074`.

## Observed results

1. Shopify Customer events shows the installed Pagnetic pixel with data access granted and preferences+analytics permission requirements.
2. Before pixel release, actual event requests returned400. After release, the published synthetic product generated accepted202 events. No token or payload credentials were exposed to diagnose this.
3. Production persisted the exact product's `product_viewed` and `adaptive_storefront_decision` events with `analytics_and_preferences_allowed`. The latter is `STOREFRONT_BRIDGE`, Original/KILL_SWITCH_ACTIVE, null decision/assignment/experiment authority.
4. Published product DOM has exactly one autopilot panel, hidden, unmeasured, KILL_SWITCH_ACTIVE. At1728x804 there is no horizontal document overflow. This one desktop observation does not certify mobile or performance population budgets.
5. Existing published theme187666989362 already had exactly one Adaptive Panel in Pagnetic Autopilot mode; Save was disabled. No duplicate block or artificial theme edit was made.
6. Authenticated **I saved it — verify now** succeeded: “Published theme verified.” Plan moved to VERIFYING; current-product QaEvidence contains only placement PASS and original_fallback PASS. Seven operator evidence checks remain pending.
7. Standard cart path contained exactly one synthetic pouch ($10 merchandise). Checkout explicitly displayed Shopify Test Payment Gateway. Used synthetic example.com contact/address, gateway1, future expiry; no marketing subscription. Simulated total$18 includes$8 shipping. Checkout confirmed the order. Server-side reconciliation is checked separately below; this is not proof of signed attribution or live revenue.
8. Shopify order#1008 (`gid://shopify/Order/9140328169778`) displayed Paid and Test order. Pagnetic received checkout_completed with null decision authority and both ORDERS_CREATE/ORDERS_UPDATED webhooks. The canonical ledger classified it TEST_ONLY/test=true, obligation1800 cents, complete lines/transactions/refunds and no GraphQL errors. Inbox rows nevertheless became RETRY/FINANCIAL_RECONCILIATION_PENDING; terminal test-order handling is a newly observed defect assigned to Sol, not a passing end-to-end receipt.
9. Shopify successfully refunded the single $10 merchandise line using Bogus Gateway, restocked the synthetic unit and retained$8 shipping. Notification was unchecked. No real charge, payout, fulfillment or shipment occurred. Refund ledger verification remains pending the worker correction.
10. Fresh production readiness check passes database, credentials, encryption, scheduler and verified backup configuration, but fails exactly alertDeliveryConfigured and publicIdentityConfigured. The backup result explicitly still requires independent receipt replay/full incident recovery; the checker is not a complete launch certificate.

## Still open

- Current Overview promotes notices from an invalidated legacy plan and a superseded preparation job. Their history must remain, but they should not be current actions; a bounded presentation correction is in progress.
- Seven release-bound private QA artifacts, actual checkout/reconciliation/refund and consent paths, mobile/browser and performance evidence; then owner QA approval and governed hold release. No fabricated receipts or blanket PASS records were written.
- Alert delivery connection (recipient already selected as bilgi@flapp.ist), owner-approved terms effective date, remaining recovery/usefulness/distribution gates. Public launch is not approved by this test deployment.

## Final bounded follow-up

Sol's unchanged-source full check passed345/345 plus typecheck/lint/application/Shopify builds for source `a95871187e13889de6a215899f15b26031e2f4bf4e9a6e81969bf7b4eb2f0637`; main independently matched it before deployment. The package separates current actionable notices from accessible historical workflow notices, derives the exact authenticated missing-QA list, and treats complete/conflict-free TEST_ONLY orders as terminal inbox work without creating attribution. Incomplete/conflicted reads still retry. No schema or extension source changed in this follow-up; the already released Shopify version remains applicable.

Pre-deployment backup `pagnetic-f6635482-6c28-46aa-8a00-ef88f675bfce.sqlite.enc` restored in1117ms. Fly deployed `reviewed-a95871187e13`, image `deployment-01M1V60BCFB64PBAAPD67MCVWN`, digest `sha256:047559bc0b181fd47f0dacfffb3bfc7106d884ea807043d66c3e8eb9eec2933c`. Post-start health, same-order reconciliation and current-release runtime verification are being checked; deployment success does not mark those checks passed.

Observed after that deployment: machine21 and public health200/Fly1of1; startup automation/privacy200; backup `pagnetic-ef4687b4-c9ab-48bb-8d06-c84e7a47405e.sqlite.enc` restored in1568ms. All four actual order/refund inbox rows are PROCESSED, lastErrorCode null. The test order remains TEST_ONLY, and RefundLedger records1000 cents against its actual merchandise line. Prior workflow notices appear in expandable history rather than driving the current headline.

Chrome device-toolbar checks on the published synthetic product at320x844,390x844,768x844 and1440x844 showed document width equal to scroll width. At320/390/768 the Add to cart and Buy it now controls were enabled and within viewport bounds; the390 screenshot was visually checked. The autopilot panel stayed hidden/KILL_SWITCH_ACTIVE. The ordinary viewport override API did not actually resize this Chrome session, so it was not used as evidence; native device-toolbar dimensions were independently checked in DOM. Emulation was disabled and normal1728 width restored afterward. These are responsive Chrome observations, not actual iOS/Safari, consent-flow or population-performance certification.

The release change correctly invalidated placement/fallback evidence, exposing a missing re-verification control in VERIFYING. The final UI-only correction uses the existing authenticated action without resetting the plan and is shown only while those checks are missing. Full pinned check346/346 and all builds passed with unchanged source `4f301154fcd9ef538feb46bd1da60a32f7ec5cde48c4db410ff569de04f94032`; main independently matched it. Final deployment/current-release verification follows below. No additional extension or schema change is involved.

## Final live checkpoint — 2026-09-06T11:12Z

- Live `reviewed-4f301154fcd9`; Fly image `deployment-01M1V6G6GZ2ETKHVMW53VNYZF9`, digest `sha256:19e2f3c81b8214bf62598bf65fa7c94ccd9a3f29ba3b6fd75ec7dc0757387800`, machine22. Public health200 and Fly health passed after the normal single-machine restart. Startup automation/privacy200 at11:11:22Z.
- Automatic encrypted backup `pagnetic-878ac671-0c49-4cd0-980a-fa0b6465bb24.sqlite.enc`, isolated restore1206ms. No pending migration;27 total.
- Actual **Verify current release now** succeeded with fresh published-product runtime evidence. UI returned “Published theme verified,” retained VERIFYING, removed the recapture control and now accurately lists seven pending operator checks: mobile, desktop, standard checkout, accelerated checkout, Shop Pay, consent flows and performance.
- All four synthetic order/refund webhooks remain PROCESSED with no last error. No v2 attribution exists for test order#1008. The exact migration hold remains active; billing/model/shadow/offer remain disabled. No public launch or treatment claim.
- Owner status tab retained for handoff. Chrome temporary device emulation was reset. No operator QA artifacts were promoted into blanket PASS receipts; responsive/checkout observations above remain scoped evidence, not final approval.

### Required next decisions/evidence

Owner: approve a terms effective date (6 September2026 proposed, not assumed) and authorize an operational email sending connection for bilgi@flapp.ist. DNS MX/SPF point to Google Workspace; no normal email password should be sent in chat. Recipient selection alone is not delivery configuration.

QA: finish supported checkout/Shop Pay applicability, consent revocation/regrant, supported device/browser and performance evidence, store the reviewed private artifacts and obtain owner sign-off. Then the existing governed activation control can release only the exact migration hold. Independent recovery/usefulness and public-distribution gates remain separately applicable; neither test payments nor346 passing automated tests prove market lift or complete launch readiness.

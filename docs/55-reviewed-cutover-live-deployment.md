# Reviewed cutover live deployment

Date: 2026-09-06. Status: deployed healthy; v2 activation and public launch held.

## Release and verification

- Source: `3cd01f44ba501a0ab381be8cabe387b1582c9a4a66e8812bc4757266d3d4548d`,322 files. Matches Sol's unchanged before/after338-test full check. Main performed bounded review and source verification, not a second full suite.
- APP_RELEASE: `reviewed-3cd01f44ba50`.
- Fly image: `registry.fly.io/pagnetic:deployment-01M1TWX91QC6905R51HN4MTBZB`.
- Digest: `sha256:ccb9fabb50d6d224d2b5687c37361889cca3c359745f21ed12bf013207c6d626`.
- Machine: `d8d1497a937658`, version16, FRA, single writer. Health recovered after normal image replacement/startup; HTTP health200 and Fly1/1 passing.
- All27 migrations applied, including nullable cutoverReceiptId/index. Legacy plan `cmtnb5w6j003fq6kvny97khn7` remains VERIFYING with protocol autopilot-plan-v1.
- Preserved plan hash: `0e454982fc549815a977a7748fbf945e5424790a65a6a00b7196945770187911`.
- Preserved approval JSON SHA256: `15f8658663588d2263b4b6f08042b5a0b72987946018770eaa26bffb5002b1ef`.
- V2, shadow, model, offer publication and billing flags all false. `PAGNETIC_V2_CUTOVER_SHOPS` is exactly `test1-eczm2zce.myshopify.com`.
- Fresh pre-deployment backup: `pagnetic-237f0e54-a05a-4c98-967a-6073aa3a114e.sqlite.enc`, restore1054ms, remote objects unchanged.
- Automatic post-deployment backup: `pagnetic-043ea523-9841-4d1a-8e61-f5d71e8ade7a.sqlite.enc`, restore972ms. Production checker verified encrypted off-volume readback, privacy sidecar and isolated restore at08:23:50.263Z.
- Startup maintenance08:23:48Z: automation200/836ms followed by privacy200/33ms. No manual request was used to substitute for this startup cycle. Two later natural scheduled cycles still require observation.
- Public `/healthz`, `/privacy`, `/terms`, `/support` returned200. An HTTP200 legal page is not legal approval.

## Exact blockers and next actions

1. Mac/browser access recovered. The current blocker is Shopify itself: the refreshed admin page twice displayed its HTTP500 error screen. Read-only production AutomationRun evidence independently records Shopify GraphQL HTTP500 failures at08:48:50Z and08:53:50Z, followed by a successful scheduled run at08:58:51Z. Pagnetic health remains200. Do not misclassify these upstream errors as recurrence of the prior SQLite timeout.
2. Follow docs52: explicit cutover receipt, publish/sync the synthetic fixture if needed, safe reselection, fresh owner content approval, exact migration hold, then flag enablement while Original remains forced. None of these actions was bypassed through direct database writes.
3. Owner confirmed the team is owner plus Codex and explicitly chose to approve QA personally. Local correction allows existing active OWNER or OPERATOR without granting/changing any role. Focused cutover tests pass including positive owner evidence, missing role refusal and inactive-owner refusal. Deployment of this permission correction remains pending the integrated recovery package. Actual evidence still requires owner review; the permission change is not approval of any test result.
4. Record actual scoped nine-check browser evidence, then release only the exact hold and verify Original baseline/rollback. Test orders do not establish causal lift or PMF.
5. Production checker fails exactly `alertDeliveryConfigured` and `publicIdentityConfigured`. Owner selected `bilgi@flapp.ist` as the operational alert recipient. The current implementation accepts an HTTPS webhook, not a direct email recipient; an email delivery integration or approved webhook-to-email service and delivery verification remain required. This selection is not evidence of configured delivery. Owner must also approve the terms effective date; credentials must not be pasted into chat.
6. Retain independent recovery release review, human content usefulness review and commercial readiness gates from docs26. Managed PostgreSQL/multi-store readiness is not established by this single-writer deployment.

Deployment is complete. Customer-facing v2 activation, full end-to-end acceptance and launch readiness are not complete.

## Browser continuation after unlock

The deployed authenticated Overview displayed the explicit cutover action. One submission returned `V2_CUTOVER_SOURCE_CHANGED`, correctly refusing stale catalog evidence. A refresh and one bounded recovery reload each encountered Shopify's own500 page, so there was no blind resubmission, direct-DB workaround or activation. Resume by refreshing Shopify after recovery and reviewing current source before the next cutover submission.

Natural maintenance evidence: retained Fly logs show automation/privacy200 at08:43:49Z and08:58:51Z. Durable automation records additionally show successive completed five-minute runs before08:43; the later two failed runs explicitly identify upstream GraphQL500. This demonstrates operation of the deployed scheduler, not uninterrupted Shopify availability or production capacity certification. The narrowly specified two-consecutive-cycle paired-endpoint log proof has not been retained for the earlier cycles and should not be retroactively invented.

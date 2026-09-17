# Test1 QA receipt requirements — September 17, 2026

Scope: fresh root-reviewed browser evidence only. No activation, hold change, paid order, public rollout, deployment, push or Shopify submission.

## Live read-only checkpoint

Fly SQLite inspection confirmed product `cmtpl078j0042q6m2tyug5g3t`, approved plan `cmtzdcx1r00m1q6larwx71jys` version2 in `VERIFYING`, cutover `cmtzd7f0k007kq6lafgyydxtc`, published theme `gid://shopify/OnlineStoreTheme/187666989362`, active dedicated `test1:operator:codex-astra` OPERATOR and unchanged recovery kill switch. Only placement and Original fallback receipts are present. Root-provided expected current APP_RELEASE is `402fe1b55566b865f9a84092746bf9bd1c7e5f15`; verify runtime value before recording.

## Substantive acceptance

The recorder does not inspect screenshots or calculate performance. These are evidence-review requirements, not automatic source assertions.

| Check | Required fresh observation and honest scope |
| --- | --- |
| mobile | Actual storefront at stated mobile viewport/device, native price/variant/purchase controls usable and unobstructed, no layout overflow; include Original held-state and demo state separately if tested. Desktop emulation is not physical-device proof. |
| desktop | Actual canonical storefront at stated viewport, native purchase controls and layout intact; identify panel/hold/demo state. |
| standard_checkout | Native Add to cart preserves exact synthetic product/quantity/price; cart proceeds to native checkout. State deepest tested stage and that no payment/order was submitted if true. This is not paid-order attribution proof. |
| accelerated_checkout | Actual available direct-buy route reaches native checkout without obstructed purchase controls; record route and endpoint/origin. Do not imply wallet/Shop Pay coverage. N/A requires actual capability evidence, not an unavailable automation selector. |
| shop_pay | Actual configured capability and checkout observation; use N/A only when Shop Pay is not configured/available on this store. Preserve Payments capability screenshot privately. |
| consent_flows | Ordered native deny, partial deny, grant, revoke and denied reload; inspect relevant panel state and fallback. Capture transient failure code immediately if encountered; successful retries do not erase it. |
| performance | Frozen PRD24 section13.2: server p95≤150ms; client p95≤1000ms and Original by absolute1500ms on relevant devices/geographies; supported-theme before/after LCP/INP/CLS distributions, confidence and sample reporting; proposed p75 degradation budgets100ms/20ms/0.02; mixed storefront/webhook/reporting load at2× evidence-derived forecast peak with p50/p95/p99, fallback%, DB waits, queue age, RSS/errors and cohort cap. Synthetic diagnostics alone cannot certify this. |

## Artifact and receipt integrity

- Preserve exact reviewed evidence bytes with capture time, release, shop/product/theme context, viewport, ordered observations and explicit limitations. Redact PII/session material before approval; any byte change requires a new review and SHA.
- CLI requires a regular non-symlink local file, nonempty and at most5MiB. Capture cannot be future or more than14days old. Evidence expires30days after capture.
- Upload approved bytes privately first; `scripts/record-v2-qa-evidence.ts` does not upload. No public URL or semantic filename may be used as the receipt locator. Root authorized persistent `/data/qa-artifacts/<SHA256>` storage, with node ownership, directory0700 and file0600. Read-only runtime check verified APP_RELEASE exactly matches the expected release, root SSH access and a node-owned `/data` mount; the artifact directory does not yet exist. This is private attached-volume evidence storage, not an external object bucket or independent backup.
- Use `qa-artifact:v1:<64-lowercase-hex-opaque-key>`. Prefer the exact byte SHA256 as private object key. Source only checks locator format: it does not fetch the object or check that locator key equals artifactSha256. Verify stored bytes independently.
- Recorder hashes local bytes as `artifactSha256`, loads current approved cutover with current-source validation, requires unchanged recovery hold and fresh published-theme verification, and authenticates the provisioned actor. It binds merchant/product/cutover/theme/template, null deployment, check/applicability, capture/actor/authority, artifact locator/SHA and runtime APP_RELEASE into the immutable receipt/input hash.
- Progress rejects altered receipt payloads or mismatched merchant/product/cutover/theme/template/release. A new release requires recapture. Only accelerated_checkout and shop_pay allow NOT_APPLICABLE.
- Use a unique8–160character idempotency key containing cutover/check/date or version. Same key and identical input replays; changed input conflicts. Do not edit QaEvidence directly.

## Persistence command template

Run only after root approves exact bytes and private storage, against authoritative Fly runtime/database with its actual APP_RELEASE, not a locally substituted release.

```sh
pnpm exec tsx scripts/record-v2-qa-evidence.ts \
  --apply --shop test1-eczm2zce.myshopify.com \
  --product-id cmtpl078j0042q6m2tyug5g3t \
  --check-key <reviewed-check> --applicability <reviewed-applicability> \
  --artifact-file <private-reviewed-file> \
  --artifact-ref qa-artifact:v1:<verified-private-object-SHA256> \
  --actor-key test1:operator:codex-astra \
  --idempotency-key v2-qa:cmtzd7f0k007kq6lafgyydxtc:<check>:20260917-v1 \
  --captured-at <actual-UTC-capture-time>
```

Return receipt/evidence IDs and check only. Verify Overview progress and unchanged hold afterward. No performance PASS may be substituted for lab diagnostics. Root owns browser evidence and final acceptance.

Transfer sequence: create the authorized directory with `install -d -o node -g node -m 0700 /data/qa-artifacts`; use `fly ssh sftp put -a pagnetic --mode 0600 <approved-local-file> /data/qa-artifacts/<SHA256>`; set uploaded file owner node:node and0600; compare remote `sha256sum` to local SHA256 before invoking recorder through `gosu node`. Do not overwrite an existing hash path without first verifying identical existing bytes. Directory creation and transfer await root's exact approved artifact manifest. No credentials, URLs containing session/demo tokens, or shopper PII belong in these files.

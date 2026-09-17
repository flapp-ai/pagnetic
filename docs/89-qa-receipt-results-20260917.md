# Official test1 QA receipts — September 17, 2026

Six root-reviewed check artifacts from [doc88](./88-root-browser-qa-20260917.md) were preserved exactly, transferred privately to the attached Fly volume and accepted through the existing authenticated recorder under provisioned operator `test1:operator:codex-astra`. No direct QA-table edits were made.

Capture/review checkpoint:2026-09-17T06:24:28Z. Runtime APP_RELEASE verified `402fe1b55566b865f9a84092746bf9bd1c7e5f15`. Plan `cmtzdcx1r00m1q6larwx71jys`, product `cmtpl078j0042q6m2tyug5g3t`, cutover `cmtzd7f0k007kq6lafgyydxtc`, published theme `gid://shopify/OnlineStoreTheme/187666989362` and active operator were verified immediately before recording.

## Accepted immutable receipts

| Check | Status | Receipt ID | Evidence ID |
| --- | --- | --- | --- |
| mobile | PASS | `cmu55cipb0003q6q0qt1nhswi` | `cmu55cipc0005q6q03w9ccs79` |
| desktop | PASS | `cmu55ckic0003q6r50x55kg5l` | `cmu55ckid0005q6r5evi70j5p` |
| standard_checkout | PASS | `cmu55cmf50003q6s1kk7cbkhs` | `cmu55cmf50005q6s134ro504e` |
| accelerated_checkout | PASS | `cmu55coe40003q6sxmziwr0nn` | `cmu55coe50005q6sxb0pfp8kk` |
| shop_pay | NOT_APPLICABLE | `cmu55cqci0003q6tu6p7sdege` | `cmu55cqcj0005q6tumoc80t65` |
| consent_flows | PASS | `cmu55cs7i0003q6uqbwevozk7` | `cmu55cs7j0005q6uqldgfwpl8` |

All recorder calls returned ok:true and replayed:false. Idempotency pattern:`v2-qa:cmtzd7f0k007kq6lafgyydxtc:<check>:20260917-v1`.

## Private bytes

Storage:`/data/qa-artifacts/<SHA256>`, directory0700 and files0600, owner node:node. All six independent remote sha256sum results exactly matched root-approved local bytes and locator SHA values. Receipt locators are `qa-artifact:v1:<SHA256>`; the recorder independently hashes artifact bytes into its release/scope-bound receipt.

| Check | Exact approved and stored SHA256 |
| --- | --- |
| mobile | `625fa8e374f31c4048f1fa6b200ed00a5dd12815961d48b8c73e158f6675613e` |
| desktop | `ca836adeb79d8c11448b1b1c4f7485171e84a996fbfc954c3735f9a0b5a79279` |
| standard_checkout | `1dc909278f64cf22c6312e05bbc03480c6f846756970c8135797076023e9537b` |
| accelerated_checkout | `78ab10592290a3fd0b7dae0d18d3c5f46ef1b5f03eec9f3162809ae7988925da` |
| shop_pay | `87a5ed6df189b02165299c1865ef324ea32317adb4554ac81e8cbfe0a31ca32b` |
| consent_flows | `10d493fd90cdb24fb98899da1157bd90399842ed4e6e31a0135b3aec814425ba` |

This is private durable attached-volume storage, not a public URL, external bucket or independently backed-up evidence store. No signed URLs, sessions, PII or credentials were introduced into receipt artifacts. Packaged doc88 and approved archive bytes were not modified.

## Live authenticated result and cleanup

The read-only `loadAuthenticatedV2QaEvidenceProgress` service used by Overview returned eight accepted checks:placement, mobile, desktop, standard_checkout, accelerated_checkout, shop_pay, consent_flows and original_fallback. Only `performance` remains pending.

Postwrite database inspection confirmed plan remains `VERIFYING`, killSwitch remains1 and exact existing recovery-hold reason is unchanged. Demo lease stoppedAt is1789626141534 (2026-09-17T06:22:21.534Z). Root's actual stopped-link UI returned DEMO_STOPPED, canonical storefront retained KILL_SWITCH_ACTIVE, and empty cart was verified in doc88. No performance receipt, baseline activation, hold release, payment/order, deployment, push, public rollout or Shopify submission occurred.

8/9 describes experimental activation QA, not Shopify acceptance or full public-launch readiness. Performance's field/capacity gate stays pending; local diagnostics do not close it. Shopify resubmission remains a separate owner-approval decision.

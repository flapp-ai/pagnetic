# Pagnetic v2 message-quality evaluation

Updated: 2026-09-05  
Rules: `message-diagnosis-v2.1`  
Default adapter: `deterministic-source-composer-v2.1`

## Supported MVP scope

- English Shopify product evidence for low-claims-risk products.
- One public product URL plus optional exact merchant-supplied campaign/ad text, capped at 2,000 characters.
- One primary source-backed message change and at most one materially different alternative.
- Exact product-source spans only. The deterministic adapter does not paraphrase product facts, browse for evidence, infer an ad from UTM labels or execute source instructions.
- Gap labels are limited to `BENEFIT_NOT_PROMINENT`, `OBJECTION_UNANSWERED` and `CAMPAIGN_PROMISE_NOT_REFLECTED`.
- If a useful supported change cannot be produced, the output is `NO_SUPPORTED_OPPORTUNITY` or `UNSUPPORTED_SOURCE` with one concrete source correction. It is not silently replaced with generic “optimized” copy.

The optional model adapter remains disabled by default. Enabling it later requires a configured provider and spend/data authority, background-only execution, traceable evidence IDs, the same deterministic validators and merchant approval. A model output cannot approve or deploy itself.

## Automated evaluation matrix

`tests/message-diagnosis-v2.test.ts` exercises a fixed 50-case matrix across five repeated fixture families:

| Family | Expected behavior |
| --- | --- |
| Low-risk accessory with a supported clarity/campaign opportunity | Produce a reviewable primary candidate; every displayed sentence equals an extracted source span |
| Irrelevant or unsupported ad promise | Abstain and request an explicit supporting product fact or revised campaign input |
| Short/repeated/identical product facts | Abstain; do not create differently labelled copies of the same body |
| Explicit unsupported locale | Return `UNSUPPORTED_SOURCE`; no candidate |
| Instruction-like product source | Exclude the hostile span and never execute or display it in a candidate |

Additional targeted cases cover campaign evidence already present in the description, high-risk claims, excluded product categories, contradictory source facts, 2,000-character campaign limits, tenant isolation, immutable evidence hashes, idempotent mapping replay and claim-to-evidence persistence.

## Interpretation limits

Passing the automated matrix proves deterministic invariants, not that merchants find the copy useful. Before customer launch, a human-reviewed 50-item set must record product/category/locale, source, campaign input if any, expected gap, actual gap, proposed text, source links, abstention reason, fabricated-claim result and a useful/clear rating. Launch targets from the PRD remain:

- zero fabricated claims or evidence;
- every rejected case categorized;
- at least 80% useful/clear drafts inside the declared supported subset.

Those targets require independent human review and must remain unverified until the completed rubric is saved. The matrix must include irrelevant ads, short sources, contradictions, excluded categories, markup/script injection, unsupported language and exact duplicate outputs. Test fixtures do not establish market lift or semantic understanding.

## Ready-to-review human pack

- Review sheet: [`evaluation/message-quality-human-review-v1/README.md`](./evaluation/message-quality-human-review-v1/README.md)
- Complete machine-readable cases: [`evaluation/message-quality-human-review-v1/cases.json`](./evaluation/message-quality-human-review-v1/cases.json)
- Reproducible generator: [`../scripts/generate-human-message-review.ts`](../scripts/generate-human-message-review.ts)

The pack contains 50 explicitly synthetic cases generated through the current `diagnoseProductMessage` implementation: 23 supported-output cases and 27 required-abstention cases. It covers low-risk supported products, irrelevant campaigns, short/repeated and identical sources, contradictions, excluded categories, hostile markup/instructions and unsupported language. The generator verifies the expected propose/abstain behavior, exact output-to-source-span equality and resolvable evidence IDs. All human reviewer, usefulness, fabrication and rejection fields are empty; generating the pack does not pass the human gate.

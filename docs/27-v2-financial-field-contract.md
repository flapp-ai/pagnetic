# Pagnetic v2 financial field contract

## Current intended-store adapter evidence — 2026-09-06

On deployed `reviewed-65f2cb62a661`, invoked the actual `fetchShopifyFinancialOrderV2` and `normalizeShopifyFinancialSnapshotV2` against Shopify Admin API2026-07 for previously paid/full-refunded test order#1007 (`gid://shopify/Order/9140091912498`). Policy reported `pagnetic-financial-v2.2`. Source completeness: lines/transactions/refunds/refundChildren alltrue, graphQlErrorsfalse. Result: one line, one refund, three transactions, original obligation69995USD minor units, no unresolved reasons. Both payment and reconciliation states are TEST_ONLY; `netFocalMerchandiseV2` returnsnull rather than counting a test order as efficacy revenue.

The probe performed authenticated provider reads and in-memory normalization only; it did not write a ledger, attribution, experiment or order. Only allowlisted financial summaries were emitted, not shopper details, custom attributes or tokens. This verifies the actual query/field mapping for this one full-refund test-order shape. It does not verify partial refunds, tax-inclusive semantics, mixed carts, reordered live inbox processing, or non-test efficacy attribution. Earlier contract/version statements below are the historical planning baseline; implementation is no longer wholly pending.

Version: `pagnetic-financial-v2.1`  
Prepared: 2026-09-05  
Scope: S03 / R06 / AT08–AT12 in the [executable PRD](./24-pagnetic-mvp-v2-executable-prd.md)  
Status: API documentation and current legacy code inspected; v2 adapter and real-store financial fixtures still require implementation and verification.

## Source and version authority

The app currently declares Shopify Admin API `2026-07`. The official documentation links below redirected to `latest` when checked; the fetched pages explicitly identified `2026-07` as latest. Pin the actual adapter requests and fixture metadata to `2026-07`; never rely on the moving documentation alias at runtime. GraphQL validation against the configured store/API is required before this contract is marked verified.

Webhooks authenticate the sender and trigger durable ingestion. Canonical Admin API reads provide missing payment, line and refund information. Do not turn a minimal order-created payload or the browser's checkout-completed event directly into a financially reconciled order. Do not reuse the legacy `orderPayload()` projection: it drops line identities, discounts and transaction history.

## Required source fields

For every MoneyBag below select `shopMoney { amount currencyCode }`. Preserve source decimals until exact minor-unit parsing. Never infer currency from a different amount field.

| Resource | Required fields | Adapter responsibility |
| --- | --- | --- |
| Order | `id`, `legacyResourceId`, `createdAt`, `updatedAt`, `cancelledAt`, `test`, `currencyCode`, `taxesIncluded`, `displayFinancialStatus`, `originalTotalPriceSet`, `totalPriceSet`, `transactionsCount`, `lineItems`, `refunds`, `transactions` | Tenant identity, source watermark, original payment obligation and complete children |
| LineItem | `id`, `product { id }`, `variant { id }`, `isGiftCard`, `sellingPlan { name }`, `quantity`, `currentQuantity`, `customAttributes { key value }`, `originalTotalSet`, `discountAllocations`, `taxLines`, `priceAfterAllDiscountsBeforeTaxesSet` | Focal identity, signed reference, exact discounts and pre-tax merchandise |
| DiscountAllocation | `allocatedAmountSet`, `discountApplication { index }` | Preserve each allocation once within its parent line snapshot |
| OrderTransaction | `id`, `kind`, `status`, `test`, `amountSet`, `processedAt`, `createdAt`, `parentTransaction { id }` | Independent transaction identity and payment/refund settlement state |
| Refund | `id`, `order { id }`, `createdAt`, `processedAt`, `updatedAt`, `refundLineItems`, `transactions`, `orderAdjustments` | Parent scope and complete refund processing history |
| RefundLineItem | `id`, `lineItem { id }`, `quantity`, `subtotalSet`, `totalTaxSet` | Deduct the correct original line once |
| OrderAdjustment | `id`, `amountSet`, `taxAmountSet`, `reason` | Detect unresolved non-line monetary changes |

The order object exposes financial and child-resource information; an order number is not a tenant-safe unique key. Its `taxesIncluded` flag determines whether line prices already contain tax. [Order reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order).

`discountedTotalSet` omits order-level discounts; `discountedUnitPriceAfterAllDiscountsSet` is approximate. `quantity` includes returned/removed units, while `currentQuantity` excludes them. `priceAfterAllDiscountsBeforeTaxesSet` describes remaining merchandise after discounts and removals/refunds, so subtracting refunds from it again is incorrect. [LineItem reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/LineItem).

Allocated discounts carry their own MoneyBag and application reference. Use them to avoid repeating order-level discount allocation locally. [DiscountAllocation reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/DiscountAllocation). Tax lines expose exact amounts; do not recompute tax using floating point or a guessed rate. [TaxLine reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/TaxLine).

Transactions distinguish payment operations and processing status. Preserve timestamps and parent relationships; exclude authorization and failed operations from captured sales. [OrderTransaction reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderTransaction).

A refund object alone does not establish successful repayment. Inspect its associated transaction statuses. Fetch refund line, transaction and adjustment connections completely. [Refund reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Refund). Line refunds identify their original line and separately expose subtotal and tax. [RefundLineItem reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/RefundLineItem). Keep adjustments separate until their monetary scope is resolved. [OrderAdjustment reference](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderAdjustment).

## Normalized internal contract

Implement equivalent typed contracts, with runtime validation at the adapter boundary:

```ts
type MinorMoney = { minor: string; currency: "USD" | "EUR" | "GBP" | "TRY" | "ILS" };
type SourceCompleteness = {
  lines: boolean;
  transactions: boolean;
  refunds: boolean;
  refundChildren: boolean;
  graphQlErrors: boolean;
};
type CanonicalFinancialOrderV2 = {
  schemaVersion: 2;
  apiVersion: "2026-07";
  policyVersion: "pagnetic-financial-v2.1";
  merchantId: string;
  orderId: string;
  createdAt: string;
  sourceUpdatedAt: string;
  observedAt: string;
  test: boolean;
  currency: MinorMoney["currency"];
  originalObligation: MinorMoney;
  completeness: SourceCompleteness;
  sourceHash: string;
  lines: Array<{
    lineId: string;
    productId: string | null;
    variantId: string | null;
    giftCardProduct: boolean;
    sellingPlan: boolean;
    merchandiseBeforeRefunds: MinorMoney | null;
    signedAssignmentReference: string | null;
  }>;
  transactions: Array<{
    transactionId: string;
    parentId: string | null;
    kind: string;
    status: string;
    test: boolean;
    processedAt: string | null;
    amount: MinorMoney;
  }>;
  refunds: Array<{
    refundId: string;
    sourceUpdatedAt: string;
    transactionIds: string[];
    lines: Array<{
      refundLineKey: string;
      lineId: string;
      merchandise: MinorMoney | null;
      tax: MinorMoney;
    }>;
    hasUnresolvedAdjustment: boolean;
  }>;
  unresolvedReasons: string[];
};
```

Nullable merchandise means unresolved evidence, not zero. Record the source mapping and normalized result in immutable versioned fixtures. Do not request names, addresses, emails, card/account details, freeform order notes or payment receipts for this calculation. Retain only `_pagnetic_ref` from custom attributes in the financial projection; arbitrary shopper attributes are not needed.

## Calculation and reconciliation rules

The following are Pagnetic implementation rules derived from the PRD, not promises about all possible Shopify financial arrangements.

1. Parse supported currency decimals using integer/decimal arithmetic. Reject nonfinite, exponent-form, malformed and fractional-minor-unit input unless the adapter explicitly implements and fixtures a reviewed rounding rule. Enforce supported integer bounds before storage and analysis.
2. For a complete, unedited line snapshot, derive pre-refund merchandise from original line total minus its full discount allocations, removing included line tax exactly once when `taxesIncluded=true`. Cross-check against the explicit pre-tax remaining amount on an unrefunded/unremoved fixture. Freeze the source components, not just the resulting number.
3. Never multiply an approximate discounted unit price by quantity. Never subtract a global discount after line allocations. Do not subtract refunds again from a remaining-value field.
4. Preserve observed original line snapshots across later changes. If removed/added quantities or adjustments prevent reconstruction, classify `UNRESOLVED_FINANCIAL_ALLOCATION`; obtain historical financial evidence or hold the claim. Do not silently treat a partial edited snapshot as original history.
5. Gross captured payment is the sum of unique successful SALE/CAPTURE transaction amounts. AUTHORIZATION, VOID, pending, failed and test transactions are not sales. Match the original supported order obligation; partial payment or contradictory transactions stays unresolved. Refunds do not erase evidence that full payment previously occurred.
6. A successful merchandise refund is allocated through its refund line and original line ID, after confirming the associated successful REFUND transaction coverage. Several payment gateways for one refund must not multiply its line deductions. A repeated transaction under the order and refund resources is one financial operation.
7. Tax-exclusive refund fixtures use the line's merchandise subtotal and keep tax separate. For tax-inclusive refunds, prove the subtotal convention with a controlled Shopify fixture before choosing whether tax must be subtracted. Cross-check the before/after pre-tax merchandise values and transaction decomposition. Until demonstrated, use `TAX_BASIS_UNVERIFIED`; do not assume a field called subtotal is tax-exclusive in every context.
8. Apply only settled, unambiguous refund allocations through the report cutoff. Pending refund processing remains a reconciliation issue. Unknown manual adjustments, amount discrepancies and inconsistent currency block finalization; do not proportionally spread them over focal merchandise.
9. Net focal merchandise is original focal merchandise minus unique settled focal refunds. A negative result or refund larger than its supported original amount is an explicit contradiction, not a clamped zero. Exclude shipping, duty, tips, unrelated products and gift-card product sales. Ordinary merchandise paid with gift-card tender remains eligible.
10. Require canonical order creation inside `[assignment.assignedAt, assignment.expiresAt)`. Check signed tenant/product/assignment scope. Evaluate a late webhook against the purchase time; a refund follows its existing verified order linkage. Never manufacture a new assignment for either event.

These rules intentionally require tax-inclusive and recovered-after-refund fixtures before the corresponding live path is declared supported. The engineering task includes obtaining those controlled test-store observations; this document does not count them as completed.

## Inbox, ordering and complete reads

Persist authenticated webhook identity and necessary sanitized/encrypted input before acknowledging receipt. Order/refund fetches run from idempotent jobs. A failed fetch cannot set the inbox to successfully processed. Refund-before-order retains the pending refund and schedules parent recovery.

Use cursor pagination for every connection and keep durable cursors between bounded jobs. `transactions(first: …)` is a truncated array: compare fetched unique IDs with `transactionsCount`, checking exact count precision. Missing or nonexact count cannot prove completeness. Do not mark a truncated array complete because it lacks `pageInfo`. Retrieve the full supported list or classify the order pending additional evidence.

Fetch refund IDs and paginate each refund's children independently. A query returning both partial data and GraphQL errors is incomplete. If the order watermark changes during a multipage fetch, retry/reconcile that snapshot before marking its children complete.

Discover changed orders using updated timestamps with overlap, not only the legacy created-at lookback. Reconcile already-linked orders/refunds through each frozen report cutoff, even when their creation lies outside a routine recent-order scan. Keep source version, observed time and checksum distinct. Equal timestamps with different financial payloads require refetch/conflict handling; delivery arrival order is not precedence.

## Required fixture expectations

All amounts below are integer minor units and describe the normalized financial inputs; they are not fabricated Shopify-response captures.

| Fixture | Financial facts | Required result |
| --- | --- | --- |
| Basic paid | Focal 10000; unrelated 5000; captured obligation complete | Focal sales 10000 |
| Allocated discount | Focal original 10000; line/order allocations total 1500 | Focal sales 8500; discount deducted once |
| Authorization only | Authorized 10000; captured 0 | No recognized paid revenue |
| Partial capture | Obligation 10000; captured 4000 | Unresolved financial coverage |
| Refunded paid | Focal 10000; settled focal merchandise refund 2500 | Focal sales 7500 despite refunded payment label |
| Failed/pending refund | Focal 10000; refund object 2500; no successful repayment | Pending reconciliation, no final claim |
| Split refund gateways | One 2500 merchandise refund covered by two successful transactions | Deduct 2500 once |
| Refund before order | Same financial facts arrive in reverse order | Same final 7500 after parent recovery |
| Mixed cart / gift card | Focal 10000, other product 5000, gift-card product 2000 | Focal sales 10000 only |
| Gift-card tender | Focal 10000, recorded successful gift-card payment | Focal sales 10000 |
| Tax inclusive | Pre-tax focal 10000 plus included tax; later half refund | Net merchandise 5000 after verified source mapping |
| Duplicate sources | Order/refund webhook plus API replay of same transaction | No duplicated capture or deduction |
| Late receipt | Purchase before assignment expiry; webhook after expiry | Eligible exactly once |
| Expired purchase | Purchase at or after assignment expiry | Not attributed |
| Truncated children | Missing next line/refund page or transaction count mismatch | Not reconciled |
| QA order | `test=true` or test payment facts | Test evidence only, excluded from live outcomes |

S03 completion must add executable fixtures for these cases, a validated query/adapter reference, actual API validation outcome, and exact changed paths to this file and the implementation tracker. Documentation research alone does not satisfy R06.

## Replay and attribution corrections from independent implementation review

The source checksum excludes local observation time, completeness flags and the local tax-basis verification switch. Collection ordering is canonicalized. Fetching the same Shopify facts later is not a source revision. Conflicting duplicate transaction identities are rejected rather than choosing whichever amount appeared first; every money field must match the shop currency.

At a matching Shopify update time, a complete retry may repair an incomplete snapshot, and an incomplete retry cannot erase an already complete snapshot. A genuinely newer incomplete revision still places revenue into a pending state until repaired. Two contradictory complete snapshots remain quarantined until a newer authoritative revision; replaying the original snapshot alone cannot silently clear the conflict.

An existing attribution is superseded when its current reference authority is unavailable or its line is now ineligible. Missing previously verified references become explicit conflicts, not an invisible transfer of money to a changed product. Signed issuance must match the persisted decision time and must not be after purchase. Gift-card products and subscription lines cannot inherit an old active focal attribution.

Financial updates acquire a conditional row lock before applying source precedence. Concurrent first creation uses create-and-retry semantics rather than overwriting via upsert. Assignment-level projection refreshes also serialize before reading contributions. A controlled real PostgreSQL interleaving reproduced the older-worker overwrite defect before this correction and passes afterward; its evidence is in `docs/audit-2026-09-05/postgres-rehearsal.json`.

`tests/financial-adversarial.test.ts` adds ten regression scenarios for these cases; combined financial/adapter/adversarial checks pass 24/24 on the pinned runtime at this checkpoint. None substitutes for the still-pending intended-store GraphQL/checkout/refund rehearsal. Durable inbox crash recovery and repeated processing of nonterminal financial states remain S08 requirements: marking an incomplete source fetched/processed is not financial completion.

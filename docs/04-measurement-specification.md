# Adaptive Storefront Measurement Specification

Development update (2026-09-06): the owner authorized the adaptive scope in [doc60](./60-adaptive-storefront-prd.md), with Luna implementing under [doc63](./63-luna-development-brief.md) and milestones tracked in [doc64](./64-adaptive-development-status.md). Earlier contracts and verification below remain historical/implemented baselines, not evidence that the new scope is built. New protocol changes must be versioned and reviewed; no active registrations or production authority change through this notice.

Status: Proposed  
Version: 0.2  
Owner: Data/Product  
Applies to: Pilot experiments and MVP dashboard

## Purpose

Define how Adaptive Storefront measures causal economic impact. This specification prevents metric changes, selective stopping and attribution shortcuts from turning an experiment result into a marketing estimate.

## Estimand

The primary estimand is the intent-to-treat effect of assignment to one storefront decision policy rather than another for eligible traffic during the experiment window.

For Stage 2:

```text
ATE_RPS = mean(revenue per eligible session | assigned MATCHED)
        - mean(revenue per eligible session | assigned UNIVERSAL)
```

Estimated incremental revenue attributable to the matched policy is:

```text
ATE_RPS × eligible sessions assigned to MATCHED
```

This is an experimental estimate, not a general attribution model.

## Units

### Randomization unit

Anonymous visitor ID when persistence is permitted and technically available.

The same visitor remains in the same arm for the experiment attribution window. All eligible sessions and revenue within that window follow the first assignment.

If visitor-level persistence is unavailable, the experiment must explicitly use session-level randomization and cannot be pooled with visitor-randomized experiments without an approved hierarchical analysis.

### Observation unit

Eligible session for the primary RPS metric, clustered by randomized visitor in variance estimation.

### Assignment versus exposure

- **Assignment:** policy selected for the randomized unit.
- **Exposure:** panel successfully rendered.

Primary analysis is intent-to-treat by assignment. Exposure and render success are diagnostics. Excluding failed renders would bias the treatment estimate toward technically successful cases.

## Eligibility

A session is eligible when all of the following are true:

- it begins during the experiment's active analysis window;
- it lands on the configured product/template;
- it matches an included acquisition mapping;
- it is not known bot, preview, QA or merchant-admin traffic;
- the product is available under the experiment's inventory rule;
- required technical context for assignment is present;
- the session has not previously been assigned under an incompatible experiment version.

Eligibility is determined before treatment exposure wherever possible.

### Exclusions

Exclude only by predeclared rule:

- internal and QA traffic;
- detected bots and monitoring agents;
- duplicate event transmissions after idempotency processing;
- test, fraudulent or fully cancelled orders according to the revenue definition;
- sessions outside included markets/currencies;
- periods declared invalid because of severe instrumentation failure.

Do not exclude visitors because they did not see, click or engage with the panel after assignment.

## Primary metric

### Revenue per eligible session

```text
RPS = eligible attributed revenue / eligible sessions
```

Default revenue basis for the first decision is completed checkout total, normalized into the merchant reporting currency using the recorded transaction-time rate.

A secondary reconciled metric should use order data after refunds and cancellations when the evaluation delay permits:

```text
Net RPS = (gross sales - discounts - refunds - cancellations) / eligible sessions
```

Taxes, duties, tips, gift-card treatment and shipping revenue must be declared per experiment and displayed in the report. The definition cannot change after launch.

## Secondary metrics

- Purchase conversion rate.
- Average order value among purchasing sessions.
- Product add-to-cart rate.
- Checkout-start rate.
- Panel render success rate.
- Decision latency.
- Storefront error rate.
- Refund/cancellation rate when mature.

Secondary metrics explain the result; they do not replace the primary metric after outcomes are observed.

## Diagnostic segmentation

Predeclare important segments:

- acquisition angle;
- mobile versus desktop;
- campaign/source;
- new versus returning when legitimately measurable;
- market/locale;
- experiment week.

Segment results are exploratory unless the experiment was powered and registered for that comparison. Do not announce a segment winner based on uncorrected slicing.

## Attribution and conversion window

### Default

Attribute an order to the randomized visitor when the order occurs within seven days of the visitor's first eligible assignment and the visitor/session join is valid.

The final window is a founder decision before the first live pilot and should be informed by the merchant's historical click-to-purchase distribution.

### Multiple sessions

Revenue from all eligible sessions in the attribution window is associated with the original visitor assignment. The primary denominator remains eligible sessions; a visitor-level revenue metric is retained as a sensitivity analysis.

### Cross-device purchases

Do not claim cross-device attribution unless a consented and validated identity join exists. Report known unjoined purchase limitations.

### Order reconciliation

Client pixel events provide timely signals. Server-side order webhooks/Admin API data are the source for final order amounts, status, refunds and cancellations.

The reconciliation process must:

- deduplicate by merchant and order ID;
- preserve the first valid decision association;
- record join method and confidence;
- flag pixel-only and order-only cases;
- never overwrite raw event history;
- support delayed refunds.

## Randomization

### Allocation

Use equal allocation for two-arm validation experiments. This minimizes variance for a fixed sample under ordinary assumptions.

A 90/10 allocation has only 36% of the assignment information of a 50/50 allocation at the same sample size because allocation information is proportional to `p × (1-p)`. It therefore needs approximately 2.8 times as much total traffic for comparable precision.

Unequal persistent holdouts are allowed only after initial validation.

### Method

Compute assignment deterministically from:

```text
hash(merchant_id, experiment_id, randomization_unit_id, salt)
```

Map the hash uniformly into configured arms. Store the resulting assignment, policy version and salt version.

### Stratification

When feasible, randomize within predeclared high-value strata such as device class and acquisition angle. This protects balance and improves precision without changing the estimand.

### A/A validation

Before meaningful treatment:

- run identical policies through separate logical arms;
- verify allocation, event counts, revenue joins and covariate balance;
- inspect sample-ratio mismatch;
- confirm no arm-specific latency or rendering difference;
- establish expected pixel-to-order reconciliation rates.

Do not launch revenue claims until the A/A test passes.

## Sample size and duration

### Inputs

Estimate required sample using merchant-specific historical data:

- mean RPS;
- variance and upper-tail behavior;
- baseline conversion and AOV;
- randomization-unit clustering;
- expected eligible sessions;
- desired minimum detectable effect;
- alpha and power or Bayesian decision thresholds;
- expected missingness.

Default planning values:

- two-sided alpha: 0.05;
- power: 80%;
- minimum meaningful relative RPS lift: 5%;
- equal allocation.

Because revenue is zero-inflated and heavy-tailed, conversion-only calculators are not sufficient.

### Duration rules

- Run for at least two full weekly cycles.
- Continue until the fixed sample target or predeclared sequential boundary is reached.
- Set a maximum duration and inconclusive outcome rule before launch.
- Extend only for a reason unrelated to observed treatment effect.

## Statistical analysis

### Primary estimator

Report the difference in mean RPS between assigned policies with an uncertainty interval that accounts for visitor-level clustering.

Preferred implementation:

- regression adjustment using pre-treatment strata/covariates;
- cluster-robust standard errors by randomized visitor;
- a nonparametric bootstrap or randomization-inference sensitivity analysis;
- raw unadjusted arm means alongside the adjusted estimate.

Pre-treatment covariates may include device, acquisition angle, market and historical campaign baseline. Never adjust for post-treatment add-to-cart, review views or engagement in the primary estimate.

### Revenue-tail sensitivity

Report sensitivity to:

- one or more extreme orders;
- winsorization at a predeclared percentile;
- purchaser conversion and conditional AOV decomposition;
- net rather than gross revenue when available.

The unmodified mean remains the business estimand; robust analyses show whether the conclusion depends on a few orders.

### Result states

Every report must return one of:

- **Positive:** satisfies the predeclared evidence and economic threshold.
- **Negative:** satisfies the predeclared harm threshold.
- **Inconclusive:** does not satisfy either boundary.
- **Invalid:** protocol or data failure prevents a credible estimate.

Avoid standalone labels such as “94% confidence” without explaining whether the number is a confidence level, posterior probability or another quantity.

### Multiple comparisons

The experiment has one primary comparison. Apply an approved correction or label results exploratory when evaluating multiple bundles, angles, products or segments.

## Bandit-era requirements

Bandits are outside MVP. Before introduction, the system must:

- retain a randomized stable meta-holdout;
- log the probability of every action at decision time;
- version context features and policy models;
- support inverse-propensity or doubly robust policy evaluation;
- guard against delayed rewards and nonstationarity;
- distinguish system-policy lift from individual bundle performance.

Adaptive allocation must never be analyzed as if traffic were allocated uniformly at random.

## Data-quality monitors

Monitor by arm and overall:

- assignment counts and sample-ratio mismatch;
- missing decision IDs;
- render success;
- duplicate events;
- event ordering anomalies;
- checkout-completed capture;
- order reconciliation and unmatched-order rate;
- revenue currency validity;
- bot rate;
- product availability;
- consent state distribution;
- latency and error rate.

Any material arm imbalance triggers investigation before outcome interpretation.

## Dashboard calculations

Display:

```text
Universal RPS
Matched RPS
Absolute RPS difference
Relative RPS lift
Uncertainty interval
Estimated incremental revenue
Eligible sessions by arm
Result state
Revenue definition
Data maturity date
```

Estimated incremental revenue must never be shown without its interval and comparison policy.

## Portfolio analysis

Merchant effects should not be pooled by simply combining every session, which lets the largest merchant dominate.

Report:

- each merchant's estimate and interval;
- fixed-effect and random-effects pooled estimates when appropriate;
- heterogeneity statistics and qualitative confounders;
- session-weighted business impact separately;
- leave-one-merchant-out sensitivity.

The claim “most merchants benefit” requires merchant-level evidence, not only a positive pooled session total.

## Experiment registry

Freeze the following before launch:

```text
experiment_id
protocol_version
merchant_id
product/template scope
start time and maximum duration
randomization unit
arm definitions and allocation
eligibility and exclusions
attribution window
primary and secondary metrics
revenue definition
minimum detectable effect
sample or sequential stopping rule
strata and planned covariates
content and mapping versions
guardrails
analysis code/version
```

Any deviation is appended with actor, time and rationale. Historical registry entries are immutable.

## Reporting template

Every final report contains:

1. Decision summary.
2. Registered hypothesis and estimand.
3. Traffic and arm counts.
4. Primary effect and uncertainty.
5. Secondary and diagnostic results.
6. Data-quality assessment.
7. Sensitivity analyses.
8. Confounders and protocol deviations.
9. Economic interpretation.
10. Continue, revise or stop recommendation.

## Current technical reference

Shopify notes that `checkout_completed` is generally emitted once but is not emitted if the page that should trigger it fails to load. This is why final revenue requires server-side reconciliation: [Shopify checkout_completed reference](https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_completed).

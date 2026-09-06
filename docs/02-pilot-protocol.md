# Adaptive Storefront Pilot Protocol

Status: Proposed  
Version: 0.2  
Owner: Product and Data  
Companion specification: [Measurement specification](./04-measurement-specification.md)

## Objective

Determine whether continuing a paid-acquisition message through an approved adaptive PDP panel causes an economically meaningful increase in revenue per eligible session.

The protocol separates two questions:

1. Can an improved persuasion panel outperform the merchant's original PDP?
2. Does matching the panel to the acquisition angle outperform showing the same improved panel to everyone?

Question two is the company-defining hypothesis.

## Hypotheses

### Stage 1 — Treatment-surface validation

- **Null:** Adding a universal approved persuasion panel does not improve RPS relative to the original PDP.
- **Alternative:** The universal panel improves RPS relative to the original PDP.

### Stage 2 — Matching validation

- **Null:** A message-matched panel does not improve RPS relative to a universal improved panel.
- **Alternative:** A message-matched panel improves RPS by at least the predeclared minimum meaningful effect.

The default minimum meaningful effect is 5% relative RPS lift. Each merchant's detectable effect must be calculated from baseline data before enrollment.

## Pilot cohort

### Target size

Recruit five to ten design partners from one vertical. Enroll only merchants whose eligible traffic and data quality allow a credible result within the planned window.

### Merchant intake data

Collect at least eight weeks of historical data:

- PDP sessions by product, source, campaign, device and market;
- orders and gross sales attributable to those sessions;
- conversion rate and AOV;
- returns and cancellations, if available;
- campaign and creative change frequency;
- stockout history;
- mobile/desktop mix;
- consent and event-capture coverage;
- theme and relevant storefront apps.

### Eligibility assessment

For each candidate, estimate:

- eligible sessions per week;
- baseline RPS distribution;
- minimum detectable relative lift at 80% power;
- expected time to result under equal allocation;
- expected loss from tracking gaps;
- operational risks that could invalidate the test.

Reject or postpone candidates that cannot reach a useful result. Do not relax the analysis after seeing outcomes.

## Product and campaign selection

Choose one hero product initially. A second or third product may be added only as a separately versioned experiment.

The selected product must have:

- at least three legitimate and distinct acquisition angles;
- stable price and inventory;
- sufficient evidence for every proposed statement;
- no planned product-page redesign during the experiment;
- no sensitive medical or disease-related positioning.

Example angles:

```text
comfort
performance
value
```

Every included campaign must be mapped to exactly one approved acquisition angle. Unknown or ambiguous traffic is excluded from the matching experiment or assigned to the universal policy by predeclared rule.

## Experience preparation

For the selected product, create:

1. one universal improved bundle;
2. one matched bundle per acquisition angle;
3. the original experience, represented by absence of the adaptive panel.

Every bundle must:

- comply with the [claims and safety policy](./06-claims-safety-policy.md);
- be approved by the merchant before launch;
- have a permanent version identifier;
- be visually tested on supported breakpoints;
- contain no price, inventory, shipping or medical changes;
- remain unchanged during its experiment version.

## Experimental design

### Stage 1: original versus universal

Randomize eligible visitors 50/50:

| Arm | Policy                                                                   |
| --- | ------------------------------------------------------------------------ |
| O   | Original PDP; adaptive panel is not shown.                               |
| U   | Universal approved panel; acquisition angle does not change its content. |

Primary comparison: U − O in RPS.

Proceed to Stage 2 if the panel is technically safe and either:

- Stage 1 shows positive evidence; or
- founders explicitly decide that Stage 2 remains worthwhile despite an inconclusive Stage 1.

### Stage 2: universal versus matched

Randomize eligible visitors 50/50:

| Arm | Policy                                            |
| --- | ------------------------------------------------- |
| U   | Universal approved panel.                         |
| M   | Bundle mapped to the visitor's acquisition angle. |

Primary comparison: M − U in RPS.

This comparison isolates the economic contribution of matching more cleanly than comparing matched content only with the original PDP.

### Optional interaction test

For high-traffic merchants, randomly rotate approved angle bundles across acquisition angles. Estimate the interaction between acquisition angle and experience angle. This directly tests whether alignment matters, but it is not required when traffic cannot support the larger design.

### Randomization unit

Randomize at the anonymous visitor level and keep assignment sticky across eligible sessions for the experiment's attribution window. Do not re-randomize every page view.

If visitor persistence is not permitted or unavailable, record the limitation and analyze the session-level experiment separately. Do not combine incompatible randomization units.

## Prelaunch checklist

### Merchant and content

- [ ] Product, campaigns and acquisition angles are approved.
- [ ] Every claim has valid evidence and scope.
- [ ] Every bundle has merchant approval.
- [ ] The merchant names an incident contact.
- [ ] No overlapping PDP experiment targets the same traffic.

### Technical

- [ ] Published theme and relevant templates are recorded.
- [ ] Adaptive panel placement is approved on mobile and desktop.
- [ ] Original fallback works when scripts, API or network fail.
- [ ] Decision assignment is sticky.
- [ ] Decision IDs are observable in diagnostic tooling.
- [ ] Add-to-cart, checkout and order joins pass end-to-end tests.
- [ ] Accelerated checkout paths are tested.
- [ ] Consent-denied and consent-late flows are tested.
- [ ] LCP, CLS and INP meet the performance guardrails.
- [ ] Merchant pause takes effect within five minutes.

### Measurement

- [ ] Inclusion and exclusion rules are frozen.
- [ ] Primary and secondary metrics are frozen.
- [ ] Sample-size target or sequential boundary is approved.
- [ ] Experiment start and maximum duration are set.
- [ ] Baseline covariates and strata are recorded.
- [ ] Refund and cancellation treatment is set.
- [ ] Automated A/A validation shows no material imbalance.

## Runtime rules

- Assignment occurs before the adaptive panel is displayed.
- An assignment is recorded even if rendering later fails.
- Analysis follows intent-to-treat based on assignment.
- Rendering success is a diagnostic metric, not a condition for excluding assigned visitors.
- A visitor's post-exposure behavior must not retroactively change their initial arm.
- Experience content must not change within an experiment version.
- Campaign remapping creates a new mapping version and is recorded prospectively.

## Guardrails and pausing

Automatically pause the treatment and serve original when any of the following occurs:

- storefront JavaScript error rate attributable to the app exceeds 0.1% over the agreed rolling window;
- p95 application processing exceeds 150 ms for 15 minutes;
- p95 Shopify app-proxy round trip exceeds 1,000 ms for 15 minutes;
- panel render success drops below 99.5%;
- a severe claim, content or data-isolation incident is detected;
- checkout or add-to-cart functionality is plausibly impaired;
- the merchant activates the kill switch.

A statistically negative revenue result should trigger a documented review under the measurement plan. Do not repeatedly inspect and stop on ordinary random fluctuations.

These split latency guardrails apply prospectively to `pilot-v0.3` registrations. Never rewrite the guardrails of an already registered experiment.

## Confounder log

Record changes that could affect RPS:

- product price or discount;
- inventory or variant availability;
- shipping terms;
- site redesign or theme publication;
- checkout changes;
- campaign targeting, budget or creative changes;
- major promotion or holiday;
- email/SMS launches;
- outages, bot traffic or payment incidents.

Classify each event as immaterial, model-adjustable or experiment-invalidating before looking at arm outcomes where possible.

## Duration

- Run through at least two full weekly business cycles.
- Prefer a fixed sample target or a predeclared sequential design.
- Set a maximum duration before launch.
- Do not stop merely because the dashboard temporarily crosses a confidence threshold.

## Pilot outcome classification

### Merchant-level

- **Positive:** interval and point estimate satisfy the predeclared decision rule.
- **Negative:** credible evidence of harm or point estimate below the negative boundary.
- **Inconclusive:** neither positive nor negative with adequate data quality.
- **Invalid:** instrumentation, operational or protocol failure prevents interpretation.

### Portfolio-level

Report:

- pooled effect with merchant-level weighting specified in advance;
- distribution of merchant effects;
- count of positive, negative, inconclusive and invalid pilots;
- heterogeneity by campaign angle and device;
- all exclusions and protocol deviations.

Do not describe an inconclusive experiment as zero effect.

## Go/no-go decision

### Go

Proceed to productization when:

- Stage 2 produces at least 5% aggregate matched-versus-universal RPS lift;
- a majority of sufficiently measured merchants have a positive direction;
- no single result dominates the pooled conclusion;
- implementation and content operations can be standardized;
- performance and safety guardrails are met.

### Revise

If Stage 1 is positive but Stage 2 is not, reposition around automated evidence-backed PDP improvement rather than personalization and reassess market differentiation.

### Stop

Stop the current product thesis if both stages show no repeatable economic benefit across qualified, valid pilots.

## Pilot deliverables

For every merchant, produce:

- signed experiment configuration;
- campaign-angle map;
- approved experience library;
- QA record;
- live diagnostic dashboard;
- final analysis report;
- incident and confounder log;
- continuation recommendation.

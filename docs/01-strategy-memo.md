# Adaptive Storefront Strategy Memo

Status: Proposed  
Version: 0.2  
Date: 2026-09-02

## Executive decision

Build a constrained Shopify pilot that tests whether paid-ad message continuity on a product detail page creates measurable incremental revenue.

Do not initially build a general AI personalization platform. The first sellable capability is:

> Shopify-native, claim-safe post-click message matching with causal revenue measurement and minimal merchant operation.

The company proceeds beyond the pilot only if the matching effect—not merely generic page improvement—is economically meaningful.

## Problem

Paid-ad systems select creatives and messages for different shoppers, but most clicks terminate on a static product page. A visitor persuaded by a particular promise can land on a page where that promise is missing, buried or surrounded by unrelated information.

Merchants can create separate landing pages or run personalization tools, but doing so commonly requires campaign planning, content production, page construction, targeting rules, QA and experiment analysis. The operational burden limits coverage and makes continuous optimization difficult.

## Product thesis

For products with multiple legitimate selling angles, maintaining message continuity from acquisition creative to product-page persuasion should improve commercial outcomes.

The system will:

1. map incoming paid traffic to a merchant-approved acquisition angle;
2. choose a coordinated, approved experience bundle;
3. render it in one owned adaptive panel;
4. preserve a randomized comparison group;
5. join the decision to downstream orders;
6. report incremental revenue per eligible session.

The long-term thesis is broader: a merchant should define products, evidence, brand rules and commercial constraints while software determines how to present them. That vision is a roadmap, not an MVP requirement.

## Initial customer profile

Target merchants based on experimentability rather than annual GMV alone.

### Required

- Shopify online store with a compatible published theme.
- One to three hero products receiving meaningful paid traffic.
- At least three stable, distinguishable acquisition messages for a hero product.
- Sufficient eligible PDP sessions to reach a useful minimum detectable effect within the agreed evaluation window.
- Stable inventory, pricing, checkout and campaign strategy during the experiment.
- Baseline order and revenue data of sufficient quality.
- A named ecommerce or growth owner able to approve content and operational changes.

### Preferred

- Established product-market fit.
- Mobile-heavy Meta or Google traffic.
- Products for which copy, proof and reassurance materially affect purchase confidence.
- Existing reviews and structured product evidence.

### Excluded from the first pilot

- Dietary supplements.
- Products promoted through disease, treatment or medical-condition claims.
- Stores undergoing redesign, replatforming or major pricing changes.
- Stores that cannot maintain product availability through the test.
- Merchants whose eligible traffic cannot support the agreed measurement plan.

The first cohort should come from one narrow vertical. Non-medical skincare/cosmetics may offer strong message diversity, but only merchants with conservative claim policies should qualify. Footwear or apparel are lower-claim alternatives.

## Primary users

### Economic buyer

Founder, VP Growth, Head of Ecommerce, Ecommerce Director or CMO.

### Operational user

Growth marketer or ecommerce manager.

### Core job

> Increase revenue from paid traffic without continuously building pages, defining audiences and operating experiments.

## Positioning

### Recommended product statement

> Match every paid click to the product story that continues the conversation—and prove the incremental revenue.

### Category language

Use **adaptive storefront decisioning** as an explanatory phrase, not as the sole differentiation claim. Buyers will compare the product with personalization, CRO, experimentation and post-click landing-page platforms regardless of the category name.

### Competitive frame

The market already contains adjacent and overlapping products:

- FERMAT creates campaign-linked landing pages and PDPs.
- Nosto provides onsite content personalization and recommendations.
- Intelligems and other experimentation products test and target onsite experiences.
- Shopify provides native theme-level experiments through Rollouts.

The initial differentiation must therefore be observable in the product:

1. native execution on the merchant's PDP rather than a separate microsite;
2. explicit acquisition-message continuity;
3. evidence-backed and approval-controlled content;
4. very low ongoing operation;
5. causal reporting centered on incremental RPS.

## Wedge and product boundary

### V0 wedge

Paid traffic → one hero-product PDP → one adaptive persuasion panel.

The panel may contain:

- a short value proposition;
- three or four ordered benefits;
- one or two approved reviews or proof points;
- one reassurance message.

The entire panel is versioned and selected as one experience bundle.

### Why one panel

Shopify app blocks require compatible placement in the published theme. Multiple independently located components create setup, theme-compatibility and layout-stability risks before the economic thesis is proven. One panel gives the experiment a stable treatment surface and a clear failure mode.

### Expansion path

1. Single-panel deterministic matching.
2. Multiple approved bundles with fixed randomized experiments.
3. Supported-theme adapters and additional placements.
4. Experience-level contextual decisioning.
5. Additional PDP modules and component-level learning.
6. Collection, homepage, cart and lifecycle surfaces.

Each stage requires evidence that the previous stage creates economic value without unacceptable operational or performance cost.

## Strategic principles

1. **Prove matching, not AI.** AI generation is replaceable; the causal outcome is the product proof.
2. **Use observable context.** Begin with explicit acquisition angles rather than speculative high-dimensional intent scores.
3. **Treat experiences as governed releases.** Content is approved, versioned and auditable.
4. **Keep language models asynchronous.** Runtime selection must remain deterministic, fast and failure-safe.
5. **Optimize a policy, not isolated clicks.** Revenue is primary; conversion, AOV and engagement are diagnostics.
6. **Preserve merchant control.** Original content remains available, sensitive fields are immutable and pausing is immediate.
7. **Earn autonomy.** Manual pilot operations are acceptable; repeated work is automated only after it is understood.

## Business model hypothesis

Do not launch a low-priced self-serve tier during the pilot. It conflicts with the traffic qualification requirement and attracts merchants for whom incrementality cannot be demonstrated.

Pilot pricing should optimize for learning and commitment rather than short-term revenue. After validation, test a platform fee based on eligible traffic and product coverage. Avoid percentage-of-incremental-revenue pricing until the methodology is trusted and refund, margin and attribution policies are mature.

## Moat hypothesis

The defensible system is not a library of generated headlines. It is the combination of:

- reliable storefront execution;
- merchant-specific claim and brand governance;
- normalized acquisition-message context;
- decision and outcome history;
- incrementality infrastructure;
- an operational loop that safely proposes, validates, deploys and retires experiences.

Cross-merchant priors may become valuable later, but they are not assumed to be available. Their use depends on contractual rights, privacy review, sufficient scale and evidence that effects transfer across merchants.

## Decision gates

### Gate 1 — Technical proof

One development store reliably shows different approved bundles for different explicit acquisition angles, preserves sticky assignment and records a complete decision-to-order path.

### Gate 2 — Operational pilot readiness

For a qualified merchant, the team can install, approve and launch one product experiment within one business day without editing theme source code.

### Gate 3 — Economic validation

Across qualified pilots:

- matched experiences show at least 5% aggregate incremental RPS versus a universal improved experience;
- the direction of effect is positive for a majority of sufficiently measured merchants;
- no material performance, brand-safety or checkout incident occurs;
- results remain credible under the predeclared sensitivity analyses.

### Gate 4 — Productization

At least 70% of qualified pilot merchants want to continue after seeing the result, and the repeated onboarding and operations work can reasonably be automated.

### Stop or revise

Revise the thesis if improved content lifts revenue but matching adds no meaningful effect. Stop the proposed decisioning roadmap if neither improved nor matched content creates repeatable economic value.

## Immediate decisions

Before implementation, founders must approve:

1. the first vertical and explicit exclusions;
2. the one-panel V0 treatment surface;
3. the pilot's minimum detectable effect and evaluation window;
4. the distinction between universal improvement and message matching;
5. the content approval and merchant-liability model;
6. the economic validation gate above.

## Current source references

- [Shopify theme app extension configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)
- [Shopify Rollouts announcement](https://changelog.shopify.com/posts/schedule-publish-and-a-b-test-new-themes-and-checkout-and-customer-account-configurations)
- [FERMAT Funnel Builder](https://www.fermatcommerce.com/product/funnel-builder)
- [Nosto personalization platform](https://www.nosto.com/)
- [Intelligems](https://www.intelligems.io/)

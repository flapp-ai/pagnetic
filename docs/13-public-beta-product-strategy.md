# Public-Beta Product Strategy

Status: implementation baseline  
Offer: founding beta, free until the first valid real experiment result

## Cold-start problem

A merchant cannot be expected to install an unfamiliar optimization app only to see an empty analytics screen. Adaptive Storefront therefore provides value before data collection and separates three product questions:

1. **Preview demand:** does the merchant find source-grounded message angles useful?
2. **Activation demand:** will the merchant approve content and activate a controlled test?
3. **Measured value:** does the product produce a credible outcome, and will the merchant continue afterward?

## Product-led funnel

1. A visitor pastes a public Shopify product URL into the landing page.
2. The scanner retrieves only the public product page, blocks private-network targets, limits redirects, response size, time, and request rate, and retains no submitted URL or product copy.
3. The page displays a source-readiness score and five source-bound arrangements: Original, Universal, Comfort, Performance, and Value.
4. The visitor installs the app and syncs the Shopify catalog.
5. The guided activation workspace selects one hero product, approves the source-derived brand profile, and generates the governed draft library.
6. The merchant reviews and approves exact evidence, qualifies traffic, activates the theme block and pixel, and records QA evidence.
7. A/A validates instrumentation. It does not end free access.
8. A mature Original-versus-Universal result transitions the entitlement to `RESULT_READY`, whether the result is positive, negative, or inconclusive.

## Honest value proposition

> See how one product can speak to different campaign intents, then measure whether the change increases revenue per session.

The product never promises lift, invents product claims, changes Shopify prices or checkout, or treats an installation as evidence of product efficacy.

## Founding-beta offer

- No payment request before the first mature real experiment result.
- A/A validation does not count as the first result.
- The result can be positive, negative, or inconclusive; honesty is part of the product value.
- Paid continuation is introduced only after the owner supplies pricing and Shopify billing is implemented and enabled.

## MVP funnel metrics

Track these as distinct denominators:

| Metric                     | Definition                                                        |
| -------------------------- | ----------------------------------------------------------------- |
| Preview success            | Successful scans / all accepted scan attempts                     |
| Preview visitor conversion | Install starts / unique successful-preview visitors               |
| Activation                 | Stores selecting a hero product / new installations               |
| Content activation         | Stores with approved Universal content / hero-product activations |
| Measurement activation     | Stores with registered A/A / content activations                  |
| Valid measurement          | Stores with mature passing A/A / registered A/A stores            |
| Result completion          | Stores with a mature real result / valid-measurement stores       |
| Commercial conversion      | Stores accepting a paid plan / result-ready stores                |

Do not interpret a low listing-to-install rate as a failed personalization product. It is acquisition or positioning evidence. Do not interpret an incomplete experiment as a negative product result.

## Capacity boundary

The first public beta is deliberately single-writer and capped by `PUBLIC_BETA_MAX_STORES` (25 by default). SQLite runs in WAL mode on a durable encrypted volume with a five-second busy timeout, nightly online backups, off-volume copies, restore drills, and one application instance. Move to managed PostgreSQL before removing the cap, adding another writer, or exceeding the observed capacity envelope.

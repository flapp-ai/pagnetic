# Pagnetic MVP v2 — local UI and accessibility QA

Date: 2026-09-05  
Scope: local, isolated fixture rendering of the actual Overview, Messages, Results and Settings view components  
Browser: Google Chrome 152.0.7977.76 on macOS  
Result: partial local pass, including the exact CSS-width matrix; not Shopify integration evidence and not a complete AT28 certification

## Test boundary

The ordinary route components export their presentational views while keeping their authenticated loaders, actions and default route wrappers unchanged. `qa.v2-ui.tsx` renders those same views with synthetic, PII-free fixtures. The fixture route is fail-closed unless all of these are true:

- `NODE_ENV` is not `production`;
- `PAGNETIC_UI_QA=true`; and
- the request hostname is `127.0.0.1`, `localhost` or loopback IPv6.

Its action always returns HTTP 405. The fixture is marked `noindex,nofollow`. Unit tests prove production, disabled-flag and external-host requests are denied. This is a local review harness, not a production authentication bypass.

## Observed states

| View | State exercised | Browser and accessibility observations |
| --- | --- | --- |
| Overview | `NEEDS_ATTENTION`, Original serving, published-theme verification required | One h1 and nested h2 structure were exposed. The merchant-owned next action and both enablement CTAs were keyboard reachable. At 200% zoom, headline, attention notice and CTA reflowed without visible horizontal clipping or overlap; deeper content used ordinary vertical scrolling. |
| Messages | One source-backed diagnosis, one Universal draft, exact sources, editable fields | Product selector, preview link, source disclosure, Headline, Supporting line, Benefits and Reassurance were exposed with accessible names. Keyboard order followed navigation → product → preview/evidence → edit fields → actions. At 200% zoom, the two-column selector/action area and long h1 reflowed cleanly. |
| Results | Positive frozen report, subscription absent | AX exposed the exact result title, `1842.00 USD`, interval, arm counts, reconciliation counts, snapshot/data identifiers and finality language. “Keep” was absent because entitlement was false; revise and stop remained available in logical keyboard order. The immutable-report disclosure exposed its complete long text and the 200% top-level layout did not visibly clip. |
| Settings | Active authority, free evaluation, unpublished offer, mixed surface evidence, open financial incident | AX exposed pause, subscription limitations, PASS/PENDING/NOT_APPLICABLE surface states, export/privacy/support links and the SEV2 financial-review incident. Keyboard order followed navigation → pause → verification → export/privacy/support → operator disclosure. At 200% zoom, the serving card reflowed without visible collision. |

The Chrome accessibility tree exposed native links, buttons, pop-up buttons, text fields, text areas and disclosure triangles rather than generic clickable containers. The tested keyboard sequence never trapped focus. No form submit or external link was activated.

## Exact CSS viewport matrix

Chrome DevTools responsive mode exercised the actual four view components at each required CSS width. For every cell, an in-page measurement confirmed `innerWidth`, `document.documentElement.scrollWidth` and `document.body.scrollWidth` were identical; `overflow` was false. Visual inspection at the 320 px and 1,440 px extremes confirmed expected text wrapping, stacked mobile cards and the wider responsive card/grid layout without overlap or clipped actions.

| CSS width | Overview | Messages | Results | Settings |
| ---: | --- | --- | --- | --- |
| 320 px | 320/320, pass | 320/320, pass | 320/320, pass | 320/320, pass |
| 375 px | 375/375, pass | 375/375, pass | 375/375, pass | 375/375, pass |
| 768 px | 768/768, pass | 768/768, pass | 768/768, pass | 768/768, pass |
| 1,024 px | 1,024/1,024, pass | 1,024/1,024, pass | 1,024/1,024, pass | 1,024/1,024, pass |
| 1,440 px | 1,440/1,440, pass | 1,440/1,440, pass | 1,440/1,440, pass | 1,440/1,440, pass |

Each value is `innerWidth/maximum scrollWidth`. DevTools auto-scaled the 1,440 px viewport to 75% for display; the page still reported the exact 1,440 CSS-pixel viewport. Extension-origin console warnings were present and separately identifiable as Chrome-extension content-script warnings, not application exceptions.

## Local checks

- `GET /qa/v2-ui?view=overview`: HTTP 200 with the explicit local flag.
- `POST /qa/v2-ui`: HTTP 405; fixture actions are read-only.
- `tests/ui-qa-fixture.test.ts`: production/flag/host boundary and read-only response checks pass.
- Route type generation, TypeScript and focused uncached ESLint pass.
- React Router production build includes the route but its runtime guard makes production requests return 404.

## What this does not prove

- No Shopify embedded-admin authentication, App Bridge navigation, published product/theme, app proxy, Web Pixel, checkout or subscription callback was exercised.
- Fixture rendering does not prove that a background loader refresh preserves an in-progress edit. That needs an authenticated route with a deliberately delayed revalidation.
- The exact responsive-width matrix and 200% zoom are local Chrome evidence, not supported mobile-browser or embedded Shopify coverage.
- AX inspection is not a full VoiceOver/NVDA scripted pass. Visible focus was exercised by keyboard, but automated contrast, reduced-motion and high-contrast modes were not measured.
- No live customer data, merchant action, payment, subscription, production secret or deployment changed.

## Remaining AT28/S10 browser gates

1. Run the authenticated embedded app in the intended Shopify development store and verify App Bridge navigation and owner/operator action feedback.
2. Exercise long localized copy and a background-revalidation edit-retention scenario on the authenticated route; the exact 320/375/768/1024/1440 matrix and 200% zoom are now locally recorded.
3. Run VoiceOver on macOS/Safari and the supported mobile-browser matrix.
4. Pair the UI pass with actual published-product runtime acknowledgment, pause-to-Original observation and checkout/reference retention. Only then can S10 or AT28 be marked verified.

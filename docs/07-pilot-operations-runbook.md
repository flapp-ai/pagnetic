# Adaptive Storefront Pilot Operations Runbook

Status: Implemented baseline  
Version: 0.1  
Owner: Product, Data and Merchant Operations  
Companion protocol: [Pilot protocol](./02-pilot-protocol.md)

## Purpose

Operate the design-partner pilot in the registered order without weakening its
measurement, content or safety boundaries. All actions in this runbook are
available from the embedded Shopify application.

## Roles

- The merchant approves source evidence, experience copy and launch timing.
- Product/Data freezes the hypothesis, sample target, duration and revenue rule.
- The on-call operator monitors instrumentation and runtime guardrails.
- Only an explicit merchant action or a passing launch gate may activate a stage.

## 1. Validate instrumentation with A/A

1. Add the Adaptive Panel block to the selected product template.
2. Open **Causal measurement**.
3. Register an **A/A instrumentation** experiment. Both logical arms execute the
   original experience; no adaptive copy is shown.
4. Keep the registered allocation, target sample, duration and revenue definition
   unchanged.
5. Confirm the Web Pixel is active and order recovery reports `CURRENT`.
6. Exercise product view, add-to-cart, checkout and paid-order paths.
7. Monitor allocation balance, decision-event coverage and order attribution.
8. After the registered sample, duration and maturity lag pass, save an immutable
   report snapshot. Continue only when its result is `VALIDATED`.

An early `COLLECTING` or `INVALID` result is not evidence of treatment harm. It
means the registration is immature or a data-quality check currently fails.

## 2. Prepare Stage 1 content

1. Open **Governed content** and sync the selected Shopify product.
2. Approve exact, current source evidence.
3. Create the `universal` acquisition angle.
4. Propose a complete universal bundle containing value proposition, benefits,
   proof and reassurance.
5. Resolve every validation finding and record merchant approval.
6. Confirm the approved version is immutable and active.

## 3. Register and launch Stage 1

1. Open **Causal measurement**.
2. Choose **Stage 1: original vs universal**.
3. Freeze the experiment registration. Stage 1 is created as `DRAFT`.
4. Open **Pilot operations** and review every launch check.
5. Launch only when registration, pixel, runtime, A/A and universal-bundle checks
   all pass. Launch automatically pauses any competing active experiment on the
   same product.
6. Record price, inventory, theme, checkout, campaign and promotion changes in
   the confounder log as they occur.
7. Evaluate guardrails on the agreed operational cadence.
8. After maturity, save the report snapshot and classify it using the registered
   decision rule.

## 4. Prepare and launch Stage 2

1. Approve at least three distinct matched angle bundles for the product.
2. Publish unambiguous active campaign mappings.
3. Register **Stage 2: universal vs matched** as a new `DRAFT` experiment.
4. Confirm a mature `POSITIVE` Stage 1 snapshot exists.
5. Launch from **Pilot operations** only when every dependency passes.
6. Monitor, document and close the experiment exactly as in Stage 1.

The implemented baseline requires positive Stage 1 evidence. If founders choose
to proceed after an inconclusive Stage 1, record and review that protocol change
before adding an override mechanism; do not bypass the database gate manually.

## Runtime guardrails

The evaluator serves the original storefront by pausing an active experiment
when any mature threshold fails:

- panel render success below 99.5% after at least 20 attempts;
- runtime failure rate above 0.1% after at least 100 attempts;
- application-processing p95 above 150 ms after at least 20 measured decisions;
- Shopify app-proxy round-trip p95 above 1,000 ms after at least 20 measured decisions;
- an open Severity 1 incident;
- an active merchant kill switch.

Every evaluation stores the exact metrics, reasons and rollback outcome.

## Incident and rollback procedure

1. Record the incident with experiment, severity, category and concise summary.
2. For suspected shopper harm, checkout impairment, unsafe claims or data
   isolation failure, classify it as Severity 1.
3. Severity 1 automatically activates the kill switch and pauses active
   experiments. The native product page remains available.
4. Diagnose and correct the cause without changing historical records.
5. Resolve the incident.
6. Clear the kill switch only after recovery is verified. Clearing never restarts
   an experiment.
7. Re-register a new experiment version when a material protocol or content
   change is required.

## Measurement recovery

- Order webhooks are the primary feed; Admin API recovery overlaps the previous
  successful checkpoint by one day and remains idempotent.
- The embedded measurement page automatically runs recovery when the last
  successful sync is more than 15 minutes old.
- Use **Recover orders** for an immediate check after an outage.
- The page also rotates the Web Pixel credential when the public app URL changes,
  which is common with temporary development tunnels.
- Never delete raw decision, event, order, refund or result-snapshot history to
  make a quality check pass.

## Privacy requests

- Customer data requests and redactions record only one-way identifiers because
  the pilot stores opaque visitor telemetry, not customer profiles.
- Shop redaction deletes the merchant tenant and its dependent operational data,
  then records completion outside that tenant.
- Verify the compliance webhook status in **Pilot operations** after deployment.

## Closeout

1. Stop at the registered sample, maximum duration or approved safety boundary.
2. Allow the registered refund/data maturity lag to complete.
3. Run order recovery and inspect data-quality checks.
4. Record final confounders and resolve or annotate all incidents.
5. Save the immutable result snapshot and download the report.
6. Classify the result as positive, negative, inconclusive or invalid.
7. Do not describe a preliminary or invalid result as causal lift.

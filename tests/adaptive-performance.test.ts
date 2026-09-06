import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  ADAPTIVE_PERFORMANCE_BUDGETS,
  assessAdaptivePerformanceEvidence,
} from "../app/services/adaptive-performance";
import {
  campaignSignature,
  createMappingSnapshot,
  resolveAdaptiveMapping,
} from "../app/services/adaptive-contracts";

const runtimePaths = [
  "extensions/adaptive-panel/assets/adaptive-panel.js",
  "extensions/adaptive-panel/assets/adaptive-panel-v2.js",
  "extensions/adaptive-panel/assets/adaptive-vitals.js",
];

test("adaptive budgets use explicit percentiles, windows, layout and asset limits", () => {
  const budget = ADAPTIVE_PERFORMANCE_BUDGETS;
  assert.equal(budget.contractVersion, "adaptive-performance-a1");
  assert.equal(budget.measurementWindow.minimumEligibleDecisions, 1_000);
  assert.equal(budget.measurementWindow.maximumWindowMinutes, 5);
  assert.equal(budget.latencyMs.serverDecisionP95, 100);
  assert.equal(budget.latencyMs.browserRequestToDecisionP95, 500);
  assert.equal(budget.layout.cumulativeLayoutShiftP75, 0.05);
  assert.deepEqual(budget.layout.overflowViewportWidthsPx, [320, 375, 768, 1024, 1440]);
  const failed = assessAdaptivePerformanceEvidence({
    eligibleDecisions: 999,
    windowMinutes: 5,
    serverDecisionP95Ms: 101,
    browserRequestToDecisionP95Ms: 501,
    panelRenderP95Ms: 17,
    cumulativeLayoutShiftP75: 0.051,
    combinedRuntimeGzipBytes: 0,
    adaptiveV2GzipBytes: 0,
    cssGzipBytes: 0,
    externalAdaptiveAssetReferences: 1,
  });
  assert.equal(failed.pass, false);
  assert.deepEqual(failed.reasons, [
    "DECISION_SAMPLE_TOO_SMALL",
    "SERVER_DECISION_P95_EXCEEDED",
    "BROWSER_DECISION_P95_EXCEEDED",
    "PANEL_RENDER_P95_EXCEEDED",
    "LAYOUT_SHIFT_P75_EXCEEDED",
    "UNAPPROVED_ADAPTIVE_ASSET_REFERENCE",
  ]);
});

test("built adaptive storefront assets stay within frozen gzip budgets", () => {
  const runtimeGzipBytes = runtimePaths.reduce(
    (total, path) => total + gzipSync(readFileSync(path)).byteLength,
    0,
  );
  const adaptiveV2GzipBytes = gzipSync(
    readFileSync("extensions/adaptive-panel/assets/adaptive-panel-v2.js"),
  ).byteLength;
  const cssGzipBytes = gzipSync(
    readFileSync("extensions/adaptive-panel/assets/adaptive-panel.css"),
  ).byteLength;
  assert.ok(runtimeGzipBytes <= ADAPTIVE_PERFORMANCE_BUDGETS.assets.maximumCombinedRuntimeGzipBytes, `${runtimeGzipBytes} runtime gzip bytes`);
  assert.ok(adaptiveV2GzipBytes <= ADAPTIVE_PERFORMANCE_BUDGETS.assets.maximumAdaptiveV2GzipBytes, `${adaptiveV2GzipBytes} adaptive v2 gzip bytes`);
  assert.ok(cssGzipBytes <= ADAPTIVE_PERFORMANCE_BUDGETS.assets.maximumCssGzipBytes, `${cssGzipBytes} adaptive CSS gzip bytes`);
});

test("deterministic mapping selection core meets its local p95 budget", () => {
  const campaignRef = campaignSignature({ source: "meta", campaign: "travel" });
  const snapshot = createMappingSnapshot([{
    merchantId: "merchant-performance",
    productId: "product-performance",
    locale: "en",
    campaignRef,
    signature: campaignRef,
    mappingVersion: 1,
    bundleId: "bundle-performance",
    status: "ACTIVE",
  }]);
  const samples: number[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    const started = performance.now();
    const result = resolveAdaptiveMapping({
      merchantId: "merchant-performance",
      productId: "product-performance",
      locale: "en",
      campaignRef,
      snapshot,
      now: new Date("2026-09-06T00:00:00.000Z"),
    });
    samples.push(performance.now() - started);
    assert.equal(result.reason, "MAPPED_CAMPAIGN");
  }
  samples.sort((left, right) => left - right);
  const p95 = samples[Math.ceil(samples.length * .95) - 1]!;
  assert.ok(p95 <= ADAPTIVE_PERFORMANCE_BUDGETS.latencyMs.deterministicSelectionCoreP95, `selection p95 ${p95.toFixed(4)}ms`);
});

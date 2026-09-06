export const ADAPTIVE_PERFORMANCE_BUDGETS = Object.freeze({
  contractVersion: "adaptive-performance-a1",
  measurementWindow: Object.freeze({
    minimumEligibleDecisions: 1_000,
    maximumWindowMinutes: 5,
  }),
  latencyMs: Object.freeze({
    deterministicSelectionCoreP95: 2,
    serverDecisionP95: 100,
    browserRequestToDecisionP95: 500,
    panelRenderP95: 16,
  }),
  layout: Object.freeze({
    cumulativeLayoutShiftP75: 0.05,
    overflowViewportWidthsPx: Object.freeze([320, 375, 768, 1024, 1440]),
  }),
  assets: Object.freeze({
    maximumCombinedRuntimeGzipBytes: 10 * 1024,
    maximumAdaptiveV2GzipBytes: 5 * 1024,
    maximumCssGzipBytes: 1024,
    maximumExternalAdaptiveAssetReferences: 0,
  }),
});

export type AdaptivePerformanceEvidence = {
  eligibleDecisions: number;
  windowMinutes: number;
  serverDecisionP95Ms: number;
  browserRequestToDecisionP95Ms: number;
  panelRenderP95Ms: number;
  cumulativeLayoutShiftP75: number;
  combinedRuntimeGzipBytes: number;
  adaptiveV2GzipBytes: number;
  cssGzipBytes: number;
  externalAdaptiveAssetReferences: number;
};

/** Missing, non-finite or undersized evidence fails closed. */
export function assessAdaptivePerformanceEvidence(value: AdaptivePerformanceEvidence) {
  const budget = ADAPTIVE_PERFORMANCE_BUDGETS;
  const finite = Object.values(value).every(
    (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
  );
  const reasons: string[] = [];
  if (!finite) reasons.push("NON_FINITE_EVIDENCE");
  if (value.eligibleDecisions < budget.measurementWindow.minimumEligibleDecisions)
    reasons.push("DECISION_SAMPLE_TOO_SMALL");
  if (value.windowMinutes > budget.measurementWindow.maximumWindowMinutes)
    reasons.push("MEASUREMENT_WINDOW_TOO_LONG");
  if (value.serverDecisionP95Ms > budget.latencyMs.serverDecisionP95)
    reasons.push("SERVER_DECISION_P95_EXCEEDED");
  if (value.browserRequestToDecisionP95Ms > budget.latencyMs.browserRequestToDecisionP95)
    reasons.push("BROWSER_DECISION_P95_EXCEEDED");
  if (value.panelRenderP95Ms > budget.latencyMs.panelRenderP95)
    reasons.push("PANEL_RENDER_P95_EXCEEDED");
  if (value.cumulativeLayoutShiftP75 > budget.layout.cumulativeLayoutShiftP75)
    reasons.push("LAYOUT_SHIFT_P75_EXCEEDED");
  if (value.combinedRuntimeGzipBytes > budget.assets.maximumCombinedRuntimeGzipBytes)
    reasons.push("RUNTIME_ASSET_BUDGET_EXCEEDED");
  if (value.adaptiveV2GzipBytes > budget.assets.maximumAdaptiveV2GzipBytes)
    reasons.push("ADAPTIVE_V2_ASSET_BUDGET_EXCEEDED");
  if (value.cssGzipBytes > budget.assets.maximumCssGzipBytes)
    reasons.push("ADAPTIVE_CSS_BUDGET_EXCEEDED");
  if (value.externalAdaptiveAssetReferences > budget.assets.maximumExternalAdaptiveAssetReferences)
    reasons.push("UNAPPROVED_ADAPTIVE_ASSET_REFERENCE");
  return { pass: reasons.length === 0, reasons };
}

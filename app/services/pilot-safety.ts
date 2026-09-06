export type SafetyInput = {
  killSwitchActive: boolean;
  openSeverityOneIncidents: number;
  renderAttempts: number;
  renderFailures: number;
  decisionLatenciesMs: number[];
  serverProcessingLatenciesMs?: number[];
  thresholds?: {
    decisionP95MillisecondsMaximum?: number;
    serverProcessingP95MillisecondsMaximum?: number | null;
  };
};

export type SafetyAssessment = {
  outcome: "HEALTHY" | "MONITOR" | "ROLLBACK";
  rollback: boolean;
  reasons: string[];
  metrics: {
    renderSuccessRate: number | null;
    javascriptErrorRate: number | null;
    decisionP95Milliseconds: number | null;
    serverProcessingP95Milliseconds: number | null;
  };
};

function percentile(values: number[], quantile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * quantile) - 1,
  );
  return sorted[Math.max(0, index)];
}

export function assessRuntimeSafety(input: SafetyInput): SafetyAssessment {
  const renderSuccessRate = input.renderAttempts
    ? (input.renderAttempts - input.renderFailures) / input.renderAttempts
    : null;
  const javascriptErrorRate = input.renderAttempts
    ? input.renderFailures / input.renderAttempts
    : null;
  const decisionP95Milliseconds = percentile(input.decisionLatenciesMs, 0.95);
  const serverProcessingLatenciesMs = input.serverProcessingLatenciesMs ?? [];
  const serverProcessingP95Milliseconds = percentile(
    serverProcessingLatenciesMs,
    0.95,
  );
  const decisionMaximum =
    input.thresholds?.decisionP95MillisecondsMaximum ?? 150;
  const serverProcessingMaximum =
    input.thresholds?.serverProcessingP95MillisecondsMaximum ?? null;
  const reasons: string[] = [];

  if (input.killSwitchActive)
    reasons.push("The merchant kill switch is active.");
  if (input.openSeverityOneIncidents > 0)
    reasons.push("A Severity 1 incident is open.");
  if (
    input.renderAttempts >= 20 &&
    renderSuccessRate != null &&
    renderSuccessRate < 0.995
  ) {
    reasons.push(
      `Render success ${(renderSuccessRate * 100).toFixed(2)}% is below 99.5%.`,
    );
  }
  if (
    input.renderAttempts >= 100 &&
    javascriptErrorRate != null &&
    javascriptErrorRate > 0.001
  ) {
    reasons.push(
      `Runtime failure rate ${(javascriptErrorRate * 100).toFixed(3)}% exceeds 0.1%.`,
    );
  }
  if (
    input.decisionLatenciesMs.length >= 20 &&
    decisionP95Milliseconds != null &&
    decisionP95Milliseconds > decisionMaximum
  ) {
    reasons.push(
      `Decision p95 ${decisionP95Milliseconds.toFixed(0)} ms exceeds ${decisionMaximum.toFixed(0)} ms.`,
    );
  }
  if (
    serverProcessingMaximum != null &&
    serverProcessingLatenciesMs.length >= 20 &&
    serverProcessingP95Milliseconds != null &&
    serverProcessingP95Milliseconds > serverProcessingMaximum
  ) {
    reasons.push(
      `Server processing p95 ${serverProcessingP95Milliseconds.toFixed(0)} ms exceeds ${serverProcessingMaximum.toFixed(0)} ms.`,
    );
  }

  const immediate =
    input.killSwitchActive || input.openSeverityOneIncidents > 0;
  const thresholdFailure = reasons.length > (immediate ? 1 : 0);
  const rollback = immediate || thresholdFailure;
  const enoughEvidence =
    input.renderAttempts >= 20 ||
    input.decisionLatenciesMs.length >= 20 ||
    serverProcessingLatenciesMs.length >= 20;
  return {
    outcome: rollback ? "ROLLBACK" : enoughEvidence ? "HEALTHY" : "MONITOR",
    rollback,
    reasons,
    metrics: {
      renderSuccessRate,
      javascriptErrorRate,
      decisionP95Milliseconds,
      serverProcessingP95Milliseconds,
    },
  };
}

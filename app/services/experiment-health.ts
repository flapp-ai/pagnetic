export type ExperimentPolicy = "ORIGINAL" | "UNIVERSAL" | "MATCHED";

export type HealthStatus = "PASS" | "WARN" | "WAIT" | "NA";

export type HealthCheck = {
  key: "allocation" | "decisionCoverage" | "renderCoverage" | "orderJoin";
  label: string;
  status: HealthStatus;
  value: string;
  detail: string;
};

export type ExperimentHealthInput = {
  totalAssignments: number;
  controlAssignments: number;
  controlPercentage: number;
  decisions: number;
  decisionsWithPixelEvent: number;
  matchedPolicyDecisions: number;
  renderReports: number;
  orders: number;
  attributedOrders: number;
};

function percentage(numerator: number, denominator: number) {
  return denominator ? (numerator / denominator) * 100 : 0;
}

export function executionPolicyForArm(
  arm: "ORIGINAL" | "MATCHED",
  controlPolicy: ExperimentPolicy,
  treatmentPolicy: ExperimentPolicy,
) {
  return arm === "ORIGINAL" ? controlPolicy : treatmentPolicy;
}

export function allocationZScore(input: {
  total: number;
  observedControl: number;
  controlPercentage: number;
}) {
  const probability = input.controlPercentage / 100;
  const variance = input.total * probability * (1 - probability);
  if (input.total <= 0 || variance <= 0) return 0;
  return (
    Math.abs(input.observedControl - input.total * probability) /
    Math.sqrt(variance)
  );
}

export function assessExperimentHealth(
  input: ExperimentHealthInput,
): HealthCheck[] {
  const observedControl = percentage(
    input.controlAssignments,
    input.totalAssignments,
  );
  const zScore = allocationZScore({
    total: input.totalAssignments,
    observedControl: input.controlAssignments,
    controlPercentage: input.controlPercentage,
  });
  const decisionCoverage = percentage(
    input.decisionsWithPixelEvent,
    input.decisions,
  );
  const renderCoverage = percentage(
    input.renderReports,
    input.matchedPolicyDecisions,
  );
  const orderJoinRate = percentage(input.attributedOrders, input.orders);

  return [
    {
      key: "allocation",
      label: "Allocation balance",
      status:
        input.totalAssignments < 20 ? "WAIT" : zScore >= 3.29 ? "WARN" : "PASS",
      value: input.totalAssignments
        ? `${observedControl.toFixed(1)}% control`
        : "No assignments",
      detail:
        input.totalAssignments < 20
          ? "Collect at least 20 assignments before checking sample-ratio mismatch."
          : `${zScore.toFixed(2)} standard deviations from the frozen allocation.`,
    },
    {
      key: "decisionCoverage",
      label: "Decision pixel coverage",
      status:
        input.decisions < 10
          ? "WAIT"
          : decisionCoverage >= 95
            ? "PASS"
            : "WARN",
      value: `${decisionCoverage.toFixed(1)}%`,
      detail: `${input.decisionsWithPixelEvent} of ${input.decisions} server decisions have a matching pixel event.`,
    },
    {
      key: "renderCoverage",
      label: "Matched render reporting",
      status:
        input.matchedPolicyDecisions === 0
          ? "NA"
          : input.matchedPolicyDecisions < 5
            ? "WAIT"
            : renderCoverage >= 95
              ? "PASS"
              : "WARN",
      value: input.matchedPolicyDecisions
        ? `${renderCoverage.toFixed(1)}%`
        : "Not applicable",
      detail: input.matchedPolicyDecisions
        ? `${input.renderReports} of ${input.matchedPolicyDecisions} matched-policy decisions reported a render result.`
        : "Both A/A arms execute the original experience, so no adaptive render is expected.",
    },
    {
      key: "orderJoin",
      label: "Order attribution",
      status:
        input.orders === 0 ? "WAIT" : orderJoinRate >= 90 ? "PASS" : "WARN",
      value: input.orders ? `${orderJoinRate.toFixed(1)}%` : "No test orders",
      detail: `${input.attributedOrders} of ${input.orders} observed orders joined to a decision.`,
    },
  ];
}

export function readinessFromChecks(checks: HealthCheck[]) {
  if (checks.some((check) => check.status === "WARN")) return "HOLD" as const;
  if (checks.some((check) => check.status === "WAIT"))
    return "COLLECTING" as const;
  return "READY" as const;
}

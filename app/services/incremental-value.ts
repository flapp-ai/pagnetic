export type MatureResultState =
  | "POSITIVE"
  | "NEGATIVE"
  | "INCONCLUSIVE"
  | "INVALID";

export function calculateIncrementalValue(input: {
  resultState: MatureResultState;
  currencyCode: string;
  treatmentNetRevenueMinor: number;
  treatmentEligibleSessions: number;
  controlNetRevenueMinor: number;
  controlEligibleSessions: number;
  intervalLowMinorPerSession?: number | null;
  intervalHighMinorPerSession?: number | null;
  projectedMonthlyEligibleSessions?: number | null;
}) {
  const treatmentRps =
    input.treatmentEligibleSessions > 0
      ? input.treatmentNetRevenueMinor / input.treatmentEligibleSessions
      : 0;
  const controlRps =
    input.controlEligibleSessions > 0
      ? input.controlNetRevenueMinor / input.controlEligibleSessions
      : 0;
  const differenceMinorPerSession = treatmentRps - controlRps;
  const verifiedIncrementalMinor = Math.round(
    differenceMinorPerSession * input.treatmentEligibleSessions,
  );
  const intervalLowMinor =
    input.intervalLowMinorPerSession == null
      ? null
      : Math.round(
          input.intervalLowMinorPerSession * input.treatmentEligibleSessions,
        );
  const intervalHighMinor =
    input.intervalHighMinorPerSession == null
      ? null
      : Math.round(
          input.intervalHighMinorPerSession * input.treatmentEligibleSessions,
        );
  const projectedMonthlyMinor =
    input.projectedMonthlyEligibleSessions == null ||
    input.resultState === "INVALID"
      ? null
      : Math.round(
          differenceMinorPerSession * input.projectedMonthlyEligibleSessions,
        );
  return {
    currencyCode: input.currencyCode.toUpperCase(),
    differenceMinorPerSession,
    verifiedIncrementalMinor,
    intervalLowMinor,
    intervalHighMinor,
    projectedMonthlyMinor,
  };
}

export function formatMinorMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(amountMinor / 100);
}

export function recommendationForResult(resultState: MatureResultState) {
  return {
    POSITIVE: "Keep the improved message",
    NEGATIVE: "Return to Original and revise the message",
    INCONCLUSIVE: "Keep Original while a revised test is prepared",
    INVALID: "Keep Original and repair measurement before testing again",
  }[resultState];
}

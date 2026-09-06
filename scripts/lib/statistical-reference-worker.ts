// Development-only bridge: execute the actual estimator against independent fixtures.
import { createInterface } from "node:readline";

import { analyzeV2Experiment, studentTCdf, studentTQuantile } from "../../app/services/experiment-analysis-v2";
import { evaluateQualificationV2 } from "../../app/services/qualification-v2";

const assignmentsBySize = new Map<number, Array<{ id: string; arm: "ORIGINAL" | "MATCHED" }>>();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  try {
    const input = JSON.parse(line);
    if (input.qualification) {
      const values: string[] = input.qualification.values.map(String);
      process.stdout.write(`${JSON.stringify(evaluateQualificationV2({
        observationStart: new Date("2026-09-01Z"), observationEnd: new Date("2026-09-08Z"),
        dataSource: "SYNTHETIC_REFERENCE_ONLY", eligibleVisitors: values.length,
        eligibleSessions: values.length, paidPurchasers: values.filter((value) => value !== "0").length,
        visitorRevenueMinor: values,
        dailyEligibleVisitors: Array.from({ length: 7 }, (_, index) => Math.floor(values.length / 7) + Number(index < values.length % 7)),
        dailyObservableCheckoutVisitors: Array.from({ length: 7 }, (_, index) => {
          const purchasers = values.filter((value) => value !== "0").length;
          return Math.floor(purchasers / 7) + Number(index < purchasers % 7);
        }),
        outcomesObservedThrough: new Date("2026-09-15Z"),
        currencyCode: "USD", coverage: 1, targetEffect: .2,
      }))}\n`);
      continue;
    }
    if (input.quantiles) {
      process.stdout.write(`${JSON.stringify(input.quantiles.map((item: { p: number; df: number }) => ({
        value: studentTQuantile(item.p, item.df),
        cdf: studentTCdf(studentTQuantile(item.p, item.df), item.df),
      })))}\n`);
      continue;
    }
    const results = input.trials.map((trial: { n: number; control: number[]; treatment: number[]; mde: number }) => {
      let assignments = assignmentsBySize.get(trial.n);
      if (!assignments) {
        assignments = Array.from({ length: 2 * trial.n }, (_, index) => ({
          id: `${index < trial.n ? "c" : "t"}${index % trial.n}`,
          arm: index < trial.n ? "ORIGINAL" : "MATCHED",
        }));
        assignmentsBySize.set(trial.n, assignments);
      }
      const result = analyzeV2Experiment({
        testType: "AB", now: new Date("2026-10-20Z"),
        enrollmentStartedAt: new Date("2026-09-01Z"),
        enrollmentClosedAt: new Date("2026-09-15Z"),
        financialMaturityAt: new Date("2026-09-29Z"),
        stopReason: null, healthState: "READY", financialComplete: true,
        targetVisitors: 2 * trial.n, minimumPaidOrders: 20,
        minimumWorthwhileRelativeEffect: trial.mde, alpha: 0.05, currencyCode: "USD",
        assignments,
        outcomes: [
          ...trial.control.map((value, index) => ({ assignmentId: `c${index}`, netFocalRevenueMinor: String(value), paidOrders: 1 })),
          ...trial.treatment.map((value, index) => ({ assignmentId: `t${index}`, netFocalRevenueMinor: String(value), paidOrders: 1 })),
        ],
      });
      return { lower: result.intervalMinor.lower, upper: result.intervalMinor.upper,
        df: result.degreesOfFreedom, effect: result.effectMinor, state: result.resultState };
    });
    process.stdout.write(`${JSON.stringify(results)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  }
}

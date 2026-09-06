import {
  assessExperimentHealth,
  executionPolicyForArm,
  readinessFromChecks,
} from "../app/services/experiment-health";
import { experimentBucket } from "../app/services/measurement.server";

const sampleSize = Number(process.env.AA_SAMPLE_SIZE ?? 10_000);
if (!Number.isInteger(sampleSize) || sampleSize < 100 || sampleSize > 100_000) {
  throw new Error("AA_SAMPLE_SIZE must be a whole number from 100 to 100000.");
}

let controlAssignments = 0;
for (let index = 0; index < sampleSize; index += 1) {
  const bucket = experimentBucket({
    merchantId: "synthetic-merchant",
    experimentId: "synthetic-aa-v1",
    randomizationUnitId: `synthetic-unit-${index}`,
    salt: "synthetic-aa-validation-salt",
  });
  if (bucket < 5_000) controlAssignments += 1;
}

const policies = {
  armA: executionPolicyForArm("ORIGINAL", "ORIGINAL", "ORIGINAL"),
  armB: executionPolicyForArm("MATCHED", "ORIGINAL", "ORIGINAL"),
};
const checks = assessExperimentHealth({
  totalAssignments: sampleSize,
  controlAssignments,
  controlPercentage: 50,
  decisions: sampleSize,
  decisionsWithPixelEvent: sampleSize,
  matchedPolicyDecisions: 0,
  renderReports: 0,
  orders: 100,
  attributedOrders: 100,
});

console.log(
  JSON.stringify({
    sampleSize,
    controlAssignments,
    policies,
    readiness: readinessFromChecks(checks),
    checks,
  }),
);

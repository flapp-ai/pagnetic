import assert from "node:assert/strict";
import test from "node:test";

import {
  canPresentMonetaryResult,
  findFinalizationReviewNotice,
  formatMinorAmount,
  resolveFrozenResultSnapshot,
} from "../app/services/result-presentation-v2";

const snapshot = {
  id: "snapshot-final",
  experimentId: "experiment-a",
  resultState: "POSITIVE",
  payloadJson: "{}",
};

test("results select only the exact final snapshot pointer", () => {
  const latestButProvisional = {
    ...snapshot,
    id: "snapshot-latest",
    resultState: "COLLECTING",
  };
  assert.equal(
    resolveFrozenResultSnapshot({
      experimentId: "experiment-a",
      finalResultSnapshotId: "snapshot-final",
      snapshots: [latestButProvisional, snapshot],
    }),
    snapshot,
  );
  assert.equal(
    resolveFrozenResultSnapshot({
      experimentId: "experiment-b",
      finalResultSnapshotId: "snapshot-final",
      snapshots: [snapshot],
    }),
    null,
  );
  assert.equal(
    resolveFrozenResultSnapshot({
      experimentId: "experiment-a",
      finalResultSnapshotId: null,
      snapshots: [snapshot],
    }),
    null,
  );
});

test("monetary claims require a matching mature effect state and exact minor units", () => {
  assert.equal(
    canPresentMonetaryResult({
      frozenResultState: "POSITIVE",
      payloadResultState: "POSITIVE",
      estimatedAdditionalSalesMinor: "3000000000",
    }),
    true,
  );
  for (const candidate of [
    {
      frozenResultState: "COLLECTING",
      payloadResultState: "POSITIVE",
      estimatedAdditionalSalesMinor: "500",
    },
    {
      frozenResultState: "POSITIVE",
      payloadResultState: "NEGATIVE",
      estimatedAdditionalSalesMinor: "500",
    },
    {
      frozenResultState: "POSITIVE",
      payloadResultState: "POSITIVE",
      estimatedAdditionalSalesMinor: "5.25",
    },
  ]) {
    assert.equal(canPresentMonetaryResult(candidate), false);
  }
});

test("money formatting accepts exact minor strings and finite interval estimates", () => {
  assert.equal(formatMinorAmount("3000000000", "USD"), "30000000.00 USD");
  assert.equal(formatMinorAmount(-125.5, "USD"), "-1.25 USD");
  assert.equal(formatMinorAmount("1.5", "USD"), "Not available");
  assert.equal(formatMinorAmount(Number.NaN, "USD"), "Not available");
});

test("post-finalization updates surface only for the exact frozen experiment", () => {
  const notice = findFinalizationReviewNotice({
    experimentId: "experiment-a",
    finalResultSnapshotId: "snapshot-final",
    audits: [
      {
        createdAt: new Date("2026-09-05T10:30:00.000Z"),
        detailsJson: JSON.stringify({
          experimentId: "experiment-other",
          finalResultSnapshotId: "snapshot-final",
          reviewRequired: true,
        }),
      },
      {
        createdAt: new Date("2026-09-05T10:00:00.000Z"),
        detailsJson: JSON.stringify({
          experimentId: "experiment-a",
          finalResultSnapshotId: "snapshot-final",
          revisionHash: "abcdef1234567890",
          reviewRequired: true,
        }),
      },
    ],
  });
  assert.deepEqual(notice, {
    detectedAt: "2026-09-05T10:00:00.000Z",
    reference: "abcdef123456",
  });
});

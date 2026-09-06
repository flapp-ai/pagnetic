import assert from "node:assert/strict";
import test from "node:test";

import { buildActivationJourney } from "../app/services/activation";

const emptyFacts = {
  catalogSynced: false,
  heroSelected: false,
  brandApproved: false,
  draftLibraryCreated: false,
  contentApproved: false,
  productQualified: false,
  themeActive: false,
  qaComplete: false,
  pixelActive: false,
  aaRegistered: false,
  aaValidated: false,
  realResultReady: false,
};

test("guided activation points to the first incomplete value step", () => {
  const initial = buildActivationJourney(emptyFacts);
  assert.equal(initial.next?.key, "catalog");
  assert.equal(initial.percent, 0);
  const afterPreview = buildActivationJourney({
    ...emptyFacts,
    catalogSynced: true,
    heroSelected: true,
    brandApproved: true,
    draftLibraryCreated: true,
  });
  assert.equal(afterPreview.next?.key, "approve");
  assert.equal(afterPreview.completed, 2);
});

test("free beta journey finishes only after a real result is ready", () => {
  const journey = buildActivationJourney(
    Object.fromEntries(
      Object.keys(emptyFacts).map((key) => [key, true]),
    ) as typeof emptyFacts,
  );
  assert.equal(journey.percent, 100);
  assert.equal(journey.next, null);
});

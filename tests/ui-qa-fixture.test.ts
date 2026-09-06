import assert from "node:assert/strict";
import test from "node:test";

import { uiQaReadOnlyResponse, uiQaRequestAllowed } from "../app/services/ui-qa-fixture.server";

const devEnabled = {
  NODE_ENV: "development",
  PAGNETIC_UI_QA: "true",
};

test("local UI QA fixture is allowed only for an explicit non-production local request", async () => {
  assert.equal(uiQaRequestAllowed(new Request("http://127.0.0.1:9294/qa/v2-ui"), devEnabled), true);
  assert.equal(uiQaRequestAllowed(new Request("http://localhost:9294/qa/v2-ui"), devEnabled), true);
  assert.equal(uiQaRequestAllowed(new Request("http://[::1]:9294/qa/v2-ui"), devEnabled), true);

  assert.equal(uiQaRequestAllowed(new Request("https://merchant.example/qa/v2-ui"), devEnabled), false);
  assert.equal(uiQaRequestAllowed(new Request("http://127.0.0.1:9294/qa/v2-ui"), {
    NODE_ENV: "production",
    PAGNETIC_UI_QA: "true",
  }), false);
  assert.equal(uiQaRequestAllowed(new Request("http://127.0.0.1:9294/qa/v2-ui"), {
    NODE_ENV: "development",
    PAGNETIC_UI_QA: "false",
  }), false);
});

test("local UI QA fixture responses are always read-only", async () => {
  const response = uiQaReadOnlyResponse();
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), {
    ok: false,
    message: "The isolated UI fixture is read-only.",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

await import("../extensions/adaptive-panel/assets/adaptive-panel.js");
await import("../extensions/adaptive-panel/assets/adaptive-panel-v2.js");

const {
  analyticsEventName,
  normalizeAngle,
  resolvePreflightDecision,
  runtimeFailureCode,
  validateRuntimePayload,
} = globalThis.AdaptiveStorefrontDecision;
const {
  identityContext: identityContextV2,
  formOwnsProduct: formOwnsV2Product,
  attachReference: attachV2ReferenceToCurrentProductForm,
  clearReferences: clearV2References,
  leaseStillValid,
  initialize: initializeV2,
  deactivate: deactivateV2,
  watchLease,
  validatePayload: validateRuntimePayloadV2,
  campaignRefFromLocation,
  render: renderV2,
} = globalThis.PagneticAutopilotTest;

test("extracts only validated campaign references from storefront URLs", () => {
  assert.equal(campaignRefFromLocation("https://shop.test/products/bag?pag_campaign=abc-123&utm_source=ig"), "abc-123");
  assert.equal(campaignRefFromLocation("https://shop.test/products/bag?pag_campaign=bad%3Fvalue"), null);
  assert.equal(campaignRefFromLocation("https://shop.test/products/bag"), null);
});

test("normalizes explicit acquisition angles", () => {
  assert.equal(normalizeAngle(" Knee Comfort "), "knee_comfort");
  assert.equal(normalizeAngle("VALUE/PRICE"), "value_price");
  assert.equal(normalizeAngle(null), "");
});

test("publishes Shopify-safe custom event names", () => {
  assert.equal(
    analyticsEventName("adaptive-storefront:decision"),
    "adaptive_storefront_decision",
  );
  assert.equal(
    analyticsEventName("adaptive-storefront:render"),
    "adaptive_storefront_render",
  );
});

test("keeps configured original local and sends experiments to server assignment", () => {
  assert.deepEqual(resolvePreflightDecision({ mode: "original" }), {
    arm: "original",
    policy: null,
    reason: "configured_original",
  });

  const decision = resolvePreflightDecision({
    mode: "experiment",
    experimentId: "experiment-a",
    randomizationUnitId: "visitor-a",
    controlPercentage: 100,
  });
  assert.deepEqual(decision, {
    arm: "candidate",
    policy: "experiment",
    reason: "experiment_server_assignment",
  });
});

test("requests governed content for matched treatment", () => {
  const decision = resolvePreflightDecision({
    mode: "matched",
    experimentId: "experiment-a",
    randomizationUnitId: "visitor-a",
  });

  assert.deepEqual(decision, {
    arm: "candidate",
    policy: "matched",
    reason: "configured_matched",
  });
});

test("accepts only complete runtime payloads", () => {
  const payload = {
    schemaVersion: 1,
    arm: "matched",
    acquisitionAngle: "comfort",
    mappingVersion: 1,
    experience: {
      id: "expv_1",
      version: 1,
      contentHash: "a".repeat(64),
      headline: "Approved headline",
      supportingLine: null,
      benefits: ["One", "Two", "Three"],
      proofItems: [],
      reassurance: null,
    },
  };

  assert.equal(validateRuntimePayload(payload), true);
  assert.equal(
    validateRuntimePayload({
      ...payload,
      experience: { ...payload.experience, benefits: ["Only one"] },
    }),
    false,
  );
  assert.equal(
    validateRuntimePayload({
      schemaVersion: 1,
      arm: "original",
      experience: null,
    }),
    true,
  );
  assert.equal(
    validateRuntimePayload({
      schemaVersion: 1,
      arm: "original",
      experience: null,
      measurement: {
        decisionId: "dec_1",
        experimentId: "experiment-a",
        experimentVersion: 1,
        assignmentId: "asn_1",
        assignmentArm: "original",
        bucket: 124,
        persistence: "visitor",
        serverProcessingMs: 18,
      },
    }),
    true,
  );
  assert.equal(
    validateRuntimePayload({
      schemaVersion: 1,
      arm: "original",
      experience: null,
      measurement: { decisionId: "dec_1" },
    }),
    false,
  );
});

test("classifies storefront runtime failures without exposing error details", () => {
  assert.equal(runtimeFailureCode({ name: "AbortError" }), "timeout");
  assert.equal(runtimeFailureCode({ adaptiveCode: "http_404" }), "http_404");
  assert.equal(
    runtimeFailureCode({ adaptiveCode: "invalid_response" }),
    "invalid_response",
  );
  assert.equal(
    runtimeFailureCode({ adaptiveCode: "measurement_missing" }),
    "measurement_missing",
  );
  assert.equal(runtimeFailureCode(new Error("opaque")), "network_error");
});

test("v2 accepts only sourced panel content and explicit Original", () => {
  assert.equal(
    validateRuntimePayloadV2({
      schemaVersion: 2,
      serving: "ORIGINAL",
      reason: "CONSENT_UNAVAILABLE",
      content: null,
    }),
    true,
  );
  const treatment = {
    schemaVersion: 2,
    serving: "UNIVERSAL",
    reason: "V2_EXPERIMENT_ASSIGNMENT",
    content: {
      schemaVersion: 2,
      contentVersionId: "content_0001",
      contentHash: "a".repeat(64),
      headline: "Supported headline",
      headlineEvidenceIds: ["evidence-1"],
      benefits: [
        { text: "Supported benefit one", evidenceIds: ["evidence-1"] },
        { text: "Supported benefit two", evidenceIds: ["evidence-2"] },
      ],
      reassurance: null,
    },
  };
  assert.equal(validateRuntimePayloadV2(treatment), true);
  assert.equal(
    validateRuntimePayloadV2({
      ...treatment,
      content: { ...treatment.content, headlineEvidenceIds: [] },
    }),
    false,
  );
});

test("v2 renders bounded proof and FAQ as text with native disclosure semantics", () => {
  const priorDocument = globalThis.document;
  const elements = [];
  const createElement = (tagName) => {
    const element = {
      tagName: tagName.toUpperCase(),
      children: [],
      className: "",
      textContent: "",
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this[name] = value; },
    };
    elements.push(element);
    return element;
  };
  const panel = {
    dataset: { blockId: "faq-test" },
    hidden: true,
    children: [],
    replaceChildren(...children) { this.children = children; },
  };
  try {
    globalThis.document = { createElement };
    renderV2(panel, { content: {
      headline: "Exact supported headline",
      benefits: [
        { text: "Supported benefit one", evidenceIds: ["evidence-1"] },
        { text: "Supported benefit two", evidenceIds: ["evidence-2"] },
      ],
      proofItems: ["Exact product fact, not a testimonial."],
      faq: [{ question: "What fits?", answer: "The sourced dimensions are shown above.", evidenceIds: ["evidence-3"] }],
      reassurance: null,
    } });
    assert.equal(panel.hidden, false);
    assert.equal(elements.filter((element) => element.tagName === "DETAILS").length, 1);
    assert.equal(elements.filter((element) => element.tagName === "SUMMARY").length, 1);
    assert.ok(elements.some((element) => element.textContent === "Exact product fact, not a testimonial."));
    assert.ok(elements.some((element) => element.textContent === "What fits?"));
    assert.equal(elements.some((element) => Object.hasOwn(element, "innerHTML")), false);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test("v2 missing consent has no identity and fixed visitor expiry never slides", async () => {
  const prior = {
    Shopify: globalThis.Shopify,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    location: globalThis.location,
  };
  const createStorage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      values,
    };
  };
  const local = createStorage();
  const session = createStorage();
  try {
    globalThis.localStorage = local;
    globalThis.sessionStorage = session;
    globalThis.location = { hostname: "unit-test.myshopify.com" };
    delete globalThis.Shopify;
    assert.deepEqual(await identityContextV2(1_000), {
      allowed: false,
      status: "unknown",
      visitorToken: null,
      sessionId: null,
    });
    globalThis.Shopify = {
      customerPrivacy: {
        analyticsProcessingAllowed: () => true,
        preferencesProcessingAllowed: () => true,
      },
    };
    const first = await identityContextV2(2_000);
    const second = await identityContextV2(3_000);
    assert.equal(first.allowed, true);
    assert.equal(second.visitorToken, first.visitorToken);
    const stored = JSON.parse([...local.values.values()][0]);
    assert.equal(stored.createdAt, 2_000);
    assert.equal(
      stored.expiresAt - stored.createdAt,
      90 * 24 * 60 * 60 * 1000,
    );
    globalThis.Shopify.customerPrivacy.analyticsProcessingAllowed = () => false;
    const revoked = await identityContextV2(4_000);
    assert.equal(revoked.allowed, false);
    assert.equal(local.values.size, 0);
    assert.equal(session.values.size, 0);
  } finally {
    if (prior.Shopify === undefined) delete globalThis.Shopify;
    else globalThis.Shopify = prior.Shopify;
    if (prior.localStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prior.localStorage;
    if (prior.sessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = prior.sessionStorage;
    if (prior.location === undefined) delete globalThis.location;
    else globalThis.location = prior.location;
  }
});

test("v2 order references attach only to forms owned by the selected product", () => {
  const priorDocument = globalThis.document;
  function createForm(variantId) {
    const form = {
      dataset: {},
      variantControl: { value: variantId },
      reference: null,
      querySelector(selector) {
        if (selector === "[name='id']") return this.variantControl;
        if (selector === "input[data-pagnetic-reference]") return this.reference;
        return null;
      },
      appendChild(input) {
        this.reference = input;
        input.remove = () => { this.reference = null; };
      },
    };
    return form;
  }
  const selected = createForm("variant-hero-2");
  const unrelated = createForm("variant-other-1");
  const scope = {
    dataset: {},
    querySelectorAll(selector) {
      if (selector === "form[action*='/cart/add']") return [selected, unrelated];
      if (selector === "input[data-pagnetic-reference]")
        return [selected.reference, unrelated.reference].filter(Boolean);
      return [];
    },
    addEventListener() {},
  };
  const panel = {
    dataset: {
      productId: "gid://shopify/Product/hero",
      productVariantIds: "variant-hero-1,variant-hero-2",
    },
    closest: () => scope,
  };
  try {
    globalThis.document = {
      createElement: () => ({ dataset: {} }),
    };
    assert.equal(formOwnsV2Product(panel, selected), true);
    assert.equal(formOwnsV2Product(panel, unrelated), false);
    attachV2ReferenceToCurrentProductForm(panel, "signed.reference");
    assert.equal(selected.reference.value, "signed.reference");
    assert.equal(selected.reference.dataset.pp, panel.dataset.productId);
    assert.equal(unrelated.reference, null);
    clearV2References(panel);
    assert.equal(selected.reference, null);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test("v2 lease keeps measured control but revokes changed or paused treatment", () => {
  const control = {
    serving: "ORIGINAL",
    deploymentRevision: 4,
    assignmentId: "assignment-control",
  };
  assert.equal(leaseStillValid(control, { ...control }), true);
  assert.equal(
    leaseStillValid(control, { ...control, assignmentId: null }),
    false,
  );
  const treatment = {
    serving: "UNIVERSAL",
    deploymentRevision: 4,
    assignmentId: "assignment-treatment",
  };
  assert.equal(
    leaseStillValid(treatment, { ...treatment, serving: "ORIGINAL" }),
    false,
  );
  assert.equal(
    leaseStillValid(treatment, { ...treatment, deploymentRevision: 5 }),
    false,
  );
});

test("v2 lease deadline hides treatment before a deferred network recheck", () => {
  const prior = {
    Shopify: globalThis.Shopify,
    document: globalThis.document,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  const scheduled = [];
  const reference = {
    dataset: { pp: "gid://shopify/Product/1" },
    remove() { scope.reference = null; },
  };
  const scope = {
    reference,
    querySelectorAll: (selector) =>
      selector === "input[data-pagnetic-reference]" && scope.reference
        ? [scope.reference]
        : [],
  };
  const panel = {
    dataset: {
      pg: "1",
      productId: "gid://shopify/Product/1",
      pr: "signed.reference",
    },
    hidden: false,
    replaceChildren() {},
    closest: () => scope,
  };
  try {
    globalThis.Shopify = {
      customerPrivacy: {
        analyticsProcessingAllowed: () => true,
        preferencesProcessingAllowed: () => true,
      },
    };
    globalThis.document = {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.setTimeout = (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    };
    globalThis.clearTimeout = () => {};
    globalThis.fetch = () => new Promise(() => {});
    const payload = {
      serving: "UNIVERSAL",
      deploymentRevision: 1,
      assignmentId: "assignment-1",
    };
    watchLease(panel, {}, payload, 1);
    assert.equal(panel.hidden, false);
    scheduled[0]();
    assert.equal(panel.hidden, true);
    assert.equal(panel.dataset.pl, "checking");
    assert.equal(panel.dataset.pr, "");
    assert.equal(scope.reference, null);
  } finally {
    deactivateV2(panel, "test_cleanup", false);
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("v2 revoked fetch cannot overwrite a newly granted generation", async () => {
  const prior = {
    Shopify: globalThis.Shopify,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    location: globalThis.location,
    document: globalThis.document,
    fetch: globalThis.fetch,
  };
  const listeners = new Map();
  const values = () => {
    const map = new Map();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => map.set(key, value),
      removeItem: (key) => map.delete(key),
    };
  };
  let allowed = true;
  let fetchCount = 0;
  let resolveFirst;
  const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
  const response = (reason) => ({
    ok: true,
    json: async () => ({
      schemaVersion: 2,
      serving: "ORIGINAL",
      reason,
      deploymentId: null,
      deploymentRevision: null,
      experimentId: "experiment-generation",
      assignmentId: "assignment-generation",
      assignmentArm: "ORIGINAL",
      decisionId: "decision-generation",
      measurementReference: "signed.reference",
      expiresAt: "2026-09-12T00:00:00.000Z",
      content: null,
    }),
  });
  const panel = {
    dataset: {
      mode: "autopilot",
      productId: "gid://shopify/Product/1",
      blockVersion: "adaptive-panel-v2",
    },
    hidden: true,
    replaceChildren() {},
    closest: () => null,
  };
  try {
    globalThis.Shopify = {
      customerPrivacy: {
        analyticsProcessingAllowed: () => allowed,
        preferencesProcessingAllowed: () => allowed,
      },
    };
    globalThis.localStorage = values();
    globalThis.sessionStorage = values();
    globalThis.location = { hostname: "generation.myshopify.com" };
    globalThis.document = {
      hidden: false,
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener() {},
      dispatchEvent() {},
    };
    globalThis.fetch = async () => {
      fetchCount += 1;
      return fetchCount === 1 ? firstResponse : response("NEW_GENERATION");
    };
    const first = initializeV2(panel);
    while (fetchCount < 1)
      await new Promise((resolve) => globalThis.setImmediate(resolve));
    allowed = false;
    listeners.get("visitorConsentCollected")();
    allowed = true;
    listeners.get("visitorConsentCollected")();
    while (fetchCount < 2)
      await new Promise((resolve) => globalThis.setImmediate(resolve));
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.equal(panel.dataset.adaptiveReason, "NEW_GENERATION");
    resolveFirst(response("OLD_GENERATION"));
    await first;
    assert.equal(panel.dataset.adaptiveReason, "NEW_GENERATION");
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

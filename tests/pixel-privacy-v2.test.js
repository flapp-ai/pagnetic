import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

const script = transformSync(readFileSync("extensions/adaptive-measurement/src/index.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
function fixture({ allowed = true, fetcher, beforeStore, beforeRemove } = {}) {
  const handlers = new Map();
  const stored = new Map();
  const sent = [];
  let privacyHandler;
  let writes = 0;
  const consent = (granted) => ({ analyticsProcessingAllowed: granted, preferencesProcessingAllowed: granted });
  const api = {
    analytics: { subscribe(name, callback) { handlers.set(name, callback); } },
    browser: { localStorage: {
      async getItem(key) { return stored.get(key) ?? null; },
      async setItem(key, value) { if (beforeStore) await beforeStore(); writes++; stored.set(key, value); },
      async removeItem(key) { if (beforeRemove) await beforeRemove(); stored.delete(key); },
    } },
    customerPrivacy: { subscribe(_name, callback) { privacyHandler = callback; } },
    init: { customerPrivacy: consent(allowed) },
    settings: { endpoint: "https://fixture.invalid/events", shop: "fixture.myshopify.com", token: "synthetic-pixel-token" },
  };
  new vm.Script(script).runInNewContext({
    require: () => ({ register: (callback) => callback(api) }),
    exports: {}, module: { exports: {} }, setTimeout, clearTimeout, AbortController,
    fetch: async (_url, args) => {
      sent.push(JSON.parse(args.body));
      return fetcher ? fetcher(args) : { ok: true, status: 200 };
    },
  });
  return { stored, sent, writes: () => writes,
    consent(granted) { privacyHandler({ customerPrivacy: consent(granted) }); },
    emit(name, values = {}) { return handlers.get(name)({ id: `event-${name}`, name, timestamp: new Date().toISOString(), ...values }); },
  };
}
async function eventually(predicate, message) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function detail() {
  return { schemaVersion: 2, decisionId: "decision", experimentId: "experiment", sessionId: "session",
    productId: "gid://shopify/Product/2", expiresAt: new Date(Date.now() + 86400000).toISOString() };
}

test("denied consent writes no pixel identity and sends no decision or checkout", async () => {
  const f = fixture({ allowed: false });
  await f.emit("adaptive_storefront_decision", { customData: detail() });
  await f.emit("checkout_completed");
  assert.equal(f.writes(), 0);
  assert.equal(f.sent.length, 0);
});

test("consented held Original diagnostic is forwarded without creating reusable attribution authority", async () => {
  const f = fixture();
  await f.emit("adaptive_storefront_decision", {
    id: "legacy-other-product",
    customData: {
      ...detail(),
      schemaVersion: 1,
      productId: "gid://shopify/Product/1",
    },
  });
  assert.equal(f.stored.size, 1);
  await f.emit("product_viewed", {
    id: "new-product-before-hold",
    data: { productVariant: { product: { id: "2" } } },
  });
  assert.equal(
    f.sent[1].decisionId,
    null,
    "a persisted v1 decision cannot cross product scope after v2 enablement",
  );
  await f.emit("adaptive_storefront_decision", {
    id: "held-original",
    customData: {
      schemaVersion: 2,
      decisionId: null,
      experimentId: null,
      visitorId: null,
      sessionId: "held-session",
      productId: "gid://shopify/Product/2",
      arm: "ORIGINAL",
      assignmentArm: null,
      reason: "KILL_SWITCH_ACTIVE",
      persistence: "visitor",
    },
  });
  assert.equal(f.writes(), 1);
  assert.equal(f.stored.size, 0);
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent[2].schemaVersion, 2);
  assert.equal(f.sent[2].decisionId, null);
  assert.equal(f.sent[2].experimentId, null);
  assert.equal(f.sent[2].visitorId, null);
  assert.equal(f.sent[2].sessionId, "held-session");
  assert.equal(f.sent[2].productId, "gid://shopify/Product/2");
  assert.equal(f.sent[2].data.arm, "ORIGINAL");
  assert.equal(f.sent[2].data.assignmentArm, null);
  assert.equal(f.sent[2].data.reason, "KILL_SWITCH_ACTIVE");

  await f.emit("checkout_completed", {
    id: "checkout-after-held-original",
    data: {
      checkout: {
        token: "held-checkout",
        order: { id: "123" },
        lineItems: [{ variant: { product: { id: "2" } } }],
      },
    },
  });
  assert.equal(f.sent[3].decisionId, null);
  assert.equal(f.sent[3].experimentId, null);
  assert.equal(f.sent[3].visitorId, null);
  assert.equal(f.sent[3].sessionId, null);

  await f.emit("adaptive_storefront_decision", {
    id: "unassigned-non-hold",
    customData: {
      schemaVersion: 2,
      sessionId: "held-session",
      productId: "gid://shopify/Product/2",
      arm: "ORIGINAL",
      reason: "V2_DISABLED",
    },
  });
  assert.equal(f.sent.length, 4, "only the exact held-original diagnostic may be unassigned");
});

test("multi-product checkout uses the eligible product even when it is not the first line", async () => {
  const f = fixture();
  await f.emit("adaptive_storefront_decision", { customData: detail() });
  await f.emit("checkout_completed", { data: { checkout: { token: "checkout", order: { id: "123" },
    lineItems: [{ variant: { product: { id: "1" } } }, { variant: { product: { id: "2" } } }] } } });
  assert.equal(f.sent[1].schemaVersion, 2);
  assert.equal(f.sent[1].decisionId, "decision");
  assert.equal(f.sent[1].productId, "gid://shopify/Product/2");
  await f.emit("product_added_to_cart", { data: { cartLine: { merchandise: { product: { id: "1" } } } } });
  assert.equal(f.sent[2].decisionId, null);
});

test("revocation during an asynchronous storage write removes it and prevents old-context delivery", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let reached;
  const entered = new Promise((resolve) => { reached = resolve; });
  const f = fixture({ beforeStore: async () => { reached(); await pending; } });
  const event = f.emit("adaptive_storefront_decision", { customData: detail() });
  await entered;
  f.consent(false);
  release();
  await event;
  await f.emit("checkout_completed");
  assert.equal(f.stored.size, 0);
  assert.equal(f.sent.length, 0);
});

test("a late pre-revoke storage write cannot overwrite or delete the fresh epoch decision", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let reached;
  const entered = new Promise((resolve) => { reached = resolve; });
  let first = true;
  const f = fixture({ beforeStore: async () => {
    if (!first) return;
    first = false;
    reached();
    await pending;
  } });
  const oldEvent = f.emit("adaptive_storefront_decision", {
    id: "old-decision-event",
    customData: { ...detail(), decisionId: "old-decision" },
  });
  await entered;
  f.consent(false);
  f.consent(true);
  const freshEvent = f.emit("adaptive_storefront_decision", {
    id: "fresh-decision-event",
    customData: { ...detail(), decisionId: "fresh-decision" },
  });
  release();
  await Promise.all([oldEvent, freshEvent]);
  assert.equal(JSON.parse(f.stored.values().next().value).decisionId, "fresh-decision");
  assert.deepEqual(f.sent.map((item) => item.eventId), ["fresh-decision-event"]);
});

test("a deferred revoke clear remains serialized and cannot later erase a fresh decision", async () => {
  let releaseRemove;
  const pendingRemove = new Promise((resolve) => { releaseRemove = resolve; });
  let removeReached;
  const removeEntered = new Promise((resolve) => { removeReached = resolve; });
  let firstRemove = true;
  const f = fixture({ beforeRemove: async () => {
    if (!firstRemove) return;
    firstRemove = false;
    removeReached();
    await pendingRemove;
  } });
  await f.emit("adaptive_storefront_decision", {
    id: "stored-old-decision",
    customData: { ...detail(), decisionId: "stored-old" },
  });
  assert.equal(f.writes(), 1);
  f.consent(false);
  await removeEntered;
  f.consent(true);
  const fresh = f.emit("adaptive_storefront_decision", {
    id: "fresh-while-clear-pending",
    customData: { ...detail(), decisionId: "fresh-after-clear" },
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(f.writes(), 1, "fresh storage mutation must wait for the outstanding clear");
  releaseRemove();
  await fresh;
  await eventually(() => f.writes() === 2, "fresh decision was not persisted after clear settled");
  assert.equal(JSON.parse(f.stored.values().next().value).decisionId, "fresh-after-clear");
  assert.deepEqual(f.sent.map((item) => item.eventId), [
    "stored-old-decision",
    "fresh-while-clear-pending",
  ]);
});

test("stale-write cleanup cannot time out and release a still-mutating storage pump", async () => {
  let releaseStore;
  const pendingStore = new Promise((resolve) => { releaseStore = resolve; });
  let storeReached;
  const storeEntered = new Promise((resolve) => { storeReached = resolve; });
  let releaseRemove;
  const pendingRemove = new Promise((resolve) => { releaseRemove = resolve; });
  let removeReached;
  const removeEntered = new Promise((resolve) => { removeReached = resolve; });
  let firstStore = true;
  let firstRemove = true;
  const f = fixture({
    beforeStore: async () => {
      if (!firstStore) return;
      firstStore = false;
      storeReached();
      await pendingStore;
    },
    beforeRemove: async () => {
      if (!firstRemove) return;
      firstRemove = false;
      removeReached();
      await pendingRemove;
    },
  });
  const stale = f.emit("adaptive_storefront_decision", {
    id: "stale-storage-write",
    customData: { ...detail(), decisionId: "stale-write" },
  });
  await storeEntered;
  f.consent(false);
  releaseStore();
  await removeEntered;
  f.consent(true);
  const fresh = f.emit("adaptive_storefront_decision", {
    id: "fresh-behind-cleanup",
    customData: { ...detail(), decisionId: "fresh-behind-cleanup" },
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(f.writes(), 1, "cleanup must retain serialization beyond the old 250ms deadline");
  releaseRemove();
  await Promise.all([stale, fresh]);
  await eventually(() => f.writes() === 2, "fresh decision was not persisted after cleanup settled");
  assert.equal(JSON.parse(f.stored.values().next().value).decisionId, "fresh-behind-cleanup");
  assert.deepEqual(f.sent.map((item) => item.eventId), ["fresh-behind-cleanup"]);
});

test("revocation stops retries and a fresh grant cannot revive queued old context", async () => {
  let f;
  f = fixture({ fetcher: () => { f.consent(false); f.consent(true); return { ok: false, status: 500 }; } });
  await f.emit("adaptive_storefront_decision", { customData: detail() });
  assert.equal(f.sent.length, 1);
  assert.equal(f.stored.size, 0);
});

test("a hung delivery attempt is aborted at its deadline and ordered retry recovers", async () => {
  let attempts = 0;
  let aborted = 0;
  const f = fixture({
    fetcher: (args) => {
      attempts += 1;
      if (attempts > 1) return { ok: true, status: 200 };
      return new Promise((_resolve, reject) => {
        args.signal.addEventListener("abort", () => {
          aborted += 1;
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });
  const started = Date.now();
  await f.emit("page_viewed", { id: "hung-then-recovered" });
  assert.ok(Date.now() - started < 2_500, "a hung fetch must not hold the queue indefinitely");
  assert.equal(aborted, 1);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent.map((item) => item.eventId), [
    "hung-then-recovered",
    "hung-then-recovered",
  ]);
});

test("transient retries finish before the next accepted event", async () => {
  const statuses = [500, 500, 200, 200];
  const f = fixture({
    fetcher: () => {
      const status = statuses.shift() ?? 200;
      return { ok: status === 200, status };
    },
  });
  const first = f.emit("page_viewed", { id: "ordered-first" });
  const second = f.emit("product_viewed", { id: "ordered-second" });
  await Promise.all([first, second]);
  assert.deepEqual(f.sent.map((item) => item.eventId), [
    "ordered-first",
    "ordered-first",
    "ordered-first",
    "ordered-second",
  ]);
});

test("revocation aborts the active request, drops its queued epoch, and only a fresh event sends", async () => {
  let releaseStarted;
  const started = new Promise((resolve) => { releaseStarted = resolve; });
  let active = true;
  const f = fixture({
    fetcher: (args) => {
      if (!active) return { ok: true, status: 200 };
      releaseStarted();
      return new Promise((_resolve, reject) => {
        args.signal.addEventListener("abort", () => reject(new Error("revoked")), { once: true });
      });
    },
  });
  const first = f.emit("page_viewed", { id: "old-active" });
  const second = f.emit("product_viewed", { id: "old-queued" });
  await started;
  f.consent(false);
  f.consent(true);
  active = false;
  await Promise.all([first, second]);
  assert.deepEqual(f.sent.map((item) => item.eventId), ["old-active"]);
  await f.emit("page_viewed", { id: "new-epoch" });
  assert.deepEqual(f.sent.map((item) => item.eventId), ["old-active", "new-epoch"]);
});

test("a sustained burst retains only the finite ordered delivery prefix", async () => {
  let release;
  const firstResponse = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const f = fixture({
    fetcher: () => {
      calls += 1;
      return calls === 1 ? firstResponse : { ok: true, status: 200 };
    },
  });
  const pending = Array.from({ length: 200 }, (_value, index) =>
    f.emit("page_viewed", { id: `burst-${String(index).padStart(3, "0")}` }),
  );
  release({ ok: true, status: 200 });
  await Promise.all(pending);
  assert.equal(f.sent.length, 64);
  assert.deepEqual(
    f.sent.map((item) => item.eventId),
    Array.from({ length: 64 }, (_value, index) => `burst-${String(index).padStart(3, "0")}`),
  );
});

test("a hung storage write retains only a finite newest queue and cannot block delivery", async () => {
  let release;
  const firstWrite = new Promise((resolve) => { release = resolve; });
  let entered;
  const firstEntered = new Promise((resolve) => { entered = resolve; });
  let first = true;
  const f = fixture({
    beforeStore: async () => {
      if (!first) return;
      first = false;
      entered();
      await firstWrite;
    },
  });
  const pending = Array.from({ length: 100 }, (_value, index) =>
    f.emit("adaptive_storefront_decision", {
      id: `decision-${String(index).padStart(3, "0")}`,
      customData: { ...detail(), decisionId: `decision-${index}` },
    }),
  );
  await firstEntered;
  release();
  await Promise.all(pending);
  assert.equal(f.writes(), 17, "one active plus sixteen queued writes are retained");
  assert.ok(
    f.sent.length >= 64 && f.sent.length <= 100,
    "delivery remains independently capped and continues as accepted work drains",
  );
  assert.equal(f.sent[0].eventId, "decision-000");
  assert.equal(new Set(f.sent.map((item) => item.eventId)).size, f.sent.length);
});

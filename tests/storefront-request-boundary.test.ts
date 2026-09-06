import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";

// Bundle the actual routes + bounded reader; only external auth/database and
// business services are fixtures. No production env, DB or Shopify session.
async function route(name: "events" | "experience.v2.decision") {
  const stubs: Record<string, string> = {
    "../db.server": "export default {};",
    "../shopify.server": "export const authenticate={public:{appProxy:async()=>({session:{shop:'fixture.myshopify.com'}})}};",
    "../services/measurement.server": "const allowed=new Set(['adaptive_storefront_decision']); export const pixelEventTypeForTelemetry=value=>allowed.has(value)?value:'unknown'; export const ingestPixelEvent=async({payload})=>payload?.reject?({accepted:false,reason:payload?.reason||'unsupported_event'}):({accepted:true});",
    "../services/rate-limit.server": "export const consumeRateLimit=()=>({allowed:true}); export const requestAddress=()=> 'fixture';",
    "../services/job-outbox.server": "export class QueueIdempotencyConflictError extends Error {}",
    "../services/v2-decision.server": "export const originalDecisionV2=reason=>({schemaVersion:2,serving:'ORIGINAL',reason}); export const parseDecisionRequestV2=x=>x; export const resolveV2Decision=async()=>originalDecisionV2('FIXTURE'); export class V2DecisionRequestError extends Error {}",
  };
  const bundle = await build({ entryPoints: [resolve(`app/routes/storefront.${name}.ts`)],
    bundle: true, write: false, format: "esm", platform: "node", plugins: [{ name: "isolated-route-dependencies", setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: stubs[args.path]!, loader: "js" }));
    } }] });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`) as Promise<{
    action(args: { request: Request }): Promise<Response>;
  }>;
}

for (const [name, limit] of [["events", 32_768], ["experience.v2.decision", 8_192]] as const) {
  test(`${name} route rejects streamed overflow and invalid encoding with no-store safe responses`, async () => {
    const { action } = await route(name);
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(limit+1)); }, cancel() { canceled = true; } });
    const response = await action({ request: new Request("https://fixture.invalid/", {
      method: "POST", body, duplex: "half", headers: { "content-length": "1" },
    } as RequestInit) });
    assert.equal(response.status, 413);
    assert.equal(canceled, true);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const json = await response.json();
    if (name === "events") {
      assert.equal(json.accepted, false);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
    } else assert.equal(json.serving, "ORIGINAL");
    const invalid = await action({ request: new Request("https://fixture.invalid/", { method: "POST", body: new Uint8Array([0xff]) }) });
    assert.equal(invalid.status, 400);
    const wrongMethod = await action({ request: new Request("https://fixture.invalid/", { method: "PUT", body: "{}" }) });
    assert.equal(wrongMethod.status, 405);
    const valid = await action({ request: new Request("https://fixture.invalid/", { method: "POST", body: "{}" }) });
    assert.equal(valid.status, name === "events" ? 202 : 200);
  });
}

test("events route logs only allowlisted rejection classification without payload identity", async () => {
  const { action } = await route("events");
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => {
    warnings.push(values);
  };
  try {
    const response = await action({
      request: new Request("https://fixture.invalid/", {
        method: "POST",
        body: JSON.stringify({
          reject: true,
          reason: "decision_scope_or_window_invalid",
          eventType: "adaptive_storefront_decision",
          eventId: "must-not-log",
          token: "must-not-log",
        }),
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(warnings, [[
      "storefront_event_rejected",
      {
        reason: "decision_scope_or_window_invalid",
        eventType: "adaptive_storefront_decision",
      },
    ]]);

    await action({
      request: new Request("https://fixture.invalid/", {
        method: "POST",
        body: JSON.stringify({
          reject: true,
          reason: "secret-provider-error",
          eventType: "shopper@example.com",
          customer: "must-not-log",
        }),
      }),
    });
    assert.deepEqual(warnings[1], [
      "storefront_event_rejected",
      { reason: "unclassified_rejection", eventType: "unknown" },
    ]);
    assert.doesNotMatch(JSON.stringify(warnings), /must-not-log|shopper@example|secret-provider/);
  } finally {
    console.warn = originalWarn;
  }
});

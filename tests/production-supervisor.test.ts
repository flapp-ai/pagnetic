import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { ManagedProcessError, requestLocalMaintenance, requestLocalMaintenanceCycle, runManagedProcess, runPeriodicTask, waitForLocalHealth } from "../scripts/lib/production-supervisor";

test("managed real processes propagate success, failure and bounded timeout", async () => {
  const signal = new AbortController().signal;
  await runManagedProcess(process.execPath, ["-e", "process.exit(0)"], { signal, label: "fixture", timeoutMs: 2_000 });
  await assert.rejects(runManagedProcess(process.execPath, ["-e", "process.exit(7)"], { signal, label: "fixture", timeoutMs: 2_000 }), /NONZERO_EXIT/);
  let pid = 0;
  await assert.rejects(runManagedProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
    signal, label: "fixture", timeoutMs: 150, killGraceMs: 30, onSpawn: (value) => { pid = value; },
  }), /TIMEOUT/);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("shutdown interrupts a running child and a pre-aborted signal never starts it", async () => {
  const control = new AbortController();
  let pid = 0;
  const pending = runManagedProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    signal: control.signal, label: "fixture", onSpawn: (value) => { pid = value; }, killGraceMs: 30,
  });
  control.abort();
  await assert.rejects(pending, /ABORTED/);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  await assert.rejects(runManagedProcess("this-command-must-not-run", [], { signal: control.signal, label: "fixture" }), /ABORTED/);
});

test("managed group timeout also terminates its HTTP-serving grandchild", async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const grandchild = `require('node:http').createServer((q,s)=>s.end('fixture')).listen(${port},'127.0.0.1');`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const control = new AbortController();
  const run = runManagedProcess(process.execPath, ["-e", parent], { label: "fixture-group", signal: control.signal,
    timeoutMs: 3_000, killGraceMs: 30 });
  const exited = run.then(() => null, (error: unknown) => error);
  try {
    await waitForLocalHealth({ port, signal: control.signal, timeoutMs: 2_000, retryMs: 10 });
    assert.match(String(await exited), /TIMEOUT/);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) }));
  } finally { control.abort(); await exited; }
});

test("periodic failure retries sequentially and shutdown interrupts the sleep", async () => {
  const control = new AbortController();
  let calls = 0;
  let failures = 0;
  let active = 0;
  let maxActive = 0;
  await runPeriodicTask({ signal: control.signal, intervalMs: 2, onFailure: () => { failures += 1; },
    run: async () => { active += 1; maxActive = Math.max(maxActive, active); calls += 1; active -= 1;
      if (calls < 3) throw new Error("synthetic failure"); control.abort(); },
  });
  assert.equal(calls, 3);
  assert.equal(failures, 2);
  assert.equal(maxActive, 1);
});

test("local maintenance treats partial success as failure and startup health has a deadline", async () => {
  const signal = new AbortController().signal;
  const captured: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), init }); return new Response("{}", { status: 207 });
  };
  await assert.rejects(requestLocalMaintenance({ port: 3456, secret: "synthetic", signal, fetcher }), /HTTP_FAILURE/);
  assert.equal(captured[0]!.url, "http://127.0.0.1:3456/internal/automation");
  assert.equal(captured[0]!.init!.redirect, "error");
  await assert.rejects(waitForLocalHealth({ port: 3456, signal, timeoutMs: 20, retryMs: 2,
    fetcher: async () => new Response("", { status: 503 }) }), /STARTUP_TIMEOUT/);
});

test("actual stalled local HTTP connection is aborted within the maintenance deadline", async () => {
  const server = createServer(() => { /* Deliberately never answer. */ });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(requestLocalMaintenance({ port: address.port, secret: "synthetic",
      signal: new AbortController().signal, timeoutMs: 30 }), (error) => error instanceof Error && !(error instanceof ManagedProcessError));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("privacy scheduling uses its independent authenticated endpoint with no redirects", async () => {
  let called = false;
  await requestLocalMaintenance({ port: 3456, secret: "fixture", signal: new AbortController().signal,
    path: "/internal/privacy", fetcher: async (url, init) => {
      called = true;
      assert.equal(url, "http://127.0.0.1:3456/internal/privacy");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer fixture");
      assert.equal(init?.redirect, "error");
      return new Response("{}", { status: 200 });
    } });
  assert.equal(called, true);
});

test("maintenance cycle completes automation before privacy over actual HTTP", async () => {
  const events: string[] = [];
  let releaseAutomation!: () => void;
  let observedAutomation!: () => void;
  const entered = new Promise<void>((resolve) => { observedAutomation = resolve; });
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer fixture");
    events.push(request.url!);
    if (request.url === "/internal/automation") {
      releaseAutomation = () => { events.push("automation-complete"); response.end("{}"); };
      observedAutomation();
    } else response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const control = new AbortController();
  let pending: Promise<void> | undefined;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    pending = requestLocalMaintenanceCycle({ port: address.port, secret: "fixture", signal: control.signal });
    await entered;
    assert.deepEqual(events, ["/internal/automation"]);
    releaseAutomation();
    await pending;
    assert.deepEqual(events, ["/internal/automation", "automation-complete", "/internal/privacy"]);
  } finally {
    control.abort();
    await pending?.catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("completed automation failure still runs privacy and never becomes a successful cycle", async () => {
  const paths: string[] = [];
  await assert.rejects(requestLocalMaintenanceCycle({ port: 3456, secret: "fixture",
    signal: new AbortController().signal, fetcher: async (url) => {
      paths.push(new URL(String(url)).pathname);
      return new Response("{}", { status: paths.length === 1 ? 207 : 200 });
    } }), /HTTP_FAILURE/);
  assert.deepEqual(paths, ["/internal/automation", "/internal/privacy"]);
});

test("ambiguous network failure or shutdown never starts a second maintenance request", async () => {
  let calls = 0;
  const control = new AbortController();
  const fetcher: typeof fetch = async () => { calls += 1; throw new TypeError("network fixture"); };
  await assert.rejects(requestLocalMaintenanceCycle({ port: 3456, secret: "fixture", signal: control.signal, fetcher }), TypeError);
  assert.equal(calls, 1);
  control.abort();
  await assert.rejects(requestLocalMaintenanceCycle({ port: 3456, secret: "fixture", signal: control.signal, fetcher }), /ABORTED/);
  assert.equal(calls, 1);
});

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export class ManagedProcessError extends Error {
  constructor(public label: string, public reason: string) { super(`${label}:${reason}`); }
}

/** Own a dedicated POSIX child process group, including its grandchildren. */
export function runManagedProcess(command: string, args: string[], options: {
  label: string; signal: AbortSignal; timeoutMs?: number; killGraceMs?: number;
  onSpawn?: (pid: number) => void;
}) {
  if (options.signal.aborted) return Promise.reject(new ManagedProcessError(options.label, "ABORTED"));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "inherit" });
    let reason: string | undefined;
    let forced: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { /* Group already exited. */ }
    };
    const terminate = (cause: string) => {
      if (finished || reason) return;
      reason = cause;
      kill("SIGTERM");
      forced = setTimeout(() => kill("SIGKILL"), options.killGraceMs ?? 5_000);
    };
    const aborted = () => terminate("ABORTED");
    const complete = (failure?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(forced);
      options.signal.removeEventListener("abort", aborted);
      kill("SIGKILL");
      const error = reason ?? failure;
      if (error) reject(new ManagedProcessError(options.label, error));
      else resolve();
    };
    child.once("error", () => complete("SPAWN_FAILED"));
    child.once("exit", (code, signal) => complete(code === 0 ? undefined : signal ? "SIGNAL_EXIT" : "NONZERO_EXIT"));
    options.signal.addEventListener("abort", aborted, { once: true });
    if (options.timeoutMs != null) deadline = setTimeout(() => terminate("TIMEOUT"), options.timeoutMs);
    if (options.signal.aborted) aborted();
    if (child.pid) options.onSpawn?.(child.pid);
  });
}

export async function runPeriodicTask(options: {
  signal: AbortSignal; intervalMs: number; run: () => Promise<void>; onFailure: (error: unknown) => void;
}) {
  while (!options.signal.aborted) {
    try { await options.run(); }
    catch (error) { if (!options.signal.aborted) options.onFailure(error); }
    if (options.signal.aborted) return;
    try { await sleep(options.intervalMs, undefined, { signal: options.signal }); }
    catch (error) { if (!options.signal.aborted) throw error; }
  }
}

export async function requestLocalMaintenance(options: {
  port: number; secret: string; signal: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch;
  path?: "/internal/automation" | "/internal/privacy";
}) {
  const path = options.path ?? "/internal/automation";
  if (path !== "/internal/automation" && path !== "/internal/privacy")
    throw new ManagedProcessError("maintenance", "INVALID_PATH");
  const response = await (options.fetcher ?? fetch)(`http://127.0.0.1:${options.port}${path}`, {
    method: "POST", redirect: "error", headers: { Authorization: `Bearer ${options.secret}` },
    signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 90_000)]),
  });
  void response.body?.cancel().catch(() => undefined);
  // The internal route deliberately uses 207 for partial merchant failures.
  if (response.status !== 200) throw new ManagedProcessError("maintenance", "HTTP_FAILURE");
}

/** One supervised SQLite writer: never overlap automation and privacy ticks.
 * A completed HTTP failure must not starve privacy; an ambiguous network failure
 * stops the cycle because the server may still be executing the first request.
 */
export async function requestLocalMaintenanceCycle(options: {
  port: number; secret: string; signal: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch;
}) {
  let failed = false;
  for (const path of ["/internal/automation", "/internal/privacy"] as const) {
    if (options.signal.aborted) throw new ManagedProcessError("maintenance", "ABORTED");
    try { await requestLocalMaintenance({ ...options, path }); }
    catch (error) {
      if (!(error instanceof ManagedProcessError) || error.reason !== "HTTP_FAILURE") throw error;
      failed = true;
    }
  }
  if (failed) throw new ManagedProcessError("maintenance", "HTTP_FAILURE");
}

export async function waitForLocalHealth(options: {
  port: number; signal: AbortSignal; timeoutMs?: number; retryMs?: number; fetcher?: typeof fetch;
}) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = AbortSignal.any([options.signal, deadline]);
  while (!signal.aborted) {
    try {
      const response = await (options.fetcher ?? fetch)(`http://127.0.0.1:${options.port}/healthz`, {
        redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      });
      void response.body?.cancel().catch(() => undefined);
      if (response.ok) return;
    } catch { /* Retry only within the bounded startup deadline. */ }
    if (!signal.aborted) {
      try { await sleep(options.retryMs ?? 1_000, undefined, { signal }); }
      catch { /* Deadline or shutdown. */ }
    }
  }
  throw new ManagedProcessError("health", options.signal.aborted ? "ABORTED" : "STARTUP_TIMEOUT");
}

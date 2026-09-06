import { fileURLToPath } from "node:url";
import { ManagedProcessError, requestLocalMaintenanceCycle, runManagedProcess, runPeriodicTask, waitForLocalHealth } from "./lib/production-supervisor";

const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const port = Number(process.env.PORT ?? "3000");
const secret = process.env.AUTOMATION_SECRET;
const children: Promise<void>[] = [];
try {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !secret || secret.length < 32)
    throw new Error("Production supervision requires valid port and automation authority");
  await runManagedProcess("pnpm", ["prisma", "migrate", "deploy"], {
    label: "migration", signal: shutdown.signal, timeoutMs: 600_000,
  });
  const app = runManagedProcess("pnpm", ["start"], { label: "application", signal: shutdown.signal });
  children.push(app);
  const appExit = app.then(() => { throw new Error("Application exited unexpectedly"); });
  await Promise.race([appExit, waitForLocalHealth({ port, signal: shutdown.signal })]);
  const maintenance = runPeriodicTask({ signal: shutdown.signal, intervalMs: 300_000,
    run: () => requestLocalMaintenanceCycle({ port, secret, signal: shutdown.signal }),
    onFailure: (error) => {
      console.error("Scheduled maintenance failed; inspect operator alerts and supervisor health.");
      // Aborting the caller does not cancel a server-side GraphQL operation.
      // Restart our own application group after an ambiguous network/timeout
      // failure, rather than accumulate potentially still-running requests.
      if (!(error instanceof ManagedProcessError)) {
        process.exitCode = 1;
        shutdown.abort();
      }
    },
  });
  const backups = runPeriodicTask({ signal: shutdown.signal, intervalMs: 21_600_000,
    run: () => runManagedProcess(process.execPath, ["--import", "tsx", fileURLToPath(new URL("backup-sqlite.ts", import.meta.url))], {
      label: "backup", signal: shutdown.signal, timeoutMs: 900_000,
    }),
    onFailure: () => console.error("Scheduled encrypted backup failed or timed out; readiness evidence remains stale."),
  });
  children.push(maintenance, backups);
  await Promise.race([appExit, maintenance, backups]);
} catch {
  if (!shutdown.signal.aborted) {
    console.error("Production supervisor failed; shutting down child processes for platform restart.");
    process.exitCode = 1;
  }
} finally {
  shutdown.abort();
  await Promise.allSettled(children);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}

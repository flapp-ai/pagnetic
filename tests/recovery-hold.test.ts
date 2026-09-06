import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);

test("direct production startup refuses a restored SQLite database with recovery hold", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pagnetic-recovery-startup-"));
  const database = join(directory, "held.sqlite");
  try {
    await run("sqlite3", [database, "CREATE TABLE _PagneticRecoveryHold(id INTEGER PRIMARY KEY CHECK(id=1), reason TEXT NOT NULL); INSERT INTO _PagneticRecoveryHold VALUES(1, 'receipt replay');"]);
    await assert.rejects(run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import('./app/db.server.ts')"], {
      cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", DATABASE_URL: `file:${database}` },
    }), /RECOVERY_PRIVACY_REPLAY_REQUIRED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

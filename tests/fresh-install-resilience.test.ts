import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { ensurePilotRole } from "../app/services/access.server";
import { ensureMerchant } from "../app/services/governance.server";

function database() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-fresh-install-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((entry) => /^\d/.test(entry)).sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(path.join("prisma/migrations", migration, "migration.sql")),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("concurrent first embedded loads create one merchant owner without a 500", async () => {
  const fixture = database();
  try {
    const shop = "fresh-install.myshopify.com";
    const actor = `${shop}:user:123`;
    const results = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const merchant = await ensureMerchant(fixture.db, shop);
        return ensurePilotRole({ db: fixture.db, merchantId: merchant.id, actor });
      }),
    );
    assert.equal(await fixture.db.merchant.count({ where: { shop } }), 1);
    assert.equal(await fixture.db.pilotRole.count({ where: { actorKey: actor } }), 1);
    assert.ok(results.every((role) => role?.role === "OWNER"));
  } finally {
    await fixture.close();
  }
});

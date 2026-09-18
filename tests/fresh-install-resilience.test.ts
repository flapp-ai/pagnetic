import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { ensurePilotRole } from "../app/services/access.server";
import { ensureMerchant } from "../app/services/governance.server";

function database(connectionLimit = 1) {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-fresh-install-"));
  const databasePath = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((entry) => /^\d/.test(entry))
    .sort()) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(
        path.join("prisma/migrations", migration, "migration.sql"),
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const db = new PrismaClient({
    datasourceUrl: `file:${databasePath}?connection_limit=${connectionLimit}`,
  });
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
        return ensurePilotRole({
          db: fixture.db,
          merchantId: merchant.id,
          actor,
        });
      }),
    );
    assert.equal(await fixture.db.merchant.count({ where: { shop } }), 1);
    assert.equal(
      await fixture.db.pilotRole.count({ where: { actorKey: actor } }),
      1,
    );
    assert.ok(results.every((role) => role?.role === "OWNER"));
  } finally {
    await fixture.close();
  }
});

for (const connectionLimit of [1, 4]) {
  test(`same actor concurrent bootstrap preserves one role (pool ${connectionLimit})`, async () => {
    const fixture = database(connectionLimit);
    try {
      const merchant = await fixture.db.merchant.create({
        data: { shop: `same-${connectionLimit}.myshopify.com` },
      });
      const roles = await Promise.all(
        Array.from({ length: 4 }, () =>
          ensurePilotRole({
            db: fixture.db,
            merchantId: merchant.id,
            actor: "same-actor",
          }),
        ),
      );
      assert.ok(
        roles.every(
          (role) => role?.role === "OWNER" && role.id === roles[0]?.id,
        ),
      );
      assert.equal(
        await fixture.db.pilotRole.count({
          where: { merchantId: merchant.id },
        }),
        1,
      );
    } finally {
      await fixture.close();
    }
  });
  test(`distinct bootstrap actors serialize to one OWNER (pool ${connectionLimit})`, async () => {
    const fixture = database(connectionLimit);
    try {
      const merchant = await fixture.db.merchant.create({
        data: { shop: `distinct-${connectionLimit}.myshopify.com` },
      });
      const before = merchant.updatedAt;
      const roles = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          ensurePilotRole({
            db: fixture.db,
            merchantId: merchant.id,
            actor: `actor-${index}`,
          }),
        ),
      );
      assert.equal(roles.filter((role) => role?.role === "OWNER").length, 1);
      assert.equal(roles.filter((role) => role === null).length, 3);
      assert.equal(
        await fixture.db.pilotRole.count({
          where: { merchantId: merchant.id, role: "OWNER" },
        }),
        1,
      );
      assert.deepEqual(
        (
          await fixture.db.merchant.findUniqueOrThrow({
            where: { id: merchant.id },
          })
        ).updatedAt,
        before,
      );
    } finally {
      await fixture.close();
    }
  });
}

test("bootstrap preserves existing OPERATOR and inactive OWNER without privilege changes", async () => {
  const fixture = database();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "preserved-role.myshopify.com" },
    });
    const operator = await fixture.db.pilotRole.create({
      data: {
        merchantId: merchant.id,
        actorKey: "operator",
        role: "OPERATOR",
        grantedBy: "approved-owner",
      },
    });
    const inactive = await fixture.db.pilotRole.create({
      data: {
        merchantId: merchant.id,
        actorKey: "inactive",
        role: "OWNER",
        active: false,
        grantedBy: "approved-owner",
      },
    });
    assert.deepEqual(
      await ensurePilotRole({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "operator",
      }),
      operator,
    );
    assert.deepEqual(
      await ensurePilotRole({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "inactive",
      }),
      inactive,
    );
    assert.equal(
      await ensurePilotRole({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "new-actor",
      }),
      null,
    );
    assert.equal(
      await fixture.db.pilotRole.count({ where: { merchantId: merchant.id } }),
      2,
    );
  } finally {
    await fixture.close();
  }
});

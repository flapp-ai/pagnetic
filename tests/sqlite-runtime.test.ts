import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  ensureMerchant,
  DEFAULT_ANGLES,
} from "../app/services/governance.server";
import {
  initializeSqlite,
  sqliteRuntimeUrl,
} from "../app/services/sqlite-runtime.server";

async function fixture(urlOptions = "") {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pagnetic-sqlite-runtime-"),
  );
  const database = path.join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations")
    .filter((name) => /^\d/.test(name))
    .sort()) {
    execFileSync("sqlite3", [database], {
      input: readFileSync(
        path.join("prisma/migrations", migration, "migration.sql"),
      ),
      stdio: ["pipe", "ignore", "pipe"],
    });
  }
  const url = `file:${database}`;
  const db = new PrismaClient({
    datasourceUrl: urlOptions ? `${url}?${urlOptions}` : sqliteRuntimeUrl(url),
  });
  await initializeSqlite(db);
  return {
    db,
    url,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("SQLite runtime pins connection-local initialization without changing file or non-SQLite URLs", () => {
  assert.equal(sqliteRuntimeUrl(undefined), undefined);
  assert.equal(
    sqliteRuntimeUrl("postgresql://example"),
    "postgresql://example",
  );
  assert.equal(
    sqliteRuntimeUrl("file:/data/pilot.sqlite?connection_limit=9&mode=rwc"),
    "file:/data/pilot.sqlite?connection_limit=1&mode=rwc&socket_timeout=2&pool_timeout=5",
  );
});

test("steady-state merchant access is read-only; missing and changed seeds repair without resetting entitlement", async () => {
  const f = await fixture();
  try {
    const merchant = await ensureMerchant(f.db, "runtime.myshopify.com");
    await f.db.betaEntitlement.update({
      where: { merchantId: merchant.id },
      data: { status: "CONTINUATION_OFFER" },
    });
    const before = await f.db.acquisitionAngle.findMany({
      where: { merchantId: merchant.id },
    });
    // A query-only connection proves this is no longer merely an empty upsert.
    await f.db.$queryRawUnsafe("PRAGMA query_only=ON");
    assert.equal((await ensureMerchant(f.db, merchant.shop)).id, merchant.id);
    await f.db.$queryRawUnsafe("PRAGMA query_only=OFF");
    assert.deepEqual(
      await f.db.acquisitionAngle.findMany({
        where: { merchantId: merchant.id },
      }),
      before,
    );
    await f.db.acquisitionAngle.delete({
      where: { merchantId_key: { merchantId: merchant.id, key: "comfort" } },
    });
    await f.db.acquisitionAngle.update({
      where: { merchantId_key: { merchantId: merchant.id, key: "value" } },
      data: { active: false, label: "old" },
    });
    await ensureMerchant(f.db, merchant.shop);
    assert.equal(
      await f.db.acquisitionAngle.count({
        where: { merchantId: merchant.id, active: true },
      }),
      DEFAULT_ANGLES.length,
    );
    assert.equal(
      (
        await f.db.betaEntitlement.findUniqueOrThrow({
          where: { merchantId: merchant.id },
        })
      ).status,
      "CONTINUATION_OFFER",
    );
  } finally {
    await f.close();
  }
});

test("real concurrent two-tenant transactions, admin ensure and health queue safely on one SQLite connection", async () => {
  const f = await fixture();
  try {
    const merchants = await Promise.all([
      ensureMerchant(f.db, "one.myshopify.com"),
      ensureMerchant(f.db, "two.myshopify.com"),
    ]);
    for (let round = 0; round < 8; round++) {
      await Promise.all([
        ...merchants.map((merchant) =>
          f.db.$transaction(async (tx) => {
            await tx.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
            await new Promise((resolve) => setTimeout(resolve, 15));
            await tx.merchant.update({
              where: { id: merchant.id },
              data: { shop: merchant.shop },
            });
            // Passing tx into ensure never asks the global pool for a connection.
            await ensureMerchant(tx, merchant.shop);
          }),
        ),
        ...merchants.map((merchant) => ensureMerchant(f.db, merchant.shop)),
        f.db.$queryRawUnsafe("SELECT 1"),
      ]);
    }
    assert.equal(await f.db.merchant.count(), 2);
  } finally {
    await f.close();
  }
});

for (const singleConnection of [false, true])
  test(`real held SQLite transaction: ${singleConnection ? "single connection queues successfully" : "multiple connections time out"}`, async () => {
    const f = await fixture(
      singleConnection
        ? "connection_limit=1&socket_timeout=1&pool_timeout=5"
        : "connection_limit=2&socket_timeout=1",
    );
    try {
      const merchant = await f.db.merchant.create({
        data: { shop: "contended.myshopify.com" },
      });
      let started!: () => void;
      const active = new Promise<void>((resolve) => {
        started = resolve;
      });
      const first = f.db.$transaction(async (tx) => {
        await tx.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
        started();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await tx.merchant.update({
          where: { id: merchant.id },
          data: { shop: merchant.shop },
        });
      });
      await active;
      const second = f.db.$transaction(async (tx) => {
        await tx.merchant.update({
          where: { id: merchant.id },
          data: { shop: merchant.shop },
        });
      });
      const results = await Promise.allSettled([first, second]);
      if (singleConnection)
        assert.ok(results.every((result) => result.status === "fulfilled"));
      else {
        const rejected = results.find((result) => result.status === "rejected");
        assert.ok(rejected?.status === "rejected");
        assert.equal(rejected.reason.code, "P1008");
      }
      assert.equal(await f.db.merchant.count(), 1);
    } finally {
      await f.close();
    }
  });

test("another SQLite client holding the writer causes bounded failure, no replay, and subsequent recovery", async () => {
  const f = await fixture();
  const external = new PrismaClient({ datasourceUrl: sqliteRuntimeUrl(f.url) });
  try {
    const merchant = await f.db.merchant.create({
      data: { shop: "external-lock.myshopify.com" },
    });
    let acquired!: () => void;
    const active = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const held = external.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { id: merchant.id },
        data: { shop: merchant.shop },
      });
      acquired();
      await new Promise((resolve) => setTimeout(resolve, 2700));
    });
    await active;
    const start = performance.now();
    await assert.rejects(
      f.db.merchant.update({
        where: { id: merchant.id },
        data: { shop: "must-not-replay.myshopify.com" },
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P1008",
    );
    assert.ok(
      performance.now() - start < 4500,
      "external lock wait remains bounded",
    );
    await held;
    assert.equal(
      (await f.db.merchant.findUniqueOrThrow({ where: { id: merchant.id } }))
        .shop,
      merchant.shop,
    );
    assert.ok(await f.db.$queryRawUnsafe("SELECT 1"));
  } finally {
    await external.$disconnect();
    await f.close();
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { listAutomationMerchants } from "../app/services/automation-merchants.server";

test("real SQLite selects missing/null control and every pause except exact confirmed uninstall", async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "pagnetic-automation-merchants-"),
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
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  try {
    const cases = [
      { shop: "no-control.myshopify.com", control: undefined },
      {
        shop: "null-reason.myshopify.com",
        control: { killSwitch: true, reason: null },
      },
      {
        shop: "ordinary-pause.myshopify.com",
        control: { killSwitch: true, reason: "Safety pause" },
      },
      {
        shop: "uninstall-marker-cleared.myshopify.com",
        control: { killSwitch: false, reason: "App uninstalled" },
      },
      {
        shop: "case-not-exact.myshopify.com",
        control: { killSwitch: true, reason: "app uninstalled" },
      },
      {
        shop: "confirmed-uninstall.myshopify.com",
        control: { killSwitch: true, reason: "App uninstalled" },
      },
    ];
    for (const entry of cases)
      await db.merchant.create({
        data: {
          shop: entry.shop,
          ...(entry.control
            ? { runtimeControl: { create: entry.control } }
            : {}),
        },
      });
    const uninstalled = await db.merchant.findUniqueOrThrow({
      where: { shop: cases[5].shop },
    });
    for (const type of ["FINALIZE_RESULT", "RECONCILE_ORDER"])
      await db.job.create({
        data: {
          merchantId: uninstalled.id,
          type,
          idempotencyKey: type,
          inputHash: "fixture",
          payloadSchemaVersion: 2,
          payloadJson: "{}",
        },
      });
    const privacy = await db.privacyRequest.create({
      data: {
        shopHash: "uninstalled-fixture",
        requestType: "SHOP_REDACT",
        status: "PENDING",
      },
    });
    const jobsBefore = await db.job.findMany();
    assert.deepEqual(
      (await listAutomationMerchants(db))
        .map((merchant) => merchant.shop)
        .sort(),
      cases
        .slice(0, 5)
        .map((entry) => entry.shop)
        .sort(),
    );
    assert.equal(
      await db.merchant.count(),
      6,
      "selection never deletes tenant history",
    );
    assert.deepEqual(
      await db.job.findMany(),
      jobsBefore,
      "pending financial/finalization work is untouched",
    );
    assert.deepEqual(
      await db.privacyRequest.findUnique({ where: { id: privacy.id } }),
      privacy,
      "global privacy queue is untouched",
    );
  } finally {
    await db.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
});

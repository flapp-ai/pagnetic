import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PrismaClient } from "@prisma/client";

import { ensurePilotRole } from "../app/services/access.server";
import { getStartedAccessPresentation } from "../app/services/pilot-access-presentation";
import {
  pilotRolesForRouteAction,
  requirePilotRouteAction,
  type PilotRouteAction,
} from "../app/services/pilot-route-access.server";

function database() {
  const directory = mkdtempSync(path.join(tmpdir(), "pagnetic-route-access-"));
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
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return {
    db,
    async close() {
      await db.$disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const setupActions: PilotRouteAction[] = [
  "get-started:sync-products",
  "get-started:select-hero",
  "messages:build-draft",
  "messages:campaign-draft",
  "messages:revise-draft",
];

const readOnlyActions: PilotRouteAction[] = ["settings:view"];

const restrictedActions: PilotRouteAction[] = [
  "get-started:approve-brand",
  "get-started:build-library",
  "messages:approve-message",
  "messages:prepare-adaptive-package",
  "messages:approve-adaptive-package",
  "settings:export",
  "settings:verify-subscription",
  "settings:pause",
  "settings:resume",
  "operations:kill-switch-on",
  "operations:kill-switch-off",
  "operations:view",
  "governance:view",
  "measurement:view",
  "setup:grant-role",
];

test("route policy gives SETUP only catalog and draft configuration", () => {
  for (const action of setupActions)
    assert.ok(pilotRolesForRouteAction(action).includes("SETUP"), action);
  for (const action of restrictedActions)
    assert.equal(
      pilotRolesForRouteAction(action).includes("SETUP"),
      false,
      action,
    );
  for (const action of readOnlyActions) {
    assert.ok(pilotRolesForRouteAction(action).includes("SETUP"), action);
    assert.ok(pilotRolesForRouteAction(action).includes("VIEWER"), action);
  }
});

test("setup-only onboarding presentation hides owner approval and operator stages", () => {
  assert.deepEqual(getStartedAccessPresentation("SETUP"), {
    canApproveBrand: false,
    canBuildLibrary: false,
    canOpenOwnerReview: false,
    canOpenOwnerStages: false,
  });
  assert.deepEqual(getStartedAccessPresentation("OWNER"), {
    canApproveBrand: true,
    canBuildLibrary: true,
    canOpenOwnerReview: true,
    canOpenOwnerStages: true,
  });
});

test("sensitive route loaders are wired to restricted route policies", () => {
  const routes = [
    ["app/routes/app.settings.export.ts", "settings:export"],
    ["app/routes/app.settings.tsx", "settings:view"],
    ["app/routes/app.operations.tsx", "operations:view"],
    ["app/routes/app.governance.tsx", "governance:view"],
    ["app/routes/app.measurement.tsx", "measurement:view"],
  ] as const;
  for (const [file, action] of routes) {
    const source = readFileSync(file, "utf8");
    assert.match(source, new RegExp(`action: ["']${action}["']`), file);
  }
});

test("automatic SETUP actor can configure onboarding but cannot operate, approve, publish, bill, or grant roles", async () => {
  const fixture = database();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "route-access.myshopify.com" },
    });
    const owner = await ensurePilotRole({
      db: fixture.db,
      merchantId: merchant.id,
      actor: "owner",
    });
    const setup = await ensurePilotRole({
      db: fixture.db,
      merchantId: merchant.id,
      actor: "reviewer",
    });
    assert.equal(owner.role, "OWNER");
    assert.equal(setup.role, "SETUP");

    for (const action of [...setupActions, ...readOnlyActions]) {
      const authorized = await requirePilotRouteAction({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "reviewer",
        action,
      });
      assert.equal(authorized.role, "SETUP", action);
    }
    for (const action of restrictedActions) {
      await assert.rejects(
        requirePilotRouteAction({
          db: fixture.db,
          merchantId: merchant.id,
          actor: "reviewer",
          action,
        }),
        /requires one of these pilot roles/,
        action,
      );
    }

    await fixture.db.pilotRole.create({
      data: {
        merchantId: merchant.id,
        actorKey: "viewer",
        role: "VIEWER",
        grantedBy: "owner",
      },
    });
    assert.equal(
      (
        await requirePilotRouteAction({
          db: fixture.db,
          merchantId: merchant.id,
          actor: "viewer",
          action: "settings:view",
        })
      ).role,
      "VIEWER",
    );
    await assert.rejects(
      requirePilotRouteAction({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "viewer",
        action: "messages:campaign-draft",
      }),
      /requires one of these pilot roles/,
    );
  } finally {
    await fixture.close();
  }
});

test("inactive SETUP assignment is preserved and denied", async () => {
  const fixture = database();
  try {
    const merchant = await fixture.db.merchant.create({
      data: { shop: "inactive-setup.myshopify.com" },
    });
    const inactive = await fixture.db.pilotRole.create({
      data: {
        merchantId: merchant.id,
        actorKey: "reviewer",
        role: "SETUP",
        active: false,
        grantedBy: "owner",
      },
    });
    const preserved = await ensurePilotRole({
      db: fixture.db,
      merchantId: merchant.id,
      actor: "reviewer",
    });
    assert.equal(preserved.id, inactive.id);
    assert.equal(preserved.active, false);
    await assert.rejects(
      requirePilotRouteAction({
        db: fixture.db,
        merchantId: merchant.id,
        actor: "reviewer",
        action: "messages:campaign-draft",
      }),
      /requires one of these pilot roles/,
    );
  } finally {
    await fixture.close();
  }
});

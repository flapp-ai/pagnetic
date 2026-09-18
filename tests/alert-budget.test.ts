import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  reserveAlertAttempt,
  seedAlertBudget,
} from "../app/services/alert-budget.server";

test("persistent global monthly cap counts attempts, rolls UTC month and rejects rollback", () => {
  const directory = mkdtempSync(
    path.join(realpathSync(tmpdir()), "alert-budget-"),
  );
  const environment = { ALERT_BUDGET_DIRECTORY: directory };
  try {
    assert.throws(
      () => reserveAlertAttempt(environment, new Date("2026-09-18T12:00:00Z")),
      /UNAVAILABLE/,
    );
    seedAlertBudget(directory, {
      version: 1,
      month: "2026-09",
      attempts: 98,
      lastReservedAt: "2026-09-18T12:00:00.000Z",
    });
    const now = new Date("2026-09-18T12:00:00Z");
    reserveAlertAttempt(environment, now);
    reserveAlertAttempt(environment, now);
    assert.throws(() => reserveAlertAttempt(environment, now), /EXHAUSTED/);
    assert.equal(
      JSON.parse(
        readFileSync(
          path.join(directory, "monthly-alert-attempts.json"),
          "utf8",
        ),
      ).attempts,
      100,
    );
    reserveAlertAttempt(environment, new Date("2026-10-01T00:00:00Z"));
    assert.throws(
      () => reserveAlertAttempt(environment, now),
      /CLOCK_ROLLBACK/,
    );
    assert.throws(() =>
      seedAlertBudget(directory, {
        version: 1,
        month: "2026-09",
        attempts: 0,
        lastReservedAt: now.toISOString(),
      }),
    );
    assert.throws(
      () =>
        reserveAlertAttempt(
          { ...environment, ALERT_MONTHLY_SEND_LIMIT: "101" },
          now,
        ),
      /UNAVAILABLE/,
    );
    mkdirSync(path.join(directory, ".lock"), { mode: 0o700 });
    assert.throws(
      () => reserveAlertAttempt(environment, new Date("2026-10-02")),
      /UNAVAILABLE/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("permissions and symlinks fail closed", () => {
  const directory = mkdtempSync(
    path.join(realpathSync(tmpdir()), "alert-budget-"),
  );
  try {
    seedAlertBudget(directory, {
      version: 1,
      month: "2026-09",
      attempts: 0,
      lastReservedAt: "2026-09-01T00:00:00.000Z",
    });
    chmodSync(path.join(directory, "monthly-alert-attempts.json"), 0o644);
    assert.throws(
      () =>
        reserveAlertAttempt(
          { ALERT_BUDGET_DIRECTORY: directory },
          new Date("2026-09-18"),
        ),
      /UNAVAILABLE/,
    );
    const linked = path.join(directory, "linked");
    symlinkSync(directory, linked);
    assert.throws(
      () =>
        reserveAlertAttempt(
          { ALERT_BUDGET_DIRECTORY: linked },
          new Date("2026-09-18"),
        ),
      /UNAVAILABLE/,
    );
    const file = path.join(directory, "monthly-alert-attempts.json");
    chmodSync(file, 0o600);
    writeFileSync(file, "{broken-json");
    assert.throws(
      () =>
        reserveAlertAttempt(
          { ALERT_BUDGET_DIRECTORY: directory },
          new Date("2026-09-18"),
        ),
      /UNAVAILABLE/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertBackupUploadBudget,
  backupUploadBudget,
  BACKUP_BUCKET_HARD_BYTES,
  BACKUP_OBJECT_HARD_BYTES,
  BACKUP_LIST_MAX_PAGES,
  serializedBackupUploads,
  withBackupUploadLock,
} from "../scripts/lib/backup-upload-budget";

const budget = backupUploadBudget({});
test("backup budget defaults and overrides cannot exceed hard caps", () => {
  assert.deepEqual(budget, {
    bucketBytes: BACKUP_BUCKET_HARD_BYTES,
    objectBytes: BACKUP_OBJECT_HARD_BYTES,
  });
  assert.deepEqual(
    backupUploadBudget({
      BACKUP_BUCKET_MAX_BYTES: "100",
      BACKUP_OBJECT_MAX_BYTES: "50",
    }),
    { bucketBytes: 100, objectBytes: 50 },
  );
  for (const invalid of [
    "0",
    "-1",
    "1.5",
    "",
    "Infinity",
    "4000000001",
    "9007199254740993",
  ]) {
    assert.throws(
      () => backupUploadBudget({ BACKUP_BUCKET_MAX_BYTES: invalid }),
      /CONFIGURATION_INVALID/,
    );
  }
  assert.throws(
    () =>
      backupUploadBudget({
        BACKUP_OBJECT_MAX_BYTES: String(BACKUP_OBJECT_HARD_BYTES + 1),
      }),
    /CONFIGURATION_INVALID/,
  );
});

test("all paginated bucket objects count and an exact cap is accepted", async () => {
  const tokens: Array<string | undefined> = [];
  await assertBackupUploadBudget({
    size: 10,
    budget: { bucketBytes: 100, objectBytes: 10 },
    list: async (token, signal) => {
      assert.equal(signal.aborted, false);
      tokens.push(token);
      return token
        ? { Contents: [{ Size: 40 }], IsTruncated: false }
        : {
            Contents: [{ Size: 50 }],
            IsTruncated: true,
            NextContinuationToken: "page2",
          };
    },
  });
  assert.deepEqual(tokens, [undefined, "page2"]);
});

test("object and cumulative bucket limits block before any upload", async () => {
  let listings = 0;
  await assert.rejects(
    assertBackupUploadBudget({
      size: BACKUP_OBJECT_HARD_BYTES + 1,
      budget,
      list: async () => {
        listings++;
        return { IsTruncated: false };
      },
    }),
    /OBJECT_BUDGET_EXCEEDED/,
  );
  assert.equal(listings, 0);
  await assert.rejects(
    assertBackupUploadBudget({
      size: 10,
      budget: { bucketBytes: 100, objectBytes: 10 },
      list: async () => ({ Contents: [{ Size: 91 }], IsTruncated: false }),
    }),
    /BUCKET_BUDGET_EXCEEDED/,
  );
});

test("missing permission, invalid inventory, cycles and excessive pagination all fail closed", async () => {
  await assert.rejects(
    assertBackupUploadBudget({
      size: 1,
      budget,
      list: async () => {
        throw new Error("AccessDenied");
      },
    }),
    /AccessDenied/,
  );
  for (const response of [
    {},
    { IsTruncated: false, Contents: [{}] },
    { IsTruncated: false, Contents: [{ Size: -1 }] },
    { IsTruncated: true },
  ]) {
    await assert.rejects(
      assertBackupUploadBudget({ size: 1, budget, list: async () => response }),
      /INVENTORY_INVALID/,
    );
  }
  await assert.rejects(
    assertBackupUploadBudget({
      size: 1,
      budget,
      list: async () => ({ IsTruncated: true, NextContinuationToken: "cycle" }),
    }),
    /INVENTORY_INVALID/,
  );
  let pages = 0;
  await assert.rejects(
    assertBackupUploadBudget({
      size: 1,
      budget,
      list: async () => ({
        IsTruncated: true,
        NextContinuationToken: String(++pages),
      }),
    }),
    /PAGE_LIMIT/,
  );
  assert.equal(pages, BACKUP_LIST_MAX_PAGES);
});

test("FIFO puts never overlap and failure is propagated without replay", async () => {
  const serialize = serializedBackupUploads();
  const events: string[] = [];
  const first = serialize(async () => {
    events.push("first");
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push("failed");
    throw new Error("blocked");
  });
  const second = serialize(async () => {
    events.push("second");
    return 2;
  });
  await assert.rejects(first, /blocked/);
  assert.equal(await second, 2);
  assert.deepEqual(events, ["first", "failed", "second"]);
});

test("filesystem upload lock excludes other adapters/processes and never removes stale lock", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pagnetic-backup-lock-"));
  const lock = path.join(directory, "upload.lock");
  try {
    await withBackupUploadLock(async () => {
      await assert.rejects(
        withBackupUploadLock(
          async () => assert.fail("overlapping upload"),
          lock,
        ),
        /ALREADY_RUNNING_OR_STALE_LOCK/,
      );
    }, lock);
    await assert.rejects(stat(lock), { code: "ENOENT" });
    await assert.rejects(
      withBackupUploadLock(async () => {
        throw new Error("listing denied");
      }, lock),
      /listing denied/,
    );
    await mkdir(lock);
    await assert.rejects(
      withBackupUploadLock(async () => assert.fail("stale unlock"), lock),
      /ALREADY_RUNNING_OR_STALE_LOCK/,
    );
    assert.ok((await stat(lock)).isDirectory());
    await rm(lock, { recursive: true });
    await assert.rejects(
      withBackupUploadLock(async () => {
        await rename(lock, path.join(directory, "old-lock"));
        await mkdir(lock);
      }, lock),
      /LOCK_OWNERSHIP_CHANGED/,
    );
    assert.ok(
      (await stat(lock)).isDirectory(),
      "replacement lock must not be unlocked",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

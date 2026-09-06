import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyBackupHeadroom } from "../scripts/lib/backup-headroom";

const reserve = 256n * 1024n * 1024n;

test("backup headroom sums shared-device demands and keeps a reserve per volume", () => {
  assert.deepEqual(verifyBackupHeadroom([
    { device: 1n, availableBytes: reserve + 100n, requiredBytes: 50n },
    { device: 1n, availableBytes: reserve + 100n, requiredBytes: 50n },
    { device: 2n, availableBytes: reserve + 10n, requiredBytes: 10n },
  ]), { checkedFilesystems: 2 });
  assert.throws(() => verifyBackupHeadroom([
    { device: 1n, availableBytes: reserve + 99n, requiredBytes: 50n },
    { device: 1n, availableBytes: reserve + 100n, requiredBytes: 50n },
  ]), /HEADROOM_INSUFFICIENT/);
  assert.throws(() => verifyBackupHeadroom([
    { device: 1n, availableBytes: reserve * 100n, requiredBytes: 50n },
    { device: 2n, availableBytes: reserve - 1n, requiredBytes: 0n },
  ]), /HEADROOM_INSUFFICIENT/);
});

test("backup headroom uses exact wide integers and fails closed on invalid measurements", () => {
  const large = 2n ** 60n;
  assert.throws(() => verifyBackupHeadroom([
    { device: 1n, availableBytes: large + reserve - 1n, requiredBytes: large },
  ]), /HEADROOM_INSUFFICIENT/);
  assert.throws(() => verifyBackupHeadroom([
    { device: 1n, availableBytes: -1n, requiredBytes: 0n },
  ]), /MEASUREMENT_INVALID/);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildPrivacyJournal, decryptPrivacyJournal, encryptPrivacyJournal, reapplyPrivacyJournal } from "../app/services/privacy-journal.server";

const key = Buffer.alloc(32, 7);
function dbFixture() {
  const directory = mkdtempSync(join(tmpdir(), "pagnetic-privacy-journal-"));
  const database = join(directory, "test.sqlite");
  for (const migration of readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).sort())
    execFileSync("sqlite3", [database], { input: readFileSync(join("prisma/migrations", migration, "migration.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  return { db, async close() { await db.$disconnect(); rmSync(directory, { recursive: true, force: true }); } };
}

test("privacy journal is encrypted, bounded, tamper-evident and idempotently reapplied", async () => {
  const f = dbFixture();
  try {
    const order = { shopHash: "a".repeat(64), orderHash: "b".repeat(64), requestId: "request-1", lookupKeyId: "c".repeat(64) };
    const identity = { shopHash: "a".repeat(64), kind: "VISITOR", identityHash: "d".repeat(64), requestId: "request-1", lookupKeyId: "c".repeat(64) };
    await f.db.privacyOrderSuppression.create({ data: order });
    await f.db.privacyIdentitySuppression.create({ data: identity });
    const journal = await f.db.$transaction((tx) => buildPrivacyJournal(tx, new Date("2026-09-05T12:00:00.000Z")));
    const encrypted = encryptPrivacyJournal(journal, key);
    assert.equal(encrypted.toString("utf8").includes(order.orderHash), false);
    const opened = decryptPrivacyJournal(encrypted, key);
    assert.deepEqual(opened.orderSuppressions, [order]);
    assert.deepEqual(opened.identitySuppressions, [identity]);
    const tampered = Buffer.from(encrypted); tampered[tampered.length - 2] ^= 1;
    assert.throws(() => decryptPrivacyJournal(tampered, key), /PRIVACY_JOURNAL_/);
    await f.db.privacyOrderSuppression.deleteMany();
    await f.db.privacyIdentitySuppression.deleteMany();
    const result = await f.db.$transaction((tx) => reapplyPrivacyJournal(tx, opened));
    assert.deepEqual(result, { orderSuppressions: 1, identitySuppressions: 1, reapplicationVerified: true, activeErasureVerified: false });
    await f.db.$transaction((tx) => reapplyPrivacyJournal(tx, opened));
    assert.equal(await f.db.privacyOrderSuppression.count(), 1);
    assert.equal(await f.db.privacyIdentitySuppression.count(), 1);
  } finally { await f.close(); }
});

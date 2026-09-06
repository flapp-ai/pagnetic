import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeTransferValue,
  type TransferField,
} from "../scripts/lib/postgres-transfer";

const field = (type: string): TransferField => ({
  name: "test",
  kind: "scalar",
  isId: false,
  isList: false,
  type,
});

test("migration preserves exact integers and rejects PostgreSQL32 overflow without rounding", () => {
  assert.equal(
    normalizeTransferValue(field("BigInt"), "9007199254740993"),
    "9007199254740993",
  );
  assert.equal(
    normalizeTransferValue(field("Int"), "2147483647"),
    "2147483647",
  );
  assert.throws(
    () => normalizeTransferValue(field("Int"), "2147483648"),
    /overflow/,
  );
  assert.throws(
    () => normalizeTransferValue(field("BigInt"), Number("9007199254740993")),
    /exact decimal/,
  );
  assert.throws(
    () => normalizeTransferValue(field("BigInt"), "9223372036854775808"),
    /overflow/,
  );
});

test("migration preserves legacy decimal amounts without float arithmetic", () => {
  assert.equal(
    normalizeTransferValue(field("Decimal"), "123456.78000"),
    "123456.78",
  );
  assert.equal(normalizeTransferValue(field("Decimal"), "1.23e-2"), "0.0123");
  assert.throws(
    () => normalizeTransferValue(field("Decimal"), "1e36"),
    /exceeds/,
  );
});

test("migration normalizes timestamp/boolean storage and preserves source strings", () => {
  assert.equal(
    normalizeTransferValue(field("DateTime"), "2026-09-05 00:00:00.123"),
    "2026-09-05T00:00:00.123Z",
  );
  assert.equal(
    normalizeTransferValue(field("DateTime"), "1788566400123"),
    "2026-09-05T00:00:00.123Z",
  );
  assert.equal(normalizeTransferValue(field("Boolean"), 0), false);
  assert.equal(normalizeTransferValue(field("Boolean"), true), true);
  assert.equal(
    normalizeTransferValue(field("String"), "Ölçüm — 'text'"),
    "Ölçüm — 'text'",
  );
  assert.throws(
    () => normalizeTransferValue(field("Boolean"), 2),
    /Invalid boolean/,
  );
  assert.throws(
    () => normalizeTransferValue(field("String"), "null\0byte"),
    /Invalid text/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { consumeRateLimit } from "../app/services/rate-limit.server";

test("absolute capacity denies new live buckets without resetting existing keys; expiry recovers", () => {
  const base = { limit: 1, windowMilliseconds: 1000, now: 1000 };
  for (let index = 0; index < 10_000; index++)
    assert.equal(
      consumeRateLimit({ ...base, key: `capacity:${index}` }).allowed,
      true,
    );
  assert.equal(consumeRateLimit({ ...base, key: "overflow" }).allowed, false);
  assert.equal(consumeRateLimit({ ...base, key: "capacity:0" }).allowed, false);
  assert.equal(
    consumeRateLimit({ ...base, now: 2000, key: "overflow" }).allowed,
    true,
  );
});

test("invalid rate limit arguments are rejected", () => {
  for (const invalid of [
    { limit: 0 },
    { limit: NaN },
    { windowMilliseconds: -1 },
    { windowMilliseconds: Infinity },
    { now: NaN },
    { key: "" },
  ]) {
    assert.throws(
      () =>
        consumeRateLimit({
          key: "validation",
          limit: 1,
          windowMilliseconds: 1000,
          ...invalid,
        }),
      /INVALID_RATE_LIMIT_ARGUMENTS/,
    );
  }
});

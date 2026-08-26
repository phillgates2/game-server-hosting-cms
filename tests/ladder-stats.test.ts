/**
 * Tests for ladder stat validation.
 *
 * The ladder columns are Postgres integers. The routes used to `Number()`
 * the body directly, so "abc" became NaN (driver error → 500), "1.5" a
 * float (driver error → 500), and negative or huge values were accepted
 * straight into the standings. This pins the shared validator.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseLadderStat,
  ladderStatError,
  MAX_LADDER_COUNT,
  MAX_LADDER_POINTS,
} from "../src/lib/ladder-stats";
import { isUniqueViolation } from "../src/lib/api-error";

describe("parseLadderStat", () => {
  test("accepts plain whole numbers", () => {
    assert.equal(parseLadderStat(12, 0), 12);
    assert.equal(parseLadderStat("7", 0), 7);
    assert.equal(parseLadderStat(" 42 ", 0), 42);
    assert.equal(parseLadderStat(0, 0), 0);
  });

  test("returns the fallback when the field is absent", () => {
    assert.equal(parseLadderStat(undefined, 0), 0);
    assert.equal(parseLadderStat(null, 5), 5);
    assert.equal(parseLadderStat("", 3), 3);
  });

  test("rejects NaN, floats, negatives and oversized values", () => {
    assert.equal(parseLadderStat("abc", 0), null);
    assert.equal(parseLadderStat("1.5", 0), null);
    assert.equal(parseLadderStat(-3, 0), null);
    assert.equal(parseLadderStat("-1", 0), null);
    assert.equal(parseLadderStat(MAX_LADDER_COUNT + 1, 0), null);
    assert.equal(parseLadderStat(Number.POSITIVE_INFINITY, 0), null);
  });

  test("rejects non-numeric shapes Number() would coerce", () => {
    assert.equal(parseLadderStat(true, 0), null, "Number(true) is 1");
    assert.equal(parseLadderStat(false, 0), null);
    assert.equal(parseLadderStat([], 0), null, "Number([]) is 0");
    assert.equal(parseLadderStat([3], 0), null);
    assert.equal(parseLadderStat({}, 0), null);
  });

  test("honours a per-field ceiling (points use a much bigger one)", () => {
    assert.equal(parseLadderStat(50_000_000, 0, MAX_LADDER_POINTS), 50_000_000);
    assert.equal(parseLadderStat(50_000_000, 0, MAX_LADDER_COUNT), null);
  });

  test("produces a field-specific error message", () => {
    assert.match(ladderStatError("wins"), /^wins must be a whole number between 0 and /);
    assert.match(ladderStatError("points", MAX_LADDER_POINTS), /points must be a whole number/);
  });
});

describe("isUniqueViolation", () => {
  test("recognises Postgres 23505", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
  });

  test("ignores other errors and nulls", () => {
    assert.equal(isUniqueViolation({ code: "22001" }), false);
    assert.equal(isUniqueViolation(new Error("boom")), false);
    assert.equal(isUniqueViolation(null), false);
    assert.equal(isUniqueViolation(undefined), false);
  });
});

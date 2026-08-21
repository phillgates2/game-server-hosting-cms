/**
 * Unit tests for the pagination clamps.
 *
 * These parameters feed straight into SQL LIMIT/OFFSET. Before they were
 * clamped, `?limit=999999999` read an entire table into memory and `?limit=abc`
 * produced a NaN that Postgres rejected outright.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  intParam,
  limitParam,
  offsetParam,
  pageParam,
  MAX_LIMIT,
} from "../src/lib/pagination";

const qs = (o: Record<string, string>) => new URLSearchParams(o);

describe("limitParam", () => {
  test("accepts a sensible value unchanged", () => {
    assert.equal(limitParam(qs({ limit: "50" }), 100), 50);
  });

  test("clamps an absurd value to the ceiling", () => {
    // The whole point: one request must not be able to read a whole table.
    assert.equal(limitParam(qs({ limit: "999999999" }), 100), MAX_LIMIT);
  });

  test("rejects non-numeric input by falling back to the default", () => {
    assert.equal(limitParam(qs({ limit: "abc" }), 100), 100);
    assert.equal(limitParam(qs({ limit: "" }), 100), 100);
  });

  test("never returns zero or negative, which Postgres would reject", () => {
    assert.equal(limitParam(qs({ limit: "0" }), 100), 1);
    assert.equal(limitParam(qs({ limit: "-1" }), 100), 1);
    assert.equal(limitParam(qs({ limit: "-999" }), 100), 1);
  });

  test("uses the default when the parameter is absent", () => {
    assert.equal(limitParam(qs({}), 100), 100);
    assert.equal(limitParam(qs({}), 50), 50);
  });

  test("honours a caller-supplied ceiling below the global maximum", () => {
    assert.equal(limitParam(qs({ limit: "400" }), 50, 200), 200);
  });
});

describe("offsetParam", () => {
  test("accepts a normal offset", () => {
    assert.equal(offsetParam(qs({ offset: "250" })), 250);
  });

  test("clamps negatives to zero", () => {
    assert.equal(offsetParam(qs({ offset: "-5" })), 0);
  });

  test("falls back on garbage", () => {
    assert.equal(offsetParam(qs({ offset: "drop table" })), 0);
  });

  test("caps absurd deep paging", () => {
    assert.ok(offsetParam(qs({ offset: "999999999999" })) <= 1_000_000);
  });
});

describe("pageParam", () => {
  test("is 1-based and never returns 0", () => {
    assert.equal(pageParam(qs({ page: "0" })), 1);
    assert.equal(pageParam(qs({ page: "-3" })), 1);
    assert.equal(pageParam(qs({ page: "7" })), 7);
  });
});

describe("intParam", () => {
  test("clamps into the requested range", () => {
    assert.equal(intParam("500", 10, 1, 100), 100);
    assert.equal(intParam("-500", 10, 1, 100), 1);
    assert.equal(intParam("42", 10, 1, 100), 42);
  });

  test("treats null, undefined and blank as absent", () => {
    assert.equal(intParam(null, 7, 1, 100), 7);
    assert.equal(intParam(undefined, 7, 1, 100), 7);
    assert.equal(intParam("   ", 7, 1, 100), 7);
  });

  test("parses a leading integer the way parseInt does", () => {
    // "1e9" is parsed as 1 by parseInt; the important part is that it is
    // finite and inside the range rather than a surprise 1,000,000,000.
    const v = intParam("1e9", 10, 1, 100);
    assert.ok(v >= 1 && v <= 100, `expected a clamped value, got ${v}`);
  });
});

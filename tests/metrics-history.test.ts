/**
 * Tests for the metric-history helpers (range clamping + downsampling).
 *
 * These guard the charts from both a hostile query string and a runaway
 * series: the route must always return a bounded, ordered result.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampRangeHours,
  downsampleSeries,
  MIN_RANGE_HOURS,
  MAX_RANGE_HOURS,
  DEFAULT_RANGE_HOURS,
  MAX_CHART_POINTS,
} from "../src/lib/metrics-history";

describe("clampRangeHours", () => {
  test("accepts sane values", () => {
    assert.equal(clampRangeHours("6"), 6);
    assert.equal(clampRangeHours("24"), 24);
    assert.equal(clampRangeHours(1), 1);
  });

  test("floors at the minimum window", () => {
    assert.equal(clampRangeHours("0"), MIN_RANGE_HOURS);
    assert.equal(clampRangeHours("-5"), MIN_RANGE_HOURS);
    assert.equal(clampRangeHours("0.5"), MIN_RANGE_HOURS, "fractions floor to the minimum");
  });

  test("caps at the maximum window", () => {
    assert.equal(clampRangeHours("999999"), MAX_RANGE_HOURS);
  });

  test("falls back on junk, missing and non-numeric input", () => {
    assert.equal(clampRangeHours(null), DEFAULT_RANGE_HOURS);
    assert.equal(clampRangeHours(undefined), DEFAULT_RANGE_HOURS);
    assert.equal(clampRangeHours("abc"), DEFAULT_RANGE_HOURS);
    assert.equal(clampRangeHours(""), DEFAULT_RANGE_HOURS);
    assert.equal(clampRangeHours(NaN), DEFAULT_RANGE_HOURS);
  });

  test("always returns a whole number of hours", () => {
    assert.equal(clampRangeHours("6.9"), 6);
  });
});

describe("downsampleSeries", () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i, v: i % 7 }));

  test("returns small series untouched (but never the same array)", () => {
    const input = series(10);
    const out = downsampleSeries(input, 360);
    assert.deepEqual(out, input);
    assert.notEqual(out, input, "callers must be able to mutate safely");
  });

  test("never exceeds the point budget", () => {
    const out = downsampleSeries(series(20_000), MAX_CHART_POINTS);
    assert.ok(out.length <= MAX_CHART_POINTS, `got ${out.length}`);
    assert.ok(out.length > MAX_CHART_POINTS * 0.5, "stride should not over-thin");
  });

  test("keeps the first and last points so the chart spans the window", () => {
    const input = series(5_000);
    const out = downsampleSeries(input, 360);
    assert.deepEqual(out[0], input[0]);
    assert.deepEqual(out[out.length - 1], input[input.length - 1]);
  });

  test("preserves chronological order", () => {
    const out = downsampleSeries(series(9_999), 200);
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i].t > out[i - 1].t, "points must be strictly increasing");
    }
  });

  test("handles empty and single-point input", () => {
    assert.deepEqual(downsampleSeries([], 360), []);
    assert.deepEqual(downsampleSeries([{ t: 1, v: 2 }], 360), [{ t: 1, v: 2 }]);
  });
});

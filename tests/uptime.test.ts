/**
 * Tests for server stability tracking.
 *
 * The tracker samples "is the process alive while the server runs" every
 * 5 minutes; these tests pin the windowing math, the clamp, and the grade
 * bands the Overview displays.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampUptimeHours,
  summarizeUptime,
  uptimeGrade,
  uptimeCutoffMs,
  UPTIME_DEFAULT_HOURS,
  UPTIME_MAX_HOURS,
  UPTIME_RETENTION_DAYS,
  type UptimeSample,
} from "../src/lib/uptime";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function samples(pattern: string, stepMs = 5 * 60_000): UptimeSample[] {
  return pattern.split("").map((ch, i) => ({
    online: ch === "1",
    checkedAt: NOW - (pattern.length - i) * stepMs,
  }));
}

describe("clampUptimeHours", () => {
  test("defaults and clamps", () => {
    assert.equal(clampUptimeHours(null), UPTIME_DEFAULT_HOURS);
    assert.equal(clampUptimeHours(""), UPTIME_DEFAULT_HOURS);
    assert.equal(clampUptimeHours("junk"), UPTIME_DEFAULT_HOURS);
    assert.equal(clampUptimeHours("0"), 1);
    assert.equal(clampUptimeHours("24"), 24);
    assert.equal(clampUptimeHours("99999"), UPTIME_MAX_HOURS);
    assert.equal(UPTIME_MAX_HOURS, UPTIME_RETENTION_DAYS * 24);
  });
});

describe("summarizeUptime", () => {
  test("computes percent over the window", () => {
    // 8 up, 2 down → 80%
    const sum = summarizeUptime(samples("1111011101"), 24 * HOUR, NOW);
    assert.equal(sum.checks, 10);
    assert.equal(sum.onlineChecks, 8);
    assert.equal(sum.percent, 80);
  });

  test("100% and rounding to two decimals", () => {
    assert.equal(summarizeUptime(samples("111"), 24 * HOUR, NOW).percent, 100);
    // 2 of 3 up = 66.666… → 66.67
    assert.equal(summarizeUptime(samples("110"), 24 * HOUR, NOW).percent, 66.67);
  });

  test("samples outside the window are ignored", () => {
    const rows: UptimeSample[] = [
      { online: false, checkedAt: NOW - 48 * HOUR }, // outside a 24h window
      { online: true, checkedAt: NOW - 1 * HOUR },
      { online: true, checkedAt: NOW - 2 * HOUR },
    ];
    const sum = summarizeUptime(rows, 24 * HOUR, NOW);
    assert.equal(sum.checks, 2);
    assert.equal(sum.percent, 100);
  });

  test("no samples in window → null percent, not zero", () => {
    const sum = summarizeUptime([], 24 * HOUR, NOW);
    assert.deepEqual(sum, { checks: 0, onlineChecks: 0, percent: null });
    const old = summarizeUptime([{ online: true, checkedAt: NOW - 30 * HOUR }], 24 * HOUR, NOW);
    assert.equal(old.percent, null);
  });
});

describe("uptimeGrade", () => {
  test("bands", () => {
    assert.equal(uptimeGrade(null), "unknown");
    assert.equal(uptimeGrade(100), "excellent");
    assert.equal(uptimeGrade(99.5), "excellent");
    assert.equal(uptimeGrade(99.49), "good");
    assert.equal(uptimeGrade(95), "good");
    assert.equal(uptimeGrade(94.99), "poor");
    assert.equal(uptimeGrade(0), "poor");
  });
});

describe("uptimeCutoffMs", () => {
  test("retention window", () => {
    assert.equal(NOW - uptimeCutoffMs(NOW), UPTIME_RETENTION_DAYS * 24 * HOUR);
  });
});

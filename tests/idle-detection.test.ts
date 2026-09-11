/**
 * Tests for idle-server detection clock math.
 *
 * The detector's honesty rules: activity clears the clock, emptiness stamps
 * it once (first sighting wins), and an UNREACHABLE probe must never be
 * treated as evidence of emptiness.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  idleDurationMs,
  isServerIdle,
  describeIdleDuration,
  nextIdleStamp,
  shouldIdleStop,
  IDLE_DEFAULT_THRESHOLD_HOURS,
  resolveIdleThresholdMs,
} from "../src/lib/idle-math";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe("idleDurationMs", () => {
  test("measures the streak from the stamp", () => {
    assert.equal(idleDurationMs(NOW - 3 * HOUR, NOW), 3 * HOUR);
    assert.equal(idleDurationMs(new Date(NOW - 2 * HOUR), NOW), 2 * HOUR);
    assert.equal(idleDurationMs(new Date(NOW - HOUR).toISOString(), NOW), HOUR);
  });

  test("no stamp means no idle tracking", () => {
    assert.equal(idleDurationMs(null, NOW), null);
    assert.equal(idleDurationMs(undefined, NOW), null);
  });

  test("garbage stamps are rejected, future stamps clamp to zero", () => {
    assert.equal(idleDurationMs("not-a-date", NOW), null);
    assert.equal(idleDurationMs(NOW + HOUR, NOW), 0);
  });
});

describe("isServerIdle", () => {
  const threshold = IDLE_DEFAULT_THRESHOLD_HOURS * HOUR;

  test("idle only at or past the threshold", () => {
    assert.equal(isServerIdle(NOW - threshold, NOW, threshold), true);
    assert.equal(isServerIdle(NOW - threshold + 1, NOW, threshold), false);
    assert.equal(isServerIdle(null, NOW, threshold), false);
  });
});

describe("describeIdleDuration", () => {
  test("compact bands", () => {
    assert.equal(describeIdleDuration(5 * 60_000), "5m");
    assert.equal(describeIdleDuration(3 * HOUR + 20 * 60_000), "3h 20m");
    assert.equal(describeIdleDuration(2 * 24 * HOUR + 4 * HOUR), "2d 4h");
  });
});

describe("nextIdleStamp — the probe decision", () => {
  const now = new Date(NOW);
  const earlier = new Date(NOW - 2 * HOUR);

  test("unreachable probes change nothing", () => {
    assert.equal(nextIdleStamp(false, undefined, earlier, now), undefined);
    assert.equal(nextIdleStamp(false, 5, earlier, now), undefined);
    assert.equal(nextIdleStamp(false, undefined, null, now), undefined);
  });

  test("players clear the clock", () => {
    assert.equal(nextIdleStamp(true, 3, earlier, now), null);
    assert.equal(nextIdleStamp(true, 1, null, now), null);
  });

  test("empty probes stamp once — the first sighting wins", () => {
    assert.equal(nextIdleStamp(true, 0, null, now), now);
    assert.equal(nextIdleStamp(true, 0, earlier, now), earlier);
    assert.equal(nextIdleStamp(true, undefined, earlier, now), earlier);
  });
});

describe("shouldIdleStop — the auto-stop decision", () => {
  const thresholdMs = 6 * 3_600_000;
  const base = {
    policyEnabled: true,
    serverStatus: "running",
    nodeIsLocal: true as boolean | null,
    idleForMs: 7 * 3_600_000,
    thresholdMs,
  };

  test("stops only when every condition holds", () => {
    assert.equal(shouldIdleStop(base), true);
    assert.equal(shouldIdleStop({ ...base, policyEnabled: false }), false);
    assert.equal(shouldIdleStop({ ...base, serverStatus: "stopped" }), false);
    assert.equal(shouldIdleStop({ ...base, serverStatus: "installing" }), false);
    assert.equal(shouldIdleStop({ ...base, nodeIsLocal: false }), false);
    assert.equal(shouldIdleStop({ ...base, idleForMs: null }), false);
    assert.equal(shouldIdleStop({ ...base, idleForMs: thresholdMs - 1 }), false);
  });

  test("fires exactly at the threshold", () => {
    assert.equal(shouldIdleStop({ ...base, idleForMs: thresholdMs }), true);
  });

  test("null nodeIsLocal (no node record) is treated as local", () => {
    assert.equal(shouldIdleStop({ ...base, nodeIsLocal: null }), true);
  });
});

test("resolveIdleThresholdMs: default, fractional hours, invalid values fall back", () => {
  assert.strictEqual(resolveIdleThresholdMs([]), IDLE_DEFAULT_THRESHOLD_HOURS * 3_600_000);
  assert.strictEqual(resolveIdleThresholdMs([{ key: "idle_auto_stop_hours", value: "2.5" }]), 9_000_000);
  assert.strictEqual(resolveIdleThresholdMs([{ key: "idle_auto_stop_hours", value: "abc" }]), IDLE_DEFAULT_THRESHOLD_HOURS * 3_600_000);
  // Out of range falls back to default (never 0h, never unbounded).
  assert.strictEqual(resolveIdleThresholdMs([{ key: "idle_auto_stop_hours", value: "0" }]), IDLE_DEFAULT_THRESHOLD_HOURS * 3_600_000);
  assert.strictEqual(resolveIdleThresholdMs([{ key: "idle_auto_stop_hours", value: "9999" }]), IDLE_DEFAULT_THRESHOLD_HOURS * 3_600_000);
  assert.strictEqual(resolveIdleThresholdMs([{ key: "idle_auto_stop_hours", value: "1.25" }]), 4_500_000);
  assert.strictEqual(resolveIdleThresholdMs([{ key: "other_key", value: "2" }]), IDLE_DEFAULT_THRESHOLD_HOURS * 3_600_000);
});

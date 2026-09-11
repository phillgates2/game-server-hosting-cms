/**
 * Tests for scheduled maintenance windows (pure layer).
 *
 * The contract: phase math is boundary-exact, validation rejects backwards
 * or oversized windows, and never-applied windows can't retroactively flip
 * a node mid-window.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  windowPhase,
  validateMaintenanceWindowInput,
  MAINTENANCE_WINDOW_MAX_HOURS,
  MAINTENANCE_START_GRACE_MS,
} from "../src/lib/maintenance-windows";

const START = 1_700_000_000_000;
const END = START + 3_600_000; // 1h window

describe("windowPhase", () => {
  test("pending before start, active inside, expired after end", () => {
    assert.equal(windowPhase({ startsAtMs: START, endsAtMs: END }, START - 1), "pending");
    assert.equal(windowPhase({ startsAtMs: START, endsAtMs: END }, START + 1000), "active");
    assert.equal(windowPhase({ startsAtMs: START, endsAtMs: END }, END + 1), "expired");
  });

  test("boundaries: start instant is active, end instant is expired", () => {
    assert.equal(windowPhase({ startsAtMs: START, endsAtMs: END }, START), "active");
    assert.equal(windowPhase({ startsAtMs: START, endsAtMs: END }, END), "expired");
  });
});

describe("validateMaintenanceWindowInput", () => {
  const now = START;
  const body = (over: Record<string, unknown> = {}) => ({
    nodeId: 3,
    startsAt: new Date(START + 3_600_000).toISOString(),
    endsAt: new Date(START + 7_200_000).toISOString(),
    ...over,
  });

  test("accepts a valid future window and trims the reason", () => {
    const v = validateMaintenanceWindowInput(body({ reason: "  kernel upgrade  " }), now);
    assert.equal(v.ok, true);
    assert.equal(v.value?.nodeId, 3);
    assert.equal(v.value?.reason, "kernel upgrade");
  });

  test("rejects bad shapes and ids", () => {
    assert.equal(validateMaintenanceWindowInput(null, now).ok, false);
    assert.equal(validateMaintenanceWindowInput([], now).ok, false);
    assert.equal(validateMaintenanceWindowInput(body({ nodeId: 0 }), now).ok, false);
    assert.equal(validateMaintenanceWindowInput(body({ nodeId: "abc" }), now).ok, false);
  });

  test("rejects invalid dates", () => {
    assert.equal(validateMaintenanceWindowInput(body({ startsAt: "not-a-date" }), now).ok, false);
    assert.equal(validateMaintenanceWindowInput(body({ endsAt: 12345 }), now).ok, false);
  });

  test("rejects windows ending before they start", () => {
    const v = validateMaintenanceWindowInput(
      body({ startsAt: new Date(START + 7_200_000).toISOString(), endsAt: new Date(START + 3_600_000).toISOString() }),
      now
    );
    assert.equal(v.ok, false);
    assert.match(v.error ?? "", /after/);
  });

  test("rejects windows longer than the cap", () => {
    const v = validateMaintenanceWindowInput(
      body({ endsAt: new Date(START + 3_600_000 + MAINTENANCE_WINDOW_MAX_HOURS * 3_600_000 + 60_000).toISOString() }),
      now
    );
    assert.equal(v.ok, false);
    assert.match(v.error ?? "", /at most/);
  });

  test("allows the max length exactly", () => {
    const v = validateMaintenanceWindowInput(
      body({ endsAt: new Date(START + 3_600_000 + MAINTENANCE_WINDOW_MAX_HOURS * 3_600_000).toISOString() }),
      now
    );
    assert.equal(v.ok, true);
  });

  test("rejects starts deeper in the past than the grace window", () => {
    const v = validateMaintenanceWindowInput(
      body({
        startsAt: new Date(now - MAINTENANCE_START_GRACE_MS - 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
      }),
      now
    );
    assert.equal(v.ok, false);
  });

  test("allows a start inside the grace period (covers tick lag)", () => {
    const v = validateMaintenanceWindowInput(
      body({
        startsAt: new Date(now - MAINTENANCE_START_GRACE_MS + 60_000).toISOString(),
        endsAt: new Date(now + 3_600_000).toISOString(),
      }),
      now
    );
    assert.equal(v.ok, true);
  });
});

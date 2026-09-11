/**
 * Tests for alert mute windows.
 *
 * The mute must fail OPEN to alerting on garbage values — a corrupted
 * setting should never permanently silence host alerts.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isAlertMuted,
  clampMuteHours,
  muteUntilIso,
  describeRemainingMute,
  ALERT_MUTE_MAX_HOURS,
} from "../src/lib/alert-mute";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe("isAlertMuted", () => {
  test("covers the window, then releases", () => {
    assert.equal(isAlertMuted(new Date(NOW + HOUR).toISOString(), NOW), true);
    assert.equal(isAlertMuted(new Date(NOW - 1).toISOString(), NOW), false);
  });

  test("null/undefined/garbage all mean NOT muted (fail open)", () => {
    assert.equal(isAlertMuted(null, NOW), false);
    assert.equal(isAlertMuted(undefined, NOW), false);
    assert.equal(isAlertMuted("not-a-date", NOW), false);
  });
});

describe("clampMuteHours", () => {
  test("floors, caps and rejects junk", () => {
    assert.equal(clampMuteHours(4), 4);
    assert.equal(clampMuteHours(0.5), null);
    assert.equal(clampMuteHours(0), null);
    assert.equal(clampMuteHours(-3), null);
    assert.equal(clampMuteHours("abc"), null);
    assert.equal(clampMuteHours(999), ALERT_MUTE_MAX_HOURS);
    assert.equal(clampMuteHours(4.9), 4);
  });
});

describe("muteUntilIso + remaining", () => {
  test("round-trips through the window", () => {
    const until = muteUntilIso(4, NOW);
    assert.equal(isAlertMuted(until, NOW), true);
    assert.equal(isAlertMuted(until, NOW + 4 * HOUR + 1), false);
    const rem = describeRemainingMute(until, NOW);
    assert.match(rem ?? "", /^4h 0m$|^3h 59m$/);
  });

  test("no remaining label outside the window", () => {
    assert.equal(describeRemainingMute(null, NOW), null);
    assert.equal(describeRemainingMute(new Date(NOW - HOUR).toISOString(), NOW), null);
  });
});

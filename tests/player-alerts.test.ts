/**
 * Tests for player-count alerts (pure layer).
 *
 * The contract: alerts are edge-triggered (one fire per upward crossing,
 * re-arm below the threshold), unreachable probes never touch the armed
 * state, and thresholds are strictly validated.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlayerAlertThreshold,
  evaluatePlayerAlert,
  formatPlayerAlertMessage,
  PLAYER_ALERT_MAX_THRESHOLD,
} from "../src/lib/player-alerts";

describe("parsePlayerAlertThreshold", () => {
  test("accepts integers in range", () => {
    assert.equal(parsePlayerAlertThreshold(1), 1);
    assert.equal(parsePlayerAlertThreshold("24"), 24);
    assert.equal(parsePlayerAlertThreshold(PLAYER_ALERT_MAX_THRESHOLD), PLAYER_ALERT_MAX_THRESHOLD);
  });

  test("null / empty string disable the alert", () => {
    assert.equal(parsePlayerAlertThreshold(null), null);
    assert.equal(parsePlayerAlertThreshold(""), null);
    assert.equal(parsePlayerAlertThreshold(undefined), null);
  });

  test("rejects garbage, floats, zero and oversized values", () => {
    assert.equal(parsePlayerAlertThreshold("abc"), null);
    assert.equal(parsePlayerAlertThreshold(2.5), null);
    assert.equal(parsePlayerAlertThreshold(0), null);
    assert.equal(parsePlayerAlertThreshold(-3), null);
    assert.equal(parsePlayerAlertThreshold(PLAYER_ALERT_MAX_THRESHOLD + 1), null);
  });
});

describe("evaluatePlayerAlert", () => {
  test("fires once on the upward crossing", () => {
    const r = evaluatePlayerAlert({ threshold: 20, players: 20, wasAbove: false });
    assert.deepEqual(r, { fire: true, above: true });
  });

  test("does not re-fire while still above", () => {
    const r = evaluatePlayerAlert({ threshold: 20, players: 35, wasAbove: true });
    assert.deepEqual(r, { fire: false, above: true });
  });

  test("re-arms when the count drops below the threshold", () => {
    const drop = evaluatePlayerAlert({ threshold: 20, players: 19, wasAbove: true });
    assert.deepEqual(drop, { fire: false, above: false });
    const refire = evaluatePlayerAlert({ threshold: 20, players: 25, wasAbove: drop.above });
    assert.equal(refire.fire, true);
  });

  test("disabled threshold (null) never fires and keeps state", () => {
    assert.deepEqual(evaluatePlayerAlert({ threshold: null, players: 99, wasAbove: false }), { fire: false, above: false });
    assert.deepEqual(evaluatePlayerAlert({ threshold: null, players: 99, wasAbove: true }), { fire: false, above: true });
  });

  test("unreachable probe (null players) leaves the armed state untouched", () => {
    assert.deepEqual(evaluatePlayerAlert({ threshold: 20, players: null, wasAbove: false }), { fire: false, above: false });
    assert.deepEqual(evaluatePlayerAlert({ threshold: 20, players: null, wasAbove: true }), { fire: false, above: true });
  });

  test("exactly at the threshold counts as above", () => {
    assert.equal(evaluatePlayerAlert({ threshold: 5, players: 5, wasAbove: false }).fire, true);
    assert.equal(evaluatePlayerAlert({ threshold: 5, players: 4, wasAbove: false }).fire, false);
  });
});

describe("formatPlayerAlertMessage", () => {
  test("names the server and the counts", () => {
    const msg = formatPlayerAlertMessage("TF2 Casual #1", 24, 24);
    assert.match(msg, /TF2 Casual #1/);
    assert.match(msg, /24\/24/);
  });
});

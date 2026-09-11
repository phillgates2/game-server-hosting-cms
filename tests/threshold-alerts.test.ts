/**
 * Tests for the host threshold alerts.
 *
 * These decide when the panel pings Discord about the machine itself, so the
 * breach comparison and the one-alert-per-episode rule are pinned here — a
 * pegged host must alert once, not every check.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateThresholds,
  alertDecision,
  DEFAULT_ALERT_SUSTAINED,
  type ThresholdConfig,
} from "../src/lib/threshold-alerts";

const cfg: ThresholdConfig = { cpuPercent: 90, ramPercent: 90, diskPercent: 90, sustained: 3 };

describe("evaluateThresholds", () => {
  test("nothing breaches when everything is healthy", () => {
    const reading = { cpuPercent: 10, ramPercent: 40, diskPercent: 55 };
    assert.deepEqual(evaluateThresholds(reading, cfg), []);
  });

  test("exactly at a threshold is NOT a breach (strict >)", () => {
    const reading = { cpuPercent: 90, ramPercent: 90, diskPercent: 90 };
    assert.deepEqual(evaluateThresholds(reading, cfg), []);
  });

  test("a threshold of 0 disables that check", () => {
    const off: ThresholdConfig = { cpuPercent: 0, ramPercent: 0, diskPercent: 0, sustained: 3 };
    const reading = { cpuPercent: 100, ramPercent: 100, diskPercent: 100 };
    assert.deepEqual(evaluateThresholds(reading, off), []);
  });

  test("a null reading never breaches — a missing metric is not an emergency", () => {
    const reading = { cpuPercent: null, ramPercent: null, diskPercent: null };
    assert.deepEqual(evaluateThresholds(reading, cfg), []);
  });

  test("each breached threshold is reported with its numbers", () => {
    const reading = { cpuPercent: 99, ramPercent: 95, diskPercent: 50 };
    const breaches = evaluateThresholds(reading, cfg);
    assert.equal(breaches.length, 2);
    assert.match(breaches[0], /CPU 99%/);
    assert.match(breaches[1], /RAM 95%/);
  });

  test("all three can breach at once", () => {
    const reading = { cpuPercent: 99, ramPercent: 99, diskPercent: 99 };
    assert.equal(evaluateThresholds(reading, cfg).length, 3);
  });
});

describe("alertDecision", () => {
  const idle = { strikes: 0, alerted: false };

  test("below the sustained count: no fire, but strikes accumulate", () => {
    const d = alertDecision(idle, true, 3);
    assert.equal(d.fire, false);
    assert.equal(d.episode.strikes, 1);
  });

  test("fires exactly when the sustained count is reached", () => {
    let ep = idle;
    let fired = 0;
    for (let i = 0; i < 3; i++) {
      const d = alertDecision(ep, true, 3);
      ep = d.episode;
      if (d.fire) fired++;
    }
    assert.equal(fired, 1, "fires once, on the third consecutive breach");
  });

  test("does NOT re-fire while the episode continues", () => {
    let ep = idle;
    for (let i = 0; i < 3; i++) ep = alertDecision(ep, true, 3).episode; // reaches alerted
    for (let i = 0; i < 5; i++) {
      const d = alertDecision(ep, true, 3);
      ep = d.episode;
      assert.equal(d.fire, false, "a pegged host must not spam");
    }
    assert.equal(ep.alerted, true);
  });

  test("a clean reading closes the episode and re-arms", () => {
    let ep = idle;
    for (let i = 0; i < 3; i++) ep = alertDecision(ep, true, 3).episode; // fired
    ep = alertDecision(ep, false, 3).episode; // recovered
    assert.deepEqual(ep, { strikes: 0, alerted: false });
    // A fresh episode can fire again.
    let fired = false;
    for (let i = 0; i < 3; i++) {
      const d = alertDecision(ep, true, 3);
      ep = d.episode;
      fired = fired || d.fire;
    }
    assert.equal(fired, true);
  });

  test("interrupted breaches do not fire", () => {
    let ep = idle;
    // breach, breach, clean, breach, breach, clean … never reaches 3 in a row
    const seq = [true, true, false, true, true, false, true, true];
    for (const b of seq) {
      const d = alertDecision(ep, b, 3);
      ep = d.episode;
      assert.equal(d.fire, false);
    }
  });

  test("default sustained count is 3", () => {
    assert.equal(DEFAULT_ALERT_SUSTAINED, 3);
    let ep = idle;
    let fired = 0;
    for (let i = 0; i < DEFAULT_ALERT_SUSTAINED; i++) {
      const d = alertDecision(ep, true);
      ep = d.episode;
      if (d.fire) fired++;
    }
    assert.equal(fired, 1);
  });
});

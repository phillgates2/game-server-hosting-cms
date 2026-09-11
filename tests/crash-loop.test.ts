/**
 * Tests for the crash-loop breaker.
 *
 * Auto-restart is a feature until the server crashes on boot — then it is a
 * restart-spam loop. These pin the boundary where the breaker trips so a
 * flapping server stops at a predictable crash count instead of forever.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  windowedCrashes,
  isCrashLooping,
  CRASH_LOOP_MAX,
  CRASH_LOOP_WINDOW_MS,
} from "../src/lib/server-lifecycle";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const MIN = 60_000;

describe("windowedCrashes", () => {
  test("drops crashes older than the window", () => {
    const ts = [NOW - 30 * MIN, NOW - 11 * MIN, NOW - 5 * MIN, NOW - 1 * MIN];
    assert.deepEqual(windowedCrashes(ts, NOW), [NOW - 5 * MIN, NOW - 1 * MIN]);
  });

  test("a crash exactly on the window edge is still inside", () => {
    const ts = [NOW - CRASH_LOOP_WINDOW_MS];
    assert.deepEqual(windowedCrashes(ts, NOW), ts);
  });

  test("empty history stays empty", () => {
    assert.deepEqual(windowedCrashes([], NOW), []);
  });
});

describe("isCrashLooping", () => {
  test("does not trip below the threshold", () => {
    const ts = [NOW - 4 * MIN, NOW - 2 * MIN]; // two crashes in ten minutes
    assert.equal(isCrashLooping(ts, NOW), false);
  });

  test("trips at exactly CRASH_LOOP_MAX crashes inside the window", () => {
    const ts = Array.from({ length: CRASH_LOOP_MAX }, (_, i) => NOW - (i + 1) * MIN);
    assert.equal(isCrashLooping(ts, NOW), true);
  });

  test("old crashes do not count toward the threshold", () => {
    const ts = [
      NOW - 60 * MIN,
      NOW - 50 * MIN,
      NOW - 40 * MIN, // all outside the ten-minute window
      NOW - 2 * MIN,
    ];
    assert.equal(isCrashLooping(ts, NOW), false);
  });

  test("defaults are sane: a handful of crashes within ten minutes", () => {
    assert.equal(CRASH_LOOP_MAX, 3);
    assert.equal(CRASH_LOOP_WINDOW_MS, 10 * MIN);
  });

  test("custom thresholds are honoured", () => {
    const ts = [NOW - 1_000, NOW - 500];
    assert.equal(isCrashLooping(ts, NOW, 2, 60_000), true);
    assert.equal(isCrashLooping(ts, NOW, 5, 60_000), false);
  });
});

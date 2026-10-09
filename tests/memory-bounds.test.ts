/**
 * Regression tests for the in-process state that used to grow without bound.
 *
 * Each of these maps lives for the whole life of the panel process. Before the
 * fix, entries were only removed on a lucky read (or never), so a panel that
 * saw many distinct clients or tokens kept all of them resident. The tests
 * drive a large number of distinct keys through, let time pass, and check that
 * memory tracks the active set rather than the total ever seen.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WriteThrottle } from "../src/lib/write-throttle";
import { oncePerProcess } from "../src/lib/once-per-process";
import {
  publicThrottleAllowed,
  publicThrottleSize,
  resetPublicThrottle,
  PUBLIC_THROTTLE_MAX,
  PUBLIC_THROTTLE_WINDOW_MS,
} from "../src/lib/public-throttle";
import { setCachedView, statusCacheSize, clearStatusCache, STATUS_CACHE_MS } from "../src/lib/status-cache";
import type { BoardView } from "../src/lib/status-board-embed";

const T0 = Date.parse("2026-10-01T00:00:00Z");
const view = {} as BoardView;

describe("WriteThrottle", () => {
  test("allows the first write and blocks until the interval elapses", () => {
    const t = new WriteThrottle(1_000);
    assert.equal(t.shouldWrite("a", T0), true);
    assert.equal(t.shouldWrite("a", T0 + 999), false);
    assert.equal(t.shouldWrite("a", T0 + 1_000), true);
  });

  test("keys are independent", () => {
    const t = new WriteThrottle(1_000);
    assert.equal(t.shouldWrite("a", T0), true);
    assert.equal(t.shouldWrite("b", T0), true);
  });

  test("entries expire, so memory tracks active keys not every key ever seen", () => {
    const t = new WriteThrottle(1_000);
    for (let i = 0; i < 50_000; i++) t.shouldWrite(`token-${i}`, T0);
    assert.equal(t.size(), 50_000);
    // A later write from one key, after the interval, sweeps the stale rest.
    t.shouldWrite("fresh", T0 + 5_000);
    assert.equal(t.size(), 1);
  });

  test("forget drops a key immediately", () => {
    const t = new WriteThrottle(60_000);
    t.shouldWrite("server-1", T0);
    t.forget("server-1");
    assert.equal(t.shouldWrite("server-1", T0 + 1), true);
  });
});

describe("publicThrottle memory", () => {
  test("expired client keys are swept instead of accumulating", () => {
    resetPublicThrottle();
    for (let i = 0; i < 20_000; i++) publicThrottleAllowed(`ip-${i}`, T0);
    assert.equal(publicThrottleSize(), 20_000);

    // Well past every window: the next call sweeps the lot and keeps only itself.
    publicThrottleAllowed("late", T0 + PUBLIC_THROTTLE_WINDOW_MS * 10);
    assert.equal(publicThrottleSize(), 1);
  });

  test("sweeping does not weaken the limit for a key that is still active", () => {
    resetPublicThrottle();
    const now = T0;
    for (let i = 0; i < PUBLIC_THROTTLE_MAX; i++) {
      assert.equal(publicThrottleAllowed("busy", now + i), true);
    }
    // Force a sweep from an unrelated key well inside the window...
    publicThrottleAllowed("other", now + PUBLIC_THROTTLE_WINDOW_MS - 1);
    // ...the busy key's hits are still inside the window, so it stays limited.
    assert.equal(publicThrottleAllowed("busy", now + PUBLIC_THROTTLE_MAX), false);
  });
});

describe("oncePerProcess", () => {
  test("runs the step once for many calls", async () => {
    let runs = 0;
    const ensure = oncePerProcess(async () => {
      runs += 1;
    });
    await Promise.all([ensure(), ensure(), ensure()]);
    await ensure();
    assert.equal(runs, 1);
  });

  test("a failed step is retried on the next call", async () => {
    let runs = 0;
    const ensure = oncePerProcess(async () => {
      runs += 1;
      if (runs === 1) throw new Error("db not ready");
    });
    await assert.rejects(ensure(), /db not ready/);
    await ensure();
    await ensure();
    assert.equal(runs, 2);
  });
});

describe("status cache memory", () => {
  test("stale entries are evicted on write, not only when read", () => {
    clearStatusCache();
    for (let i = 0; i < 1_000; i++) setCachedView(i, view, T0);
    assert.equal(statusCacheSize(), 1_000);
    setCachedView(9_999, view, T0 + STATUS_CACHE_MS + 1);
    assert.equal(statusCacheSize(), 1);
  });
});

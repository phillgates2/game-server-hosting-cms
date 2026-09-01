/**
 * Tests for the three-minute server-status cache.
 *
 * The original WolfET bot kept `server_cache` so `!etwho` inside three
 * minutes did not re-query the game (and so the board loop and the chat bot
 * share one probe per window). This module is that cache.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_CACHE_MS,
  setCachedView,
  getCachedView,
  isCacheFresh,
  clearStatusCache,
  statusCacheSize,
} from "../src/lib/status-cache";

const VIEW = { serverName: "S", gameName: "ET", address: "`a:1`", online: true, players: 3 };

describe("status cache", () => {
  test("fresh within three minutes, expired after", () => {
    clearStatusCache();
    setCachedView(1, VIEW, 0);
    assert.deepEqual(getCachedView(1, 1), VIEW, "immediately fresh");
    assert.equal(isCacheFresh(1, STATUS_CACHE_MS - 1), true, "just inside the window");
    assert.equal(getCachedView(1, STATUS_CACHE_MS + 1), null, "expired");
    assert.equal(statusCacheSize(), 0, "expired entry is evicted");
  });

  test("is per-server and does not leak from one server to another", () => {
    clearStatusCache();
    setCachedView(1, VIEW, 0);
    assert.equal(getCachedView(2, 0), null);
  });

  test("can be cleared", () => {
    clearStatusCache();
    setCachedView(1, VIEW, 0);
    clearStatusCache();
    assert.equal(statusCacheSize(), 0);
  });
});

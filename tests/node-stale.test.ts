/**
 * Tests for the stale-node rule.
 *
 * A remote node that stops heartbeating must be shown as offline; a node
 * never seen (null) must not be treated as stale on that basis alone.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isNodeStale, NODE_STALE_MS } from "../src/lib/server-lifecycle";

const NOW = new Date("2026-09-11T12:00:00Z");

describe("isNodeStale", () => {
  test("a fresh heartbeat is not stale", () => {
    assert.equal(isNodeStale(new Date(NOW.getTime() - 30_000), NOW), false);
  });

  test("a heartbeat older than the window is stale", () => {
    assert.equal(isNodeStale(new Date(NOW.getTime() - NODE_STALE_MS - 1), NOW), true);
  });

  test("exactly on the window edge is still considered alive", () => {
    assert.equal(isNodeStale(new Date(NOW.getTime() - NODE_STALE_MS), NOW), false);
  });

  test("null (never heartbeated) is NOT stale — creation ≠ death", () => {
    assert.equal(isNodeStale(null, NOW), false);
  });

  test("the window is three minutes", () => {
    assert.equal(NODE_STALE_MS, 3 * 60_000);
  });
});

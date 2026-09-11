/**
 * Tests for the anonymous-endpoint throttle.
 *
 * The public status surface triggers real UDP probes of the operator's own
 * servers, so the request cap is a protection worth pinning: it must allow a
 * burst of legitimate refreshes and then stop a hammer cold, per client.
 *
 *   npm test
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  publicThrottleAllowed,
  resetPublicThrottle,
  PUBLIC_THROTTLE_MAX,
  PUBLIC_THROTTLE_WINDOW_MS,
} from "../src/lib/public-throttle";

const NOW = Date.parse("2026-09-11T00:00:00Z");

describe("publicThrottleAllowed", () => {
  beforeEach(() => resetPublicThrottle());

  test("allows up to the limit inside the window", () => {
    for (let i = 0; i < PUBLIC_THROTTLE_MAX; i++) {
      assert.equal(publicThrottleAllowed("a", NOW + i), true, `request ${i + 1} should pass`);
    }
  });

  test("blocks once the limit is reached", () => {
    for (let i = 0; i < PUBLIC_THROTTLE_MAX; i++) publicThrottleAllowed("a", NOW + i);
    assert.equal(publicThrottleAllowed("a", NOW + PUBLIC_THROTTLE_MAX), false);
    assert.equal(publicThrottleAllowed("a", NOW + PUBLIC_THROTTLE_MAX + 1), false);
  });

  test("the window slides: old requests expire", () => {
    for (let i = 0; i < PUBLIC_THROTTLE_MAX; i++) publicThrottleAllowed("a", NOW);
    // One full window later every one of them has expired.
    assert.equal(publicThrottleAllowed("a", NOW + PUBLIC_THROTTLE_WINDOW_MS + 1), true);
  });

  test("keys are independent — one hammering client does not block the rest", () => {
    for (let i = 0; i < PUBLIC_THROTTLE_MAX; i++) publicThrottleAllowed("abuser", NOW);
    assert.equal(publicThrottleAllowed("abuser", NOW), false);
    assert.equal(publicThrottleAllowed("someone-else", NOW), true);
  });

  test("blocked requests do not extend the punishment", () => {
    for (let i = 0; i < PUBLIC_THROTTLE_MAX; i++) publicThrottleAllowed("a", NOW);
    // Hammer through the blocked region…
    for (let i = 1; i <= 10; i++) publicThrottleAllowed("a", NOW + i);
    // …and recover exactly one window after the LAST ALLOWED request.
    assert.equal(publicThrottleAllowed("a", NOW + PUBLIC_THROTTLE_WINDOW_MS + 1), true);
  });

  test("custom limits are honoured", () => {
    assert.equal(publicThrottleAllowed("b", NOW, 2, 1000), true);
    assert.equal(publicThrottleAllowed("b", NOW + 1, 2, 1000), true);
    assert.equal(publicThrottleAllowed("b", NOW + 2, 2, 1000), false);
  });

  test("defaults are sane for a 60s auto-refreshing page", () => {
    // A well-behaved page refreshes once a minute; 30/min leaves headroom
    // for a few curious reloads without letting a script hammer.
    assert.equal(PUBLIC_THROTTLE_MAX, 30);
    assert.equal(PUBLIC_THROTTLE_WINDOW_MS, 60_000);
  });
});

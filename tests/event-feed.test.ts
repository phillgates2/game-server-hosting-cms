/**
 * Tests for the fleet incident feed's window clamping.
 *
 * The endpoint accepts a caller-supplied `hours` param; these rules stop a
 * crafted value from forcing a full-table scan window.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampFeedHours,
  FEED_DEFAULT_HOURS,
  FEED_MAX_HOURS,
} from "../src/lib/event-feed";

describe("clampFeedHours", () => {
  test("defaults when the param is missing or blank", () => {
    assert.equal(clampFeedHours(null), FEED_DEFAULT_HOURS);
    assert.equal(clampFeedHours(undefined), FEED_DEFAULT_HOURS);
    assert.equal(clampFeedHours(""), FEED_DEFAULT_HOURS);
    assert.equal(clampFeedHours("   "), FEED_DEFAULT_HOURS);
  });

  test("passes through sane values", () => {
    assert.equal(clampFeedHours("1"), 1);
    assert.equal(clampFeedHours("6"), 6);
    assert.equal(clampFeedHours("24"), 24);
    assert.equal(clampFeedHours(String(FEED_MAX_HOURS)), FEED_MAX_HOURS);
  });

  test("clamps below the floor and above the ceiling", () => {
    assert.equal(clampFeedHours("0"), 1);
    assert.equal(clampFeedHours("-24"), 1);
    assert.equal(clampFeedHours("99999"), FEED_MAX_HOURS);
  });

  test("rejects junk by falling back to the default", () => {
    assert.equal(clampFeedHours("abc"), FEED_DEFAULT_HOURS);
    assert.equal(clampFeedHours("12x"), FEED_DEFAULT_HOURS);
    assert.equal(clampFeedHours("NaN"), FEED_DEFAULT_HOURS);
    assert.equal(clampFeedHours("Infinity"), FEED_DEFAULT_HOURS);
  });

  test("floors fractional values", () => {
    assert.equal(clampFeedHours("2.9"), 2);
    assert.equal(clampFeedHours("23.5"), 23);
  });
});

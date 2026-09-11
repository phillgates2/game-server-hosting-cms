/**
 * Tests for key hygiene math: age, staleness and expiry nudges.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ageDays,
  daysUntilExpiry,
  isKeyStale,
  keyVerdict,
  STALE_UNUSED_DAYS,
  STALE_NEVER_USED_DAYS,
  EXPIRY_WARNING_DAYS,
} from "../src/lib/key-hygiene";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe("ageDays / daysUntilExpiry", () => {
  test("whole-day math, clamped at zero", () => {
    assert.equal(ageDays(NOW - 3 * DAY, NOW), 3);
    assert.equal(ageDays(NOW + DAY, NOW), 0);
    assert.equal(daysUntilExpiry(NOW + 5 * DAY, NOW), 5);
    assert.equal(daysUntilExpiry(null, NOW), null);
    assert.equal(daysUntilExpiry("garbage", NOW), null);
  });
});

describe("isKeyStale", () => {
  test("never used: stale once older than the never-used window", () => {
    const usage = { createdAt: NOW - (STALE_NEVER_USED_DAYS + 1) * DAY, lastUsedAt: null };
    assert.equal(isKeyStale(usage, NOW), true);
    assert.equal(isKeyStale({ createdAt: NOW - 5 * DAY, lastUsedAt: null }, NOW), false);
  });

  test("used keys go stale after the unused window", () => {
    const usage = { createdAt: NOW - 300 * DAY, lastUsedAt: NOW - (STALE_UNUSED_DAYS + 1) * DAY };
    assert.equal(isKeyStale(usage, NOW), true);
    assert.equal(isKeyStale({ ...usage, lastUsedAt: NOW - 2 * DAY }, NOW), false);
  });

  test("unreadable last-used stamps fail safe to stale", () => {
    assert.equal(isKeyStale({ createdAt: NOW - DAY, lastUsedAt: "not-a-date" }, NOW), true);
  });
});

describe("keyVerdict", () => {
  test("expired beats everything", () => {
    const v = keyVerdict({ createdAt: NOW - DAY, lastUsedAt: NOW, expiresAt: NOW - DAY }, NOW);
    assert.deepEqual(v, { tone: "danger", label: "expired" });
  });

  test("expiring soon warns", () => {
    const v = keyVerdict({ createdAt: NOW - DAY, lastUsedAt: NOW, expiresAt: NOW + 3 * DAY }, NOW);
    assert.equal(v.tone, "warn");
    assert.match(v.label, /expires in/);
  });

  test(`warning window is ${EXPIRY_WARNING_DAYS} days`, () => {
    assert.equal(keyVerdict({ createdAt: NOW, lastUsedAt: NOW, expiresAt: NOW + (EXPIRY_WARNING_DAYS + 1) * DAY }, NOW).tone, "ok");
  });

  test("forgotten keys are called out", () => {
    const v = keyVerdict({ createdAt: NOW - 45 * DAY, lastUsedAt: null }, NOW);
    assert.equal(v.tone, "warn");
    assert.match(v.label, /never used/);
  });

  test("healthy keys stay green", () => {
    const v = keyVerdict({ createdAt: NOW - 10 * DAY, lastUsedAt: NOW - DAY, expiresAt: null }, NOW);
    assert.deepEqual(v, { tone: "ok", label: "healthy" });
  });
});

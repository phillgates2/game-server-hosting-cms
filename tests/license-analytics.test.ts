/**
 * Tests for license usage analytics (pure layer).
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyActivationHealth,
  classifyKeyHealth,
  summarizeLicenseFleet,
  formatFleetUsageLine,
  LICENSE_ACTIVE_WINDOW_DAYS,
  LICENSE_SILENT_WINDOW_DAYS,
} from "../src/lib/license-analytics";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe("classifyActivationHealth", () => {
  test("recently seen is active, with boundary at the active window edge", () => {
    assert.equal(classifyActivationHealth(NOW - 1000, NOW), "active");
    assert.equal(classifyActivationHealth(NOW - LICENSE_ACTIVE_WINDOW_DAYS * DAY, NOW), "active");
    assert.equal(classifyActivationHealth(NOW - LICENSE_ACTIVE_WINDOW_DAYS * DAY - 1, NOW), "silent");
  });

  test("silent window boundary", () => {
    assert.equal(classifyActivationHealth(NOW - LICENSE_SILENT_WINDOW_DAYS * DAY, NOW), "silent");
    assert.equal(classifyActivationHealth(NOW - LICENSE_SILENT_WINDOW_DAYS * DAY - 1, NOW), "dark");
  });

  test("never-seen and clock skew", () => {
    assert.equal(classifyActivationHealth(null, NOW), "never");
    assert.equal(classifyActivationHealth(NOW + 5000, NOW), "active"); // future = skew, treat as recent
  });
});

describe("classifyKeyHealth", () => {
  const base = {
    keyId: 1, label: null, prefix: "GSM-LIC-abc…", revoked: false, expired: false,
    maxActivations: 1, activationCount: 0, lastSeenMs: null,
  };

  test("no activations = never, regardless of revocation", () => {
    assert.equal(classifyKeyHealth(base, NOW), "never");
  });

  test("any live activation makes the key active", () => {
    assert.equal(classifyKeyHealth({ ...base, activationCount: 3, lastSeenMs: NOW - 1000 }, NOW), "active");
    assert.equal(classifyKeyHealth({ ...base, activationCount: 1, lastSeenMs: NOW - 20 * DAY }, NOW), "silent");
    assert.equal(classifyKeyHealth({ ...base, activationCount: 1, lastSeenMs: NOW - 90 * DAY }, NOW), "dark");
  });
});

describe("summarizeLicenseFleet", () => {
  test("counts keys by health and activations", () => {
    const keys = [
      { keyId: 1, label: null, prefix: "a", revoked: false, expired: false, maxActivations: 2, activationCount: 2, lastSeenMs: NOW - 1000 },
      { keyId: 2, label: null, prefix: "b", revoked: true, expired: false, maxActivations: 1, activationCount: 1, lastSeenMs: NOW - 10 * DAY },
      { keyId: 3, label: null, prefix: "c", revoked: false, expired: false, maxActivations: 1, activationCount: 0, lastSeenMs: null },
      { keyId: 4, label: null, prefix: "d", revoked: false, expired: false, maxActivations: 1, activationCount: 1, lastSeenMs: NOW - 90 * DAY },
    ];
    const s = summarizeLicenseFleet(keys, ["active", "active", "silent"], NOW);
    assert.equal(s.totalKeys, 4);
    assert.equal(s.revokedKeys, 1);
    assert.equal(s.unusedKeys, 1);
    assert.equal(s.activeKeys, 1);
    assert.equal(s.silentKeys, 1);
    assert.equal(s.darkKeys, 1);
    assert.equal(s.totalActivations, 3);
    assert.equal(s.activeActivations, 2);
  });
});

describe("formatFleetUsageLine", () => {
  test("mentions active keys and phone-home ratio", () => {
    const line = formatFleetUsageLine({
      totalKeys: 10, revokedKeys: 1, unusedKeys: 2, activeKeys: 5, silentKeys: 1, darkKeys: 1,
      totalActivations: 8, activeActivations: 6,
    });
    assert.match(line, /5 active \/ 10 keys/);
    assert.match(line, /6\/8 installs phoned home/);
  });
});

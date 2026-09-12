/**
 * Tests for the license heartbeat state machine.
 *
 * The contract: explicit rejections lock immediately; unreachability starts
 * a grace window and only locks once it expires; any healthy check clears
 * the failure streak entirely.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLicenseHeartbeat,
  licenseStateBanner,
  LICENSE_GRACE_HOURS,
} from "../src/lib/license-heartbeat";

const NOW = 1_700_000_000_000;
const GRACE = LICENSE_GRACE_HOURS * 3_600_000;

describe("evaluateLicenseHeartbeat", () => {
  test("healthy verdict clears everything", () => {
    const r = evaluateLicenseHeartbeat({ verdict: "ok", invalidSinceMs: NOW - 999_999, nowMs: NOW, graceMs: GRACE });
    assert.deepEqual(r, { state: "ok", invalidSinceMs: null });
  });

  test("explicit rejection locks immediately, no grace", () => {
    const r = evaluateLicenseHeartbeat({ verdict: "rejected", invalidSinceMs: null, nowMs: NOW, graceMs: GRACE });
    assert.equal(r.state, "locked");
    assert.equal(r.invalidSinceMs, NOW);
  });

  test("first unreachable result starts the grace window (not locked)", () => {
    const r = evaluateLicenseHeartbeat({ verdict: "unreachable", invalidSinceMs: null, nowMs: NOW, graceMs: GRACE });
    assert.equal(r.state, "grace");
    assert.equal(r.invalidSinceMs, NOW);
  });

  test("unreachable inside the grace window stays grace and keeps the original start", () => {
    const since = NOW - (GRACE - 3_600_000); // 1h left
    const r = evaluateLicenseHeartbeat({ verdict: "unreachable", invalidSinceMs: since, nowMs: NOW, graceMs: GRACE });
    assert.equal(r.state, "grace");
    assert.equal(r.invalidSinceMs, since); // streak start never moves
  });

  test("unreachable once the grace window expires locks", () => {
    const since = NOW - GRACE;
    const r = evaluateLicenseHeartbeat({ verdict: "unreachable", invalidSinceMs: since, nowMs: NOW, graceMs: GRACE });
    assert.equal(r.state, "locked");
  });

  test("recovery mid-grace clears the streak", () => {
    const r = evaluateLicenseHeartbeat({ verdict: "ok", invalidSinceMs: NOW - 1000, nowMs: NOW, graceMs: GRACE });
    assert.equal(r.state, "ok");
    assert.equal(r.invalidSinceMs, null);
  });
});

describe("licenseStateBanner", () => {
  test("no banner when healthy", () => {
    assert.equal(licenseStateBanner({ state: "ok", code: null, message: null, invalidSinceMs: null, graceMs: GRACE, nowMs: NOW }), null);
  });

  test("locked banner names the code and the recovery path", () => {
    const b = licenseStateBanner({ state: "locked", code: "revoked", message: null, invalidSinceMs: NOW, graceMs: GRACE, nowMs: NOW });
    assert.match(b ?? "", /revoked/);
    assert.match(b ?? "", /GSM_LICENSE_MODE=master/);
  });

  test("grace banner shows remaining hours, decreasing over time", () => {
    const early = licenseStateBanner({ state: "grace", code: null, message: null, invalidSinceMs: NOW, graceMs: GRACE, nowMs: NOW });
    assert.match(early ?? "", /~72h/);
    const late = licenseStateBanner({ state: "grace", code: null, message: null, invalidSinceMs: NOW - 70 * 3_600_000, graceMs: GRACE, nowMs: NOW });
    assert.match(late ?? "", /~2h/);
  });
});

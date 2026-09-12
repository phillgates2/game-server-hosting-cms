/**
 * Tests for license expiry sweep selection + notice formatting.
 *
 * The contract: one notice per expiry instant (renewals re-arm exactly one
 * new notice), future expiries untouched, messages distinguish kinds.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findNewlyExpiredKeys, formatLicenseNotice } from "../src/lib/license-expiry";

const NOW = 1_700_000_000_000;

const key = (over: Partial<ReturnType<typeof base>> & Record<string, unknown> = {}) => ({ ...base(), ...over });
function base() {
  return { id: 1, keyPrefix: "GSM-LIC-abc…", label: null as string | null, expiresAtMs: NOW - 1000, expiryNotifiedAtMs: null as number | null };
}

describe("findNewlyExpiredKeys", () => {
  test("expired-and-never-notified is eligible", () => {
    const found = findNewlyExpiredKeys([key()], NOW);
    assert.equal(found.length, 1);
  });

  test("future expiries are untouched", () => {
    const found = findNewlyExpiredKeys([key({ expiresAtMs: NOW + 1000 })], NOW);
    assert.equal(found.length, 0);
  });

  test("already-notified-for-THIS-expiry is not re-notified", () => {
    const found = findNewlyExpiredKeys([key({ expiryNotifiedAtMs: NOW - 500 })], NOW);
    assert.equal(found.length, 0);
  });

  test("a renewal re-arms exactly one new notice", () => {
    // notified at T1 for the old expiry; expiresAt extended past T1 and lapsed again
    const notifiedAt = NOW - 100_000;
    const renewed = key({ expiresAtMs: NOW - 1000, expiryNotifiedAtMs: notifiedAt });
    assert.equal(findNewlyExpiredKeys([renewed], NOW).length, 1);
    // ...but once notified for the new expiry, silence again
    const done = key({ expiresAtMs: NOW - 1000, expiryNotifiedAtMs: NOW - 10 });
    assert.equal(findNewlyExpiredKeys([done], NOW).length, 0);
  });

  test("mixed fleet returns only the eligible ones", () => {
    const fleet = [
      key({ id: 1 }),
      key({ id: 2, expiresAtMs: NOW + 5000 }),
      key({ id: 3, expiryNotifiedAtMs: NOW - 5 }),
      key({ id: 4, expiresAtMs: NOW - 2000, expiryNotifiedAtMs: NOW - 500_000 }), // old notice predates the lapse
    ];
    const ids = findNewlyExpiredKeys(fleet, NOW).map((k) => k.id);
    assert.deepEqual(ids, [1, 4]);
  });
});

describe("formatLicenseNotice", () => {
  test("revoked and expired are distinct and name the key", () => {
    const r = formatLicenseNotice("revoked", "GSM-LIC-abc…", "Acme");
    assert.match(r, /REVOKED/);
    assert.match(r, /Acme/);
    assert.match(r, /GSM-LIC-abc…/);
    const x = formatLicenseNotice("expired", "GSM-LIC-abc…", null);
    assert.match(x, /EXPIRED/);
    assert.doesNotMatch(x, /REVOKED/);
  });
});

/**
 * Tests for the licensing core (pure layer).
 *
 * The contract: key format is strict, the verdict logic is exact (revoked >
 * expired > cap, same-fingerprint always re-validates), and clamp/labels
 * behave.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isValidLicenseKeyFormat,
  licenseKeyDisplayLabel,
  decideLicenseCheck,
  licenseCheckMessage,
  clampMaxActivations,
  generateLicenseKey,
  hashLicenseKey,
  safeEqualHex,
  licenseFingerprint,
  LICENSE_DEFAULT_MAX_ACTIVATIONS,
  LICENSE_MAX_ACTIVATIONS_CAP,
} from "../src/lib/licensing";

const VALID = "GSM-LIC-1a2b3-4c5d6-7e8f9-0a1b2-3c4d5";

describe("isValidLicenseKeyFormat", () => {
  test("accepts the canonical shape", () => {
    assert.equal(isValidLicenseKeyFormat(VALID), true);
    assert.equal(isValidLicenseKeyFormat(`  ${VALID}  `), true);
    assert.equal(isValidLicenseKeyFormat(VALID.toUpperCase()), true);
  });

  test("rejects near-misses", () => {
    assert.equal(isValidLicenseKeyFormat("GSM-LIC-1a2b3-4c5d6-7e8f9-0a1b2"), false); // 4 groups
    assert.equal(isValidLicenseKeyFormat("GSM-LIC-1a2b3-4c5d6-7e8f9-0a1b2-3c4d5-6e7f8"), false); // 6 groups
    assert.equal(isValidLicenseKeyFormat("GSM-LIC-1a2b-4c5d6-7e8f9-0a1b2-3c4d5"), false); // short group
    assert.equal(isValidLicenseKeyFormat("GSM-KEY-1a2b3-4c5d6-7e8f9-0a1b2-3c4d5"), false); // wrong prefix
    assert.equal(isValidLicenseKeyFormat("GSM-LIC-1a2bz-4c5d6-7e8f9-0a1b2-3c4d5"), false); // non-hex
    assert.equal(isValidLicenseKeyFormat(""), false);
    assert.equal(isValidLicenseKeyFormat(null), false);
    assert.equal(isValidLicenseKeyFormat(42), false);
  });
});

describe("licenseKeyDisplayLabel", () => {
  test("shows only the first group", () => {
    assert.equal(licenseKeyDisplayLabel(VALID), "GSM-LIC-1a2b3…");
  });
});

describe("decideLicenseCheck", () => {
  const base = {
    keyFound: true,
    revoked: false,
    expired: false,
    activeActivations: 0,
    maxActivations: 1,
    sameFingerprintActive: false,
  };

  test("fresh valid key passes and records nothing special", () => {
    assert.equal(decideLicenseCheck(base), "ok");
  });

  test("unknown key is invalid", () => {
    assert.equal(decideLicenseCheck({ ...base, keyFound: false }), "invalid");
  });

  test("revoked beats everything", () => {
    assert.equal(decideLicenseCheck({ ...base, revoked: true, sameFingerprintActive: true }), "revoked");
  });

  test("expired key refused even from a known machine", () => {
    assert.equal(decideLicenseCheck({ ...base, expired: true, sameFingerprintActive: true }), "expired");
  });

  test("activation cap enforced", () => {
    assert.equal(decideLicenseCheck({ ...base, activeActivations: 1, maxActivations: 1 }), "limit-reached");
    assert.equal(decideLicenseCheck({ ...base, activeActivations: 1, maxActivations: 2 }), "ok");
  });

  test("same-fingerprint re-validation is ALWAYS allowed (never consumes a slot)", () => {
    assert.equal(decideLicenseCheck({ ...base, activeActivations: 5, maxActivations: 1, sameFingerprintActive: true }), "ok");
  });
});

describe("licenseCheckMessage", () => {
  test("every code gets a distinct human message", () => {
    assert.match(licenseCheckMessage("ok"), /accepted/);
    assert.match(licenseCheckMessage("invalid"), /Invalid/);
    assert.match(licenseCheckMessage("revoked"), /revoked/);
    assert.match(licenseCheckMessage("expired"), /expired/);
    assert.match(licenseCheckMessage("limit-reached"), /activation limit/);
  });
});

describe("clampMaxActivations", () => {
  test("defaults, floors and caps", () => {
    assert.equal(clampMaxActivations(undefined), LICENSE_DEFAULT_MAX_ACTIVATIONS);
    assert.equal(clampMaxActivations("abc"), LICENSE_DEFAULT_MAX_ACTIVATIONS);
    assert.equal(clampMaxActivations(0), LICENSE_DEFAULT_MAX_ACTIVATIONS);
    assert.equal(clampMaxActivations(3), 3);
    assert.equal(clampMaxActivations(9999), LICENSE_MAX_ACTIVATIONS_CAP);
    assert.equal(clampMaxActivations(2.5), LICENSE_DEFAULT_MAX_ACTIVATIONS);
  });
});

describe("crypto helpers", () => {
  test("generated keys pass the format validator", async () => {
    for (let i = 0; i < 5; i++) {
      const key = await generateLicenseKey();
      assert.equal(isValidLicenseKeyFormat(key), true, key);
    }
  });

  test("hashing is trimmed, case-insensitive and stable", async () => {
    const a = await hashLicenseKey(VALID);
    assert.equal(a, await hashLicenseKey("  " + VALID + "  "));
    assert.equal(a, await hashLicenseKey(VALID.toUpperCase()));
    assert.equal(a.length, 64);
    assert.notEqual(a, await hashLicenseKey("GSM-LIC-99999-4c5d6-7e8f9-0a1b2-3c4d5"));
  });

  test("safeEqualHex is length-safe", async () => {
    assert.equal(await safeEqualHex("abc", "abc"), true);
    assert.equal(await safeEqualHex("abc", "abd"), false);
    assert.equal(await safeEqualHex("abc", "abcd"), false);
  });

  test("fingerprint is stable and input-sensitive", async () => {
    const a = await licenseFingerprint("Host.Example.com", "https://panel.example.com/");
    const b = await licenseFingerprint("host.example.com", "https://panel.example.com");
    const c = await licenseFingerprint("other.example.com", "https://panel.example.com");
    assert.equal(a, await licenseFingerprint("HOST.EXAMPLE.COM", "HTTPS://PANEL.EXAMPLE.COM/"));
    assert.notEqual(a, c);
    assert.notEqual(a, b); // trailing slash differs
  });
});

describe("checkRateLimit", () => {
  // imported above already
  test("allows up to max per window, then blocks; window resets", async () => {
    const { checkRateLimit } = await import("../src/lib/licensing");
    const state = new Map<string, { count: number; windowStart: number }>();
    const T = 1_000_000;
    for (let i = 0; i < 10; i++) {
      assert.equal(checkRateLimit(state, "1.2.3.4", T + i, 60_000, 10), false);
    }
    assert.equal(checkRateLimit(state, "1.2.3.4", T + 11, 60_000, 10), true); // 11th blocked
    assert.equal(checkRateLimit(state, "1.2.3.4", T + 12, 60_000, 10), true);
    // window rolls over
    assert.equal(checkRateLimit(state, "1.2.3.4", T + 61_000, 60_000, 10), false);
  });

  test("different IPs are independent", async () => {
    const { checkRateLimit } = await import("../src/lib/licensing");
    const state = new Map<string, { count: number; windowStart: number }>();
    for (let i = 0; i < 11; i++) checkRateLimit(state, "a", 1000, 60_000, 10);
    assert.equal(checkRateLimit(state, "b", 1000, 60_000, 10), false);
  });
});

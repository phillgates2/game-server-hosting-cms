/**
 * Tests for password-reset tokens.
 *
 * A reset link sets a password, so the token properties (entropy, hashed
 * storage, expiry, one-shot shape) are pinned here.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateResetToken,
  hashResetToken,
  isValidResetToken,
  resetExpiry,
  RESET_TOKEN_BYTES,
  RESET_TTL_MS,
  RESET_TOKEN_RE,
} from "../src/lib/password-reset";

describe("token generation", () => {
  test("produces a 64-char hex token and its hash", () => {
    const { token, tokenHash } = generateResetToken();
    assert.match(token, RESET_TOKEN_RE);
    assert.match(tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(token, tokenHash, "the stored hash must not be the raw token");
    assert.equal(hashResetToken(token), tokenHash, "hash must be reproducible for lookup");
  });

  test("tokens are unique across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateResetToken().token);
    assert.equal(seen.size, 500);
  });

  test("entropy is 256 bits", () => {
    assert.equal(RESET_TOKEN_BYTES, 32);
    assert.equal(generateResetToken().token.length, 64);
  });
});

describe("token validation", () => {
  test("accepts exactly the generated shape", () => {
    assert.equal(isValidResetToken(generateResetToken().token), true);
  });

  test("rejects anything a probe or typo could produce", () => {
    assert.equal(isValidResetToken(""), false);
    assert.equal(isValidResetToken("a".repeat(63)), false);
    assert.equal(isValidResetToken("a".repeat(65)), false);
    assert.equal(isValidResetToken("g".repeat(64)), false, "non-hex");
    assert.equal(isValidResetToken("A".repeat(64)), false, "uppercase");
    assert.equal(isValidResetToken(null), false);
    assert.equal(isValidResetToken(undefined), false);
    assert.equal(isValidResetToken(1234), false);
    assert.equal(isValidResetToken(`../../${"a".repeat(64)}`), false);
  });
});

describe("expiry", () => {
  test("links live for exactly one hour by default", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const exp = resetExpiry(now);
    assert.equal(exp.getTime() - now.getTime(), 60 * 60_000);
    assert.equal(RESET_TTL_MS, 60 * 60_000);
  });

  test("a custom TTL is honoured", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    const exp = resetExpiry(now, 5_000);
    assert.equal(exp.getTime() - now.getTime(), 5_000);
  });
});

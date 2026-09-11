/**
 * Tests for one-time 2FA recovery codes.
 *
 * These codes are the emergency door into a 2FA account, so their entropy,
 * single-use semantics and hash-only storage shape are pinned here.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  generateRecoveryCodes,
  consumeRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  isLikelyRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "../src/lib/recovery-codes";

describe("generation", () => {
  test("mints the expected batch, codes paired with their hashes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    assert.equal(codes.length, RECOVERY_CODE_COUNT);
    assert.equal(hashes.length, RECOVERY_CODE_COUNT);
    codes.forEach((c, i) => assert.equal(hashRecoveryCode(c), hashes[i]));
  });

  test("codes are five chars, a dash, five chars from an unambiguous alphabet", () => {
    const { codes } = generateRecoveryCodes();
    for (const c of codes) {
      assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/i);
      assert.ok(!/[ilo01]/i.test(c), "no ambiguous glyphs");
    }
  });

  test("codes are unique within a batch and across batches", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      for (const c of generateRecoveryCodes().codes) {
        assert.ok(!seen.has(c), `duplicate code ${c}`);
        seen.add(c);
      }
    }
    assert.equal(seen.size, 20 * RECOVERY_CODE_COUNT);
  });

  test("stored hashes are not the codes themselves", () => {
    const { codes, hashes } = generateRecoveryCodes();
    hashes.forEach((h) => {
      assert.match(h, /^[a-f0-9]{64}$/);
      assert.ok(!codes.includes(h));
    });
  });
});

describe("normalisation", () => {
  test("case, dashes and spaces do not matter", () => {
    const a = normalizeRecoveryCode("ABCDE-FGHJK");
    const b = normalizeRecoveryCode("abcde fghjk");
    const c = normalizeRecoveryCode("abcde-fghjk");
    assert.equal(a, b);
    assert.equal(b, c);
  });
});

describe("single-use consumption", () => {
  test("a fresh code opens the account exactly once", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const first = consumeRecoveryCode(hashes, codes[0]);
    assert.equal(first.match, true);
    assert.equal(first.remaining.length, hashes.length - 1);

    // The spent code is gone; the others still work.
    const again = consumeRecoveryCode(first.remaining, codes[0]);
    assert.equal(again.match, false);
    const other = consumeRecoveryCode(first.remaining, codes[1]);
    assert.equal(other.match, true);
  });

  test("a wrong code changes nothing", () => {
    const { hashes } = generateRecoveryCodes();
    const res = consumeRecoveryCode(hashes, "zzzzz-zzzzz");
    assert.equal(res.match, false);
    assert.equal(res.remaining.length, hashes.length);
  });

  test("formatted input still matches its hash", () => {
    const { codes, hashes } = generateRecoveryCodes();
    const pretty = codes[3].toUpperCase().replace("-", " ");
    assert.equal(consumeRecoveryCode(hashes, pretty).match, true);
  });
});

describe("code shape detection", () => {
  test("a 6-digit TOTP is not treated as a recovery code", () => {
    assert.equal(isLikelyRecoveryCode("123456"), false);
  });

  test("a ten-char normalised input is a recovery-code candidate", () => {
    assert.equal(isLikelyRecoveryCode("abcde-fghjk"), true);
    assert.equal(isLikelyRecoveryCode("abcdefghjk"), true);
  });

  test("junk of other lengths is not", () => {
    assert.equal(isLikelyRecoveryCode("abc"), false);
    assert.equal(isLikelyRecoveryCode(""), false);
    assert.equal(isLikelyRecoveryCode("abcdefghjkl"), false);
  });
});

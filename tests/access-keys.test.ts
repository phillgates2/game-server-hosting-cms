/**
 * Tests for the CD-key style panel access keys.
 *
 * The pure layer owns the key shape, normalisation and hashing; these tests
 * pin the format users see ("GSM-XXXX-XXXX-XXXX-XXXX"), the unambiguous
 * alphabet, and that generation stays inside it.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAccessKey,
  isValidAccessKeyFormat,
  hashAccessKey,
  formatAccessKey,
  accessKeyPrefix,
  generateAccessKey,
  normalizeAccessKeyLabel,
  ACCESS_KEY_ALPHABET,
  ACCESS_KEY_BODY_LENGTH,
  ACCESS_KEY_LABEL_MAX,
} from "../src/lib/access-keys";

describe("normalizeAccessKey", () => {
  test("upper-cases, strips dashes and whitespace, and drops the GSM display prefix", () => {
    assert.equal(normalizeAccessKey("gsm-abcd-2345-xyz9-hjkm"), "ABCD2345XYZ9HJKM");
    assert.equal(normalizeAccessKey("abcd-2345-xyz9-hjkm"), "ABCD2345XYZ9HJKM");
    assert.equal(normalizeAccessKey("  abcd efgh  jkmn pqr2 "), "ABCDEFGHJKMNPQR2");
  });

  test("non-strings normalise to empty", () => {
    assert.equal(normalizeAccessKey(null), "");
    assert.equal(normalizeAccessKey(undefined), "");
    assert.equal(normalizeAccessKey(1234), "");
    assert.equal(normalizeAccessKey({}), "");
  });
});

describe("isValidAccessKeyFormat", () => {
  test("accepts exactly 16 alphabet characters", () => {
    assert.equal(isValidAccessKeyFormat("ABCD2345XYZ9HJKM"), true);
  });

  test("rejects wrong lengths", () => {
    assert.equal(isValidAccessKeyFormat(""), false);
    assert.equal(isValidAccessKeyFormat("ABCD2345XYZ9HJK"), false);
    assert.equal(isValidAccessKeyFormat("ABCD2345XYZ9HJKMX"), false);
  });

  test("rejects ambiguous characters the alphabet excludes", () => {
    for (const ch of ["I", "L", "O", "0", "1"]) {
      assert.equal(isValidAccessKeyFormat(`A${ch}CD2345XYZ9HJKM`.slice(0, 16)), false, ch);
    }
  });

  test("the alphabet itself never contains ambiguous characters", () => {
    for (const ch of ["I", "L", "O", "0", "1"]) {
      assert.equal(ACCESS_KEY_ALPHABET.includes(ch), false, ch);
    }
    assert.equal(ACCESS_KEY_ALPHABET.length, 31);
  });
});

describe("hash + format", () => {
  test("hashing is deterministic and key-specific", () => {
    assert.equal(hashAccessKey("ABCD"), hashAccessKey("ABCD"));
    assert.notEqual(hashAccessKey("ABCD"), hashAccessKey("ABCE"));
    assert.match(hashAccessKey("ABCD"), /^[a-f0-9]{64}$/);
  });

  test("formatAccessKey builds GSM-XXXX-XXXX-XXXX-XXXX", () => {
    assert.equal(formatAccessKey("ABCD2345XYZ9HJKM"), "GSM-ABCD-2345-XYZ9-HJKM");
  });

  test("accessKeyPrefix shows GSM plus the first group", () => {
    assert.equal(accessKeyPrefix("GSM-ABCD-2345-XYZ9-HJKM"), "GSM-ABCD");
  });
});

describe("generateAccessKey", () => {
  test("produces the expected shape", () => {
    const { key, hash, prefix } = generateAccessKey();
    assert.match(key, /^GSM(-[A-Z2-9]{4}){4}$/);
    assert.equal(prefix, key.slice(0, 8));
    // The stored hash must verify against the plaintext a user types back,
    // dashes, lowercase and all.
    assert.equal(hash, hashAccessKey(normalizeAccessKey(key)));
    // A user typing the key back in lowercase still verifies.
    assert.equal(hash, hashAccessKey(normalizeAccessKey(key.toLowerCase())));
  });

  test("bodies use only the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const { key } = generateAccessKey();
      const body = normalizeAccessKey(key);
      assert.equal(body.length, ACCESS_KEY_BODY_LENGTH);
      assert.equal(isValidAccessKeyFormat(body), true, key);
    }
  });

  test("keys are unique across generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateAccessKey().key);
    assert.equal(seen.size, 200);
  });
});

describe("normalizeAccessKeyLabel", () => {
  test("null/undefined/blank become null", () => {
    assert.equal(normalizeAccessKeyLabel(null), null);
    assert.equal(normalizeAccessKeyLabel(undefined), null);
    assert.equal(normalizeAccessKeyLabel("   "), null);
    assert.equal(normalizeAccessKeyLabel(42), null);
  });

  test("trims and caps at the max", () => {
    assert.equal(normalizeAccessKeyLabel("  Ally  "), "Ally");
    assert.equal(normalizeAccessKeyLabel("x".repeat(ACCESS_KEY_LABEL_MAX + 40))?.length, ACCESS_KEY_LABEL_MAX);
  });
});

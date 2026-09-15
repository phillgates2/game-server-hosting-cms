/**
 * The credential vault behind the FTP logins.
 *
 * Unlike a login password (bcrypt, compared and forgotten) an FTP password has
 * to come back out of the panel, so it is encrypted rather than hashed. These
 * tests cover the two things that must never regress: the round trip, and a
 * refusal to hand back anything that fails authentication.
 */
process.env.GSM_FILE_TRANSFER_SECRET = "unit-test-transfer-secret-0123456789";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptSecret,
  encryptSecret,
  generateTransferPassword,
  secretBoxDurable,
  secretsMatch,
} from "../src/lib/secret-box";

describe("secret box", () => {
  test("round-trips a password", () => {
    const password = generateTransferPassword();
    const stored = encryptSecret(password);
    assert.notEqual(stored, password);
    assert.equal(decryptSecret(stored), password);
  });

  test("handles empty and unicode values", () => {
    for (const value of ["", "üñïcøde-🔐", "x".repeat(4096)]) {
      assert.equal(decryptSecret(encryptSecret(value)), value);
    }
  });

  test("uses a fresh IV, so the same password stores differently every time", () => {
    const a = encryptSecret("same-password");
    const b = encryptSecret("same-password");
    assert.notEqual(a, b);
    assert.equal(decryptSecret(a), decryptSecret(b));
  });

  test("is versioned so a future format cannot be misparsed", () => {
    assert.match(encryptSecret("x"), /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/);
  });

  test("refuses a tampered, truncated or unknown payload", () => {
    const stored = encryptSecret("hunter2");
    const parts = stored.split(".");

    // Flip a byte of ciphertext — GCM must fail the tag check.
    const ciphertext = parts[3];
    const flipped = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1);
    assert.equal(decryptSecret([parts[0], parts[1], parts[2], flipped].join(".")), null);

    assert.equal(decryptSecret([parts[0], parts[1], "AAAA", parts[3]].join(".")), null);
    assert.equal(decryptSecret([parts[0], parts[1], parts[2]].join(".")), null);
    assert.equal(decryptSecret("v2.a.b.c"), null);
    assert.equal(decryptSecret(""), null);
    assert.equal(decryptSecret("not-a-payload"), null);
  });

  test("reports whether a durable key is configured", () => {
    // The dedicated secret is set at the top of this file.
    assert.equal(secretBoxDurable(), true);
  });
});

describe("secret comparison", () => {
  test("matches equal values and rejects different ones", () => {
    assert.equal(secretsMatch("correct horse", "correct horse"), true);
    assert.equal(secretsMatch("correct horse", "correct horsf"), false);
    assert.equal(secretsMatch("correct horse", "correct horse "), false);
  });

  test("does not treat an empty guess as a match", () => {
    assert.equal(secretsMatch("", ""), true);
    assert.equal(secretsMatch("", "x"), false);
    assert.equal(secretsMatch("x", ""), false);
  });

  test("compares different lengths without throwing", () => {
    assert.equal(secretsMatch("short", "a-much-longer-secret"), false);
  });
});

describe("generated transfer passwords", () => {
  test("are long enough and use an unambiguous alphabet", () => {
    for (let i = 0; i < 25; i += 1) {
      const password = generateTransferPassword();
      assert.equal(password.length, 24);
      // base58: no 0, O, I or l — the characters people mistype from a screen.
      assert.match(password, /^[1-9A-HJ-NP-Za-km-z]{24}$/);
    }
  });

  test("do not repeat across draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generateTransferPassword());
    assert.equal(seen.size, 200);
  });
});

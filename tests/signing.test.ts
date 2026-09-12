/**
 * Signing-key derivation — the Stage-45 debug-pass regression.
 * Deriving the SPKI public half must go through createPublicKey; exporting
 * spki from a private KeyObject throws and used to look like "corrupt key".
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { publicPemFromPrivateKeyPem } from "../src/lib/signing";

describe("publicPemFromPrivateKeyPem", () => {
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  test("derives the SPKI public PEM from a PKCS8 private PEM", () => {
    const pub = publicPemFromPrivateKeyPem(privatePem);
    assert.match(pub, /-----BEGIN PUBLIC KEY-----/);
    assert.equal(
      pub.trim(),
      pair.publicKey.export({ type: "spki", format: "pem" }).toString().trim()
    );
  });

  test("the derived public key verifies signatures made by the private key", () => {
    const pub = publicPemFromPrivateKeyPem(privatePem);
    const msg = Buffer.from("offline-token regression check");
    const sig = sign(null, msg, pair.privateKey);
    assert.equal(verify(null, msg, pub, sig), true);
  });

  test("corrupt input throws (callers map it to a regenerate message)", () => {
    assert.throws(() => publicPemFromPrivateKeyPem("not a pem"));
  });
});

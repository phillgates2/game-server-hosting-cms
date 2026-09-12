/**
 * Tests for offline pre-signed license tokens.
 *
 * The contract: tokens are Ed25519-signed payloads; tampering, malformed
 * shapes, wrong keys and expiry all fail closed; a round trip with the real
 * crypto works.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  buildOfflineToken,
  verifyOfflineToken,
  parseOfflineToken,
  decideOfflineToken,
  b64urlEncode,
  normalizePublicKeyPem,
} from "../src/lib/license-client";

const pair = generateKeyPairSync("ed25519");
const priv = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pub = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const otherPub = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const NOW = 1_700_000_000_000;

async function makeToken(over: { expiresAtMs?: number; keyId?: number; privateKeyPem?: string } = {}) {
  return buildOfflineToken({
    keyId: over.keyId ?? 7,
    label: "Acme Corp",
    issuedAtMs: NOW - 3_600_000,
    expiresAtMs: over.expiresAtMs ?? NOW + 30 * 86_400_000,
    privateKeyPem: over.privateKeyPem ?? priv,
  });
}

describe("parseOfflineToken", () => {
  test("rejects junk shapes", () => {
    assert.equal(parseOfflineToken(null), null);
    assert.equal(parseOfflineToken(42), null);
    assert.equal(parseOfflineToken("one-part-only"), null);
    assert.equal(parseOfflineToken("a.b.c"), null);
    assert.equal(parseOfflineToken("!!!.@@@"), null);
  });

  test("accepts a well-formed two-part token", async () => {
    const token = await makeToken();
    const parsed = parseOfflineToken(token);
    assert.ok(parsed);
    assert.ok(parsed!.payloadJson.includes('"keyId":7'));
  });
});

describe("verifyOfflineToken (real crypto)", () => {
  test("round trip: valid token, correct key, future expiry passes", async () => {
    const token = await makeToken();
    const r = await verifyOfflineToken({ token, publicKeyPem: pub, nowMs: NOW });
    assert.equal(r.ok, true);
    assert.equal(r.payload?.keyId, 7);
    assert.equal(r.payload?.label, "Acme Corp");
  });

  test("wrong public key fails signature verification", async () => {
    const token = await makeToken();
    const r = await verifyOfflineToken({ token, publicKeyPem: otherPub, nowMs: NOW });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /signature/i);
  });

  test("expired token refused", async () => {
    const token = await makeToken({ expiresAtMs: NOW - 1000 });
    const r = await verifyOfflineToken({ token, publicKeyPem: pub, nowMs: NOW });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /expired/i);
  });

  test("tampered payload fails", async () => {
    const token = await makeToken();
    const [head, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    payload.keyId = 999; // forge
    const forged = `${b64urlEncode(JSON.stringify(payload))}.${sig}`;
    const r = await verifyOfflineToken({ token: forged, publicKeyPem: pub, nowMs: NOW });
    assert.equal(r.ok, false);
  });

  test("malformed token fails closed", async () => {
    const r = await verifyOfflineToken({ token: "garbage", publicKeyPem: pub, nowMs: NOW });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /malformed/i);
  });

  test("garbage public key fails closed, not throws", async () => {
    const token = await makeToken();
    const r = await verifyOfflineToken({ token, publicKeyPem: "not a pem", nowMs: NOW });
    assert.equal(r.ok, false);
  });
});

describe("decideOfflineToken", () => {
  test("verdict precedence", () => {
    assert.equal(decideOfflineToken({ parsed: false, signatureValid: true, expired: false }).ok, false);
    assert.equal(decideOfflineToken({ parsed: true, signatureValid: false, expired: false }).ok, false);
    assert.equal(decideOfflineToken({ parsed: true, signatureValid: true, expired: true }).ok, false);
    assert.equal(decideOfflineToken({ parsed: true, signatureValid: true, expired: false }).ok, true);
  });
});

describe("decideInstallLicenseExtended", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  test("offline token path wins over missing online config; master beats all", async () => {
    const { decideInstallLicenseExtended } = await import("../src/lib/license-client");
    const offlineOk = { ok: true as const };
    assert.deepEqual(
      decideInstallLicenseExtended({ masterMode: false, serverConfigured: false, onlineOutcome: null, keyPresented: false, offlineTokenPresented: true, offlineOutcome: offlineOk }),
      { ok: true, mode: "offline" }
    );
    assert.equal(
      decideInstallLicenseExtended({ masterMode: false, serverConfigured: false, onlineOutcome: null, keyPresented: false, offlineTokenPresented: true, offlineOutcome: { ok: false, reason: "bad sig" } }).reason,
      "bad sig"
    );
    assert.deepEqual(
      decideInstallLicenseExtended({ masterMode: true, serverConfigured: false, onlineOutcome: null, keyPresented: false, offlineTokenPresented: false, offlineOutcome: null }),
      { ok: true, mode: "master" }
    );
  });
});

describe("normalizePublicKeyPem", () => {
  test("accepts raw PEM and base64-wrapped PEM, rejects junk", () => {
    assert.equal(normalizePublicKeyPem(pub), pub.trim());
    assert.equal(normalizePublicKeyPem(Buffer.from(pub, "utf8").toString("base64")), pub);
    assert.equal(normalizePublicKeyPem("junk"), null);
    assert.equal(normalizePublicKeyPem(null), null);
    assert.equal(normalizePublicKeyPem(""), null);
  });
});

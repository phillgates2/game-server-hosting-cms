/**
 * Tests for the outbound webhook core.
 *
 * The security-critical pieces: the SSRF blocklist (webhooks must never be
 * aimed at the operator's own private network), HMAC round-trips, and the
 * secret hygiene rules.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateWebhookUrl,
  buildWebhookPayload,
  signWebhookPayload,
  verifyWebhookSignature,
  normalizeWebhookSecret,
  maskWebhookSecret,
} from "../src/lib/outbound-webhook";

describe("validateWebhookUrl — SSRF guard", () => {
  test("accepts ordinary public endpoints", () => {
    assert.equal(validateWebhookUrl("https://hooks.example.com/gsm").ok, true);
    assert.equal(validateWebhookUrl("http://203.0.113.9:8080/hook").ok, true);
  });

  test("rejects localhost and loopback", () => {
    for (const bad of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://127.5.6.7/x",
      "http://[::1]/x",
    ]) {
      assert.equal(validateWebhookUrl(bad).ok, false, bad);
    }
  });

  test("rejects private and link-local ranges", () => {
    for (const bad of [
      "http://10.0.0.5/x",
      "http://192.168.1.2/x",
      "http://172.16.0.9/x",
      "http://169.254.169.254/latest/meta-data", // cloud metadata!
      "http://[fe80::1]/x",
      "http://0.0.0.0/x",
    ]) {
      assert.equal(validateWebhookUrl(bad).ok, false, bad);
    }
  });

  test("rejects non-http schemes and embedded credentials", () => {
    assert.equal(validateWebhookUrl("ftp://example.com/x").ok, false);
    assert.equal(validateWebhookUrl("file:///etc/passwd").ok, false);
    assert.equal(validateWebhookUrl("https://user:pass@example.com/x").ok, false);
  });

  test("rejects junk", () => {
    assert.equal(validateWebhookUrl("not a url").ok, false);
    assert.equal(validateWebhookUrl("").ok, false);
    assert.equal(validateWebhookUrl(null).ok, false);
    assert.equal(validateWebhookUrl(42).ok, false);
  });
});

describe("payload + signature", () => {
  const event = { action: "server.start", entityType: "server", entityId: 7, details: { pid: 123 } };

  test("payload shape is stable", () => {
    const p = buildWebhookPayload(event, { panel: "Test", version: "9.9" }, "2026-01-01T00:00:00.000Z");
    assert.equal(p.source, "game-server-manager");
    assert.equal(p.timestamp, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(p.event, { ...event, username: null });
  });

  test("HMAC signs and verifies, rejects tampering", () => {
    const body = JSON.stringify(buildWebhookPayload(event, { panel: "T", version: "1" }, "now"));
    const sig = signWebhookPayload(body, "s3cret-s3cret-s3cret");
    assert.equal(verifyWebhookSignature(body, "s3cret-s3cret-s3cret", sig), true);
    assert.equal(verifyWebhookSignature(body, "wrong-secret-wrong", sig), false);
    assert.equal(verifyWebhookSignature(body + " ", "s3cret-s3cret-s3cret", sig), false);
    assert.equal(verifyWebhookSignature(body, "s3cret-s3cret-s3cret", sig.slice(0, 10)), false);
  });
});

describe("secret hygiene", () => {
  test("empty clears, short rejects, long caps", () => {
    assert.equal(normalizeWebhookSecret("").secret, null);
    assert.equal(normalizeWebhookSecret("short").ok, false);
    assert.equal(normalizeWebhookSecret("x".repeat(201)).ok, false);
    const ok = normalizeWebhookSecret("  a-good-secret-123  ");
    assert.equal(ok.secret, "a-good-secret-123");
  });

  test("masking never reveals the middle", () => {
    assert.equal(maskWebhookSecret(null), null);
    assert.equal(maskWebhookSecret("abc"), "••••");
    assert.equal(maskWebhookSecret("abcdefgh"), "abcd…efgh");
  });
});

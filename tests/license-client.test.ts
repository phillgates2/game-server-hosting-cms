/**
 * Tests for the license CLIENT decision layer.
 *
 * The contract: installs fail CLOSED — no license server configured, no key
 * presented, or an unreachable/unhappy license server all refuse; only the
 * master-panel mode bypasses, and the server's own verdict words survive.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { interpretValidateResponse, decideInstallLicense } from "../src/lib/license-client";

const OK = { ok: true, code: "ok", message: "License key accepted." };

describe("interpretValidateResponse", () => {
  test("200 + ok:true is a pass, keeping the server message", () => {
    const r = interpretValidateResponse({ status: 200, body: { ok: true, message: "hi" } });
    assert.equal(r.ok, true);
    assert.equal(r.message, "hi");
  });

  test("402/403 rejections carry the server's error text", () => {
    const r = interpretValidateResponse({ status: 402, body: { ok: false, code: "invalid", error: "bad key" } });
    assert.equal(r.ok, false);
    assert.equal(r.code, "invalid");
    assert.equal(r.message, "bad key");
  });

  test("429 gets a dedicated rate-limit message", () => {
    const r = interpretValidateResponse({ status: 429, body: {} });
    assert.equal(r.ok, false);
    assert.equal(r.code, "rate-limited");
    assert.match(r.message, /wait a minute/i);
  });

  test("garbage bodies are treated as invalid, never as ok", () => {
    assert.equal(interpretValidateResponse({ status: 200, body: null }).ok, false);
    assert.equal(interpretValidateResponse({ status: 500, body: {} }).ok, false);
    assert.equal(interpretValidateResponse({ status: 200, body: { ok: "true" } }).ok, false);
  });
});

describe("decideInstallLicense", () => {
  test("master mode bypasses everything", () => {
    assert.deepEqual(
      decideInstallLicense({ masterMode: true, serverConfigured: false, outcome: null, keyPresented: false }),
      { ok: true }
    );
  });

  test("no license server configured fails closed with setup guidance", () => {
    const d = decideInstallLicense({ masterMode: false, serverConfigured: false, outcome: OK, keyPresented: true });
    assert.equal(d.ok, false);
    assert.match(d.reason ?? "", /GSM_LICENSE_SERVER/);
  });

  test("missing key fails closed", () => {
    const d = decideInstallLicense({ masterMode: false, serverConfigured: true, outcome: OK, keyPresented: false });
    assert.equal(d.ok, false);
    assert.match(d.reason ?? "", /license key is required/i);
  });

  test("unreachable server (null outcome) fails closed", () => {
    const d = decideInstallLicense({ masterMode: false, serverConfigured: true, outcome: null, keyPresented: true });
    assert.equal(d.ok, false);
    assert.match(d.reason ?? "", /could not be reached/);
  });

  test("rejected verdict surfaces the server's message", () => {
    const d = decideInstallLicense({
      masterMode: false,
      serverConfigured: true,
      outcome: { ok: false, code: "revoked", message: "revoked!" },
      keyPresented: true,
    });
    assert.equal(d.ok, false);
    assert.equal(d.reason, "revoked!");
  });

  test("happy path passes", () => {
    const d = decideInstallLicense({ masterMode: false, serverConfigured: true, outcome: OK, keyPresented: true });
    assert.deepEqual(d, { ok: true });
  });
});

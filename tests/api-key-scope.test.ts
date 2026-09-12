/**
 * Tests for per-key API permission scopes (Stage 45 rewrite).
 *
 * The scope now rides EXPLICITLY on the authenticated identity
 * (`auth.keyScope`) and is threaded into every `hasPermission` call. The
 * previous AsyncLocalStorage carrier was dropped after a full live debug pass
 * proved Next's per-request context boundary swallows `enterWith` writes made
 * inside awaited helpers — every scoped key silently acted with its owner's
 * full rights. Explicit threading is boring, auditable, and compiler-enforced
 * (the third argument is mandatory).
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scopeAllows } from "../src/lib/key-scope";
import { validateKeyScope } from "../src/lib/server-lifecycle";

describe("scopeAllows — the pure scope decision", () => {
  test("null scope (session cookie / unscoped key) is unrestricted", () => {
    assert.equal(scopeAllows(null, "servers.delete"), true);
    assert.equal(scopeAllows(null, "anything.at.all"), true);
  });

  test("a scoped key may only do what it lists", () => {
    const scope = { "servers.view": true };
    assert.equal(scopeAllows(scope, "servers.view"), true);
    assert.equal(scopeAllows(scope, "servers.delete"), false);
    assert.equal(scopeAllows(scope, "users.edit"), false);
  });

  test("an explicitly false entry is denied, not merely absent", () => {
    assert.equal(scopeAllows({ "servers.view": false }, "servers.view"), false);
  });

  test("an empty scope object denies everything", () => {
    assert.equal(scopeAllows({}, "servers.view"), false);
  });

  test("undefined scope (forgotten threading) fails CLOSED", () => {
    assert.equal(scopeAllows(undefined, "servers.view"), false);
    assert.equal(scopeAllows(undefined, "panel.settings"), false);
  });
});

describe("validateKeyScope — creation-time validation still pins", () => {
  test("undefined/null both mean unscoped (no narrowing)", () => {
    const r = validateKeyScope(undefined, ["servers.view"]);
    assert.equal(r.error, null);
    assert.equal(r.scope, null);
  });

  test("unknown permissions are rejected at creation", () => {
    const r = validateKeyScope({ "not.a.permission": true }, ["servers.view"]);
    assert.notEqual(r.error, null);
  });
});

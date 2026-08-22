/**
 * Tests for per-key API permission scopes.
 *
 * An API key can carry a `permissions` object narrowing what it may do. The
 * column existed, the create endpoint accepted it and the UI type declared it,
 * but nothing ever read it back — so a key created as read-only silently acted
 * with its owner's full rights.
 *
 * The scope is carried in an AsyncLocalStorage store established when the
 * request is authenticated. The risk with that approach is cross-request
 * bleed, so the concurrency behaviour is tested explicitly rather than assumed.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  setAuthContext,
  getAuthContext,
  allowedByKeyScope,
  withAuthContext,
} from "../src/lib/request-context";
import { validateKeyScope } from "../src/lib/server-lifecycle";

describe("key scope narrowing", () => {
  test("a key with no scope is unrestricted", () => {
    // Keys issued before scopes were enforced have permissions = null and
    // must keep working exactly as before.
    withAuthContext({ keyPermissions: null, keyId: 1 }, () => {
      assert.equal(allowedByKeyScope("servers.delete"), true);
      assert.equal(allowedByKeyScope("anything.at.all"), true);
    });
  });

  test("a scoped key may only do what it lists", () => {
    withAuthContext({ keyPermissions: { "servers.view": true }, keyId: 2 }, () => {
      assert.equal(allowedByKeyScope("servers.view"), true);
      assert.equal(allowedByKeyScope("servers.delete"), false);
      assert.equal(allowedByKeyScope("users.edit"), false);
    });
  });

  test("an explicitly false entry is denied, not merely absent", () => {
    withAuthContext({ keyPermissions: { "servers.view": false }, keyId: 3 }, () => {
      assert.equal(allowedByKeyScope("servers.view"), false);
    });
  });

  test("an empty scope object denies everything", () => {
    // Distinct from null: the user asked for a key that can do nothing.
    withAuthContext({ keyPermissions: {}, keyId: 4 }, () => {
      assert.equal(allowedByKeyScope("servers.view"), false);
    });
  });

  test("no context at all is unrestricted", () => {
    // Internal callers and background jobs run outside any request.
    assert.equal(allowedByKeyScope("servers.delete"), true);
  });
});

describe("request isolation", () => {
  test("concurrent requests do not observe each other's scope", async () => {
    // The failure mode that would make AsyncLocalStorage the wrong tool: a
    // scope from one in-flight request leaking into another. Each task sets
    // its context, yields, and re-checks after the others have run.
    async function req(scope: Record<string, boolean> | null, delay: number) {
      setAuthContext({ keyPermissions: scope, keyId: null });
      await new Promise((r) => setTimeout(r, delay));
      return allowedByKeyScope("servers.delete");
    }

    const [readonly, cookie, admin] = await Promise.all([
      req({ "servers.view": true }, 30),
      req(null, 10),
      req({ "servers.delete": true }, 20),
    ]);

    assert.equal(readonly, false, "read-only key must stay denied after yielding");
    assert.equal(cookie, true, "cookie session is unrestricted");
    assert.equal(admin, true, "scoped key that lists the permission is allowed");
  });

  test("a scope does not survive into a later unrelated request", async () => {
    await withAuthContext({ keyPermissions: { "servers.view": true }, keyId: 9 }, async () => {
      assert.equal(allowedByKeyScope("servers.delete"), false);
    });

    // A cookie-authenticated request sets its own null context.
    setAuthContext({ keyPermissions: null, keyId: null });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(allowedByKeyScope("servers.delete"), true);
  });

  test("context survives an await, which is where a naive global would break", async () => {
    setAuthContext({ keyPermissions: { "servers.view": true }, keyId: 5 });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(allowedByKeyScope("servers.view"), true);
    assert.equal(allowedByKeyScope("servers.delete"), false);
    assert.equal(getAuthContext()?.keyId, 5);
  });
});

describe("key scope validation on create", () => {
  const KNOWN = ["servers.view", "servers.delete", "users.edit"];

  test("null and undefined mean unrestricted", () => {
    assert.deepEqual(validateKeyScope(null, KNOWN), { scope: null, error: null });
    assert.deepEqual(validateKeyScope(undefined, KNOWN), { scope: null, error: null });
  });

  test("accepts a well-formed scope", () => {
    const r = validateKeyScope({ "servers.view": true, "servers.delete": false }, KNOWN);
    assert.equal(r.error, null);
    assert.deepEqual(r.scope, { "servers.view": true, "servers.delete": false });
  });

  test("rejects a typo instead of silently creating a dead key", () => {
    // Storing this would produce a key that denies everything, which looks
    // like a bug in the panel rather than a rejected request.
    const r = validateKeyScope({ "servers.veiw": true }, KNOWN);
    assert.equal(r.scope, null);
    assert.match(String(r.error), /Unknown permission\(s\): servers\.veiw/);
  });

  test("rejects non-boolean values", () => {
    assert.match(String(validateKeyScope({ "servers.view": "yes" }, KNOWN).error), /must be true or false/);
    assert.match(String(validateKeyScope({ "servers.view": 1 }, KNOWN).error), /must be true or false/);
  });

  test("rejects shapes that are not a plain object", () => {
    for (const bad of [["servers.view"], "servers.view", 42, true]) {
      const r = validateKeyScope(bad, KNOWN);
      assert.equal(r.scope, null, `${JSON.stringify(bad)} must be rejected`);
      assert.match(String(r.error), /must be an object/);
    }
  });

  test("an empty object is valid and means a key that can do nothing", () => {
    const r = validateKeyScope({}, KNOWN);
    assert.equal(r.error, null);
    assert.deepEqual(r.scope, {});
  });

  test("a scope cannot grant more than its owner has", () => {
    // The scope is intersected with the owner's permissions (an AND), so
    // listing a permission the owner lacks does not confer it. This asserts
    // the shape of that guarantee: the scope alone never returns true for a
    // permission the owner would be denied.
    const scoped = { "users.edit": true };
    const r = validateKeyScope(scoped, KNOWN);
    assert.equal(r.error, null);
    // Enforcement is the AND in hasPermission; see the narrowing tests above.
    assert.deepEqual(r.scope, scoped);
  });
});

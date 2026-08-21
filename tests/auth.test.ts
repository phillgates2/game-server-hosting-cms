/**
 * Unit tests for token handling and login throttling.
 *
 * These exercise the real behaviour rather than grepping the source: a token
 * must round-trip, a tampered token must be rejected, and the throttle must
 * actually stop the eleventh attempt.
 *
 * The module reads JWT_SECRET once at import time, so the secret is set before
 * the import below.
 *
 *   npm test
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ??= "0123456789abcdef0123456789abcdef0123456789abcdef";

type AuthModule = typeof import("../src/lib/auth");
let auth: AuthModule;

before(async () => {
  auth = await import("../src/lib/auth");
});

describe("password hashing", () => {
  test("a hash verifies against its own password", async () => {
    const hash = await auth.hashPassword("correct horse battery staple");
    assert.ok(await auth.verifyPassword("correct horse battery staple", hash));
  });

  test("a wrong password does not verify", async () => {
    const hash = await auth.hashPassword("correct horse battery staple");
    assert.equal(await auth.verifyPassword("wrong password", hash), false);
  });

  test("the same password hashes differently each time (salted)", async () => {
    const a = await auth.hashPassword("same");
    const b = await auth.hashPassword("same");
    assert.notEqual(a, b, "identical hashes means the salt is not random");
  });

  test("the plaintext never appears in the hash", async () => {
    const hash = await auth.hashPassword("supersecret");
    assert.ok(!hash.includes("supersecret"));
  });
});

describe("JWT round trip", () => {
  test("a signed token decodes back to its payload", () => {
    const token = auth.createToken({ userId: 42, role: "admin" });
    const decoded = auth.verifyToken(token);
    assert.equal(decoded?.userId, 42);
    assert.equal(decoded?.role, "admin");
  });

  test("a tampered token is rejected", () => {
    const token = auth.createToken({ userId: 1, role: "user" });
    // Flip a character in the signature.
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith("A") ? "B" : "A");
    assert.equal(auth.verifyToken(parts.join(".")), null);
  });

  test("a token with a swapped payload is rejected", () => {
    // Privilege escalation attempt: re-encode the body as an admin.
    const token = auth.createToken({ userId: 1, role: "user" });
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: 1, role: "admin" }))
      .toString("base64url");
    assert.equal(auth.verifyToken(`${h}.${forged}.${s}`), null);
  });

  test("garbage is rejected rather than throwing", () => {
    assert.equal(auth.verifyToken("not-a-token"), null);
    assert.equal(auth.verifyToken(""), null);
  });
});

describe("token extraction from headers", () => {
  test("session tokens come from the cookie, not the Authorization header", () => {
    // Bearer is reserved for API keys (see api-key-auth.ts); a Bearer value
    // must never be accepted as a session JWT.
    const h = new Headers({ authorization: "Bearer abc123" });
    assert.equal(auth.getTokenFromHeaders(h), null);
  });

  test("reads the gsm_token cookie", () => {
    const h = new Headers({ cookie: "other=x; gsm_token=cookievalue; more=y" });
    assert.equal(auth.getTokenFromHeaders(h), "cookievalue");
  });

  test("returns null when neither is present", () => {
    assert.equal(auth.getTokenFromHeaders(new Headers()), null);
  });
});

describe("cookie options", () => {
  test("always httpOnly and sameSite, so JS cannot read the session", () => {
    const opts = auth.getCookieOptions(new Headers());
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.path, "/");
  });

  test("secure is set only when the request arrived over HTTPS", () => {
    assert.equal(auth.getCookieOptions(new Headers()).secure, false);
    assert.equal(
      auth.getCookieOptions(new Headers({ "x-forwarded-proto": "https" })).secure,
      true
    );
  });
});

describe("login throttle", () => {
  test("allows attempts below the limit", () => {
    const key = `test-under-${Math.random()}`;
    for (let i = 0; i < 9; i++) auth.recordFailedLogin(key);
    assert.equal(auth.loginRetryAfter(key), 0, "should still be allowed at 9 failures");
  });

  test("blocks once the limit is reached", () => {
    const key = `test-over-${Math.random()}`;
    for (let i = 0; i < 10; i++) auth.recordFailedLogin(key);
    const wait = auth.loginRetryAfter(key);
    assert.ok(wait > 0, "the 10th failure must start the lockout");
    assert.ok(wait <= 15 * 60, `retry-after should be within the window, got ${wait}s`);
  });

  test("a successful login clears the counter", () => {
    const key = `test-clear-${Math.random()}`;
    for (let i = 0; i < 10; i++) auth.recordFailedLogin(key);
    assert.ok(auth.loginRetryAfter(key) > 0);
    auth.clearFailedLogins(key);
    assert.equal(auth.loginRetryAfter(key), 0);
  });

  test("throttling is per key, so one user cannot lock out another", () => {
    const victim = `victim-${Math.random()}`;
    const attacker = `attacker-${Math.random()}`;
    for (let i = 0; i < 10; i++) auth.recordFailedLogin(attacker);
    assert.ok(auth.loginRetryAfter(attacker) > 0);
    assert.equal(auth.loginRetryAfter(victim), 0, "victim must be unaffected");
  });
});

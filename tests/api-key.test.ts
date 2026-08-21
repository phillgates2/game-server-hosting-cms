/**
 * Unit tests for API key header parsing and hashing.
 *
 * The database-backed lookup needs Postgres, so these cover the pure parts:
 * extracting the key from the header and hashing it consistently with the
 * generator in /api/api-keys.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getApiKeyFromHeaders, hashApiKey } from "../src/lib/api-key";

describe("getApiKeyFromHeaders", () => {
  test("extracts a gsm_ prefixed Bearer key", () => {
    const h = new Headers({ authorization: "Bearer gsm_abc123" });
    assert.equal(getApiKeyFromHeaders(h), "gsm_abc123");
  });

  test("is case-insensitive about the Bearer scheme", () => {
    assert.equal(
      getApiKeyFromHeaders(new Headers({ authorization: "bearer gsm_x" })),
      "gsm_x"
    );
  });

  test("tolerates extra whitespace after the scheme", () => {
    assert.equal(
      getApiKeyFromHeaders(new Headers({ authorization: "Bearer    gsm_y" })),
      "gsm_y"
    );
  });

  test("ignores a Bearer value that is not an API key", () => {
    // A JWT in the Authorization header must not be treated as an API key.
    const jwtish = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.sig";
    assert.equal(getApiKeyFromHeaders(new Headers({ authorization: `Bearer ${jwtish}` })), null);
  });

  test("returns null when the header is absent or malformed", () => {
    assert.equal(getApiKeyFromHeaders(new Headers()), null);
    assert.equal(getApiKeyFromHeaders(new Headers({ authorization: "gsm_nokeyword" })), null);
    assert.equal(getApiKeyFromHeaders(new Headers({ authorization: "Basic gsm_x" })), null);
    assert.equal(getApiKeyFromHeaders(new Headers({ authorization: "Bearer" })), null);
  });

  test("does not accept a key smuggled in with spaces", () => {
    assert.equal(
      getApiKeyFromHeaders(new Headers({ authorization: "Bearer gsm_a gsm_b" })),
      null
    );
  });
});

describe("hashApiKey", () => {
  test("matches a plain SHA-256 hex digest, as the generator produces", () => {
    const key = "gsm_deadbeef";
    const expected = createHash("sha256").update(key).digest("hex");
    assert.equal(hashApiKey(key), expected);
  });

  test("is deterministic", () => {
    assert.equal(hashApiKey("gsm_same"), hashApiKey("gsm_same"));
  });

  test("differs for different keys", () => {
    assert.notEqual(hashApiKey("gsm_a"), hashApiKey("gsm_b"));
  });

  test("never returns the raw key", () => {
    const hash = hashApiKey("gsm_supersecret");
    assert.ok(!hash.includes("supersecret"));
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

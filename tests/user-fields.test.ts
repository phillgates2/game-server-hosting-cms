/**
 * Tests for user-account field validation.
 *
 * The users PATCH route gated who may edit but never what the values may
 * contain: an invented role string landed straight in the JWT claim, a
 * duplicate email surfaced as a raw 500, and maxServers had no bounds.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRole,
  normalizeStatus,
  normalizeMaxServers,
  normalizeEmail,
  normalizeProfileText,
  checkPassword,
  USER_ROLES,
  USER_STATUSES,
} from "../src/lib/user-fields";

describe("normalizeRole / normalizeStatus", () => {
  test("accepts exactly what the panel's UI offers", () => {
    for (const role of USER_ROLES) assert.equal(normalizeRole(role).ok, true);
    for (const status of USER_STATUSES) assert.equal(normalizeStatus(status).ok, true);
  });

  test("rejects invented roles and statuses", () => {
    assert.equal(normalizeRole("superadmin").ok, false);
    assert.equal(normalizeRole("User").ok, false, "case matters; the JWT claim is lowercase");
    assert.equal(normalizeRole("").ok, false);
    assert.equal(normalizeRole(5).ok, false);
    assert.equal(normalizeStatus("deleted").ok, false);
    assert.equal(normalizeStatus("ACTIVE").ok, false);
  });
});

describe("normalizeMaxServers", () => {
  const val = (raw: unknown) => {
    const r = normalizeMaxServers(raw);
    assert.equal(r.ok, true, `expected ok for ${String(raw)}`);
    return r.ok ? r.value : null;
  };

  test("0 means unlimited (NULL), positives stay", () => {
    assert.equal(val(0), null);
    assert.equal(val("5"), 5);
    assert.equal(val(""), null);
    assert.equal(val(null), null);
  });

  test("rejects negatives, floats and absurd limits", () => {
    assert.equal(normalizeMaxServers(-1).ok, false);
    assert.equal(normalizeMaxServers("1.5").ok, false);
    assert.equal(normalizeMaxServers("abc").ok, false);
    assert.equal(normalizeMaxServers(10_001).ok, false);
  });
});

describe("normalizeEmail", () => {
  test("accepts plain addresses and trims", () => {
    const ok = normalizeEmail("  user@example.com  ");
    assert.equal(ok.ok && ok.value, "user@example.com");
  });

  test("rejects junk", () => {
    assert.equal(normalizeEmail("").ok, false);
    assert.equal(normalizeEmail("not-an-email").ok, false);
    assert.equal(normalizeEmail("a@b").ok, false, "no TLD");
    assert.equal(normalizeEmail("user@example.com ".repeat(30)).ok, false, "over length");
  });
});

describe("normalizeProfileText / checkPassword", () => {
  const val = (raw: string, label: string) => {
    const r = normalizeProfileText(raw, label);
    assert.equal(r.ok, true, `expected ok for ${label}`);
    return r.ok ? r.value : null;
  };

  test("empty profile fields clear the value", () => {
    assert.equal(val("", "bio"), null);
    assert.equal(val("hello", "bio"), "hello");
    assert.equal(normalizeProfileText("x".repeat(513), "bio").ok, false);
  });

  test("passwords must be 8-256 characters", () => {
    assert.equal(checkPassword("short").ok, false);
    assert.equal(checkPassword("abcdefgh").ok, true);
    assert.equal(checkPassword("x".repeat(257)).ok, false);
    assert.equal(checkPassword("").ok, false);
  });
});

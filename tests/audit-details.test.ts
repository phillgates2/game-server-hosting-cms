/**
 * Audit `details` is jsonb. Rendering an object as a React child throws
 * minified error #31 ("object with keys {scope, username}"). These tests
 * pin that the formatter always returns a string — including for the
 * file-transfer payload that crashed the overview widget.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatAuditDetails } from "../src/lib/audit-details";

const FALLBACK = "Panel activity";

describe("formatAuditDetails", () => {
  test("the file-transfer {scope, username} payload becomes a string", () => {
    const text = formatAuditDetails({ scope: "all", username: "alice" }, FALLBACK);
    assert.equal(typeof text, "string");
    assert.match(text, /scope: all/);
    assert.match(text, /username: alice/);
    assert.doesNotMatch(text, /^\[object Object\]$/);
  });

  test("empty / missing details fall back", () => {
    assert.equal(formatAuditDetails(null, FALLBACK), FALLBACK);
    assert.equal(formatAuditDetails(undefined, FALLBACK), FALLBACK);
    assert.equal(formatAuditDetails("", FALLBACK), FALLBACK);
    assert.equal(formatAuditDetails("   ", FALLBACK), FALLBACK);
    assert.equal(formatAuditDetails({}, FALLBACK), FALLBACK);
  });

  test("plain strings and scalars pass through", () => {
    assert.equal(formatAuditDetails("rotated password", FALLBACK), "rotated password");
    assert.equal(formatAuditDetails(42, FALLBACK), "42");
    assert.equal(formatAuditDetails(true, FALLBACK), "true");
  });

  test("nested objects stringify rather than becoming React children", () => {
    const text = formatAuditDetails({ pid: 123, extra: { nested: true } }, FALLBACK);
    assert.equal(typeof text, "string");
    assert.match(text, /pid: 123/);
    assert.match(text, /extra: \{"nested":true\}/);
  });
});

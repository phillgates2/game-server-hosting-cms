/**
 * Tests for the curated API reference.
 *
 * The catalog is static, so the tests pin its integrity (shape, uniqueness)
 * and that the anchors integrators rely on stay documented.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { API_DOCS, countDocumentedEndpoints } from "../src/lib/api-docs";

const VALID_METHODS = new Set(["GET", "POST", "PATCH", "DELETE", "PUT"]);

describe("API docs catalog integrity", () => {
  test("every entry is complete and well-formed", () => {
    for (const group of API_DOCS) {
      assert.ok(group.title.length > 0);
      assert.ok(group.icon.length > 0);
      assert.ok(group.endpoints.length > 0, `group ${group.title} is empty`);
      for (const ep of group.endpoints) {
        assert.ok(VALID_METHODS.has(ep.method), `${ep.path}: bad method ${ep.method}`);
        assert.ok(ep.path.startsWith("/api/"), `${ep.path}: not an /api path`);
        assert.ok(ep.description.length > 0, `${ep.path}: missing description`);
        assert.ok(ep.auth.length > 0, `${ep.path}: missing auth note`);
      }
    }
  });

  test("no duplicate method+path pairs", () => {
    const seen = new Set<string>();
    for (const group of API_DOCS) {
      for (const ep of group.endpoints) {
        const key = `${ep.method} ${ep.path}`;
        assert.equal(seen.has(key), false, `duplicate ${key}`);
        seen.add(key);
      }
    }
  });

  test("key integration anchors stay documented", () => {
    const flat = API_DOCS.flatMap((g) => g.endpoints.map((e) => `${e.method} ${e.path}`));
    for (const anchor of [
      "POST /api/auth/login",
      "POST /api/settings/master-key",
      "POST /api/servers/batch",
      "POST /api/servers/batch-update",
      "GET /api/servers/uptime",
      "POST /api/servers/:id/daily-backup",
      "GET /api/health",
    ]) {
      assert.ok(flat.includes(anchor), `missing ${anchor}`);
    }
  });

  test("count matches", () => {
    assert.equal(countDocumentedEndpoints(), API_DOCS.reduce((n, g) => n + g.endpoints.length, 0));
    assert.ok(countDocumentedEndpoints() >= 40);
  });
});

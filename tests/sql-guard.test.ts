/**
 * Tests for the SQL console guard.
 *
 * `pool.query(text)` runs Postgres' simple protocol, so a multi-statement
 * string executes every statement. The console is admin-only on purpose —
 * the guard is against accidents (a stray semicolon turning "delete a row"
 * into "delete a row, drop a table"), so it must accept every legitimate
 * single query and refuse exactly the multi-statement and malformed ones.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertSingleStatement,
  quotePgIdent,
  MAX_SQL_LENGTH,
} from "../src/lib/sql-guard";
import { isValidSettingKey, validateSettingValue } from "../src/lib/settings-keys";

describe("assertSingleStatement", () => {
  test("accepts ordinary single statements, with or without a trailing semicolon", () => {
    for (const sql of [
      "SELECT 1",
      "SELECT 1;",
      "SELECT * FROM users WHERE id = 5;",
      "UPDATE users SET status = 'active' WHERE id = 5",
      "DELETE FROM game_servers WHERE id = 3;",
      "INSERT INTO audit_log (action) VALUES ('x')",
    ]) {
      assert.equal(assertSingleStatement(sql).ok, true, `should accept: ${sql}`);
    }
  });

  test("accepts semicolons inside strings, identifiers and dollar quotes", () => {
    for (const sql of [
      "SELECT 'a;b'",
      "SELECT 'it''s; fine'",
      'SELECT "weird;name" FROM t',
      "SELECT $$a;b;c$$",
      "SELECT $tag$a;b$tag$",
      "SELECT $1::text;", // parameterised query with trailing terminator
    ]) {
      assert.equal(assertSingleStatement(sql).ok, true, `should accept: ${sql}`);
    }
  });

  test("accepts comments anywhere, including trailing ones", () => {
    assert.equal(assertSingleStatement("SELECT 1 -- trailing comment").ok, true);
    assert.equal(assertSingleStatement("-- header\nSELECT 1").ok, true);
    assert.equal(assertSingleStatement("/* explain */ SELECT 1 /* done */;").ok, true);
    assert.equal(assertSingleStatement("SELECT 1; -- done").ok, true);
  });

  test("rejects two statements, however they are separated", () => {
    for (const sql of [
      "SELECT 1; SELECT 2",
      "SELECT 1;SELECT 2",
      "SELECT 1; DROP TABLE users;",
      "DELETE FROM a; DELETE FROM b;",
      "SELECT 1;\nSELECT 2;",
      "SELECT 1;;",
    ]) {
      const res = assertSingleStatement(sql);
      assert.equal(res.ok, false, `should reject: ${sql}`);
      assert.match(String(res.error), /single SQL statement/);
    }
  });

  test("rejects unterminated quotes and comments", () => {
    assert.equal(assertSingleStatement("SELECT 'unterminated").ok, false);
    assert.equal(assertSingleStatement('SELECT "unterminated').ok, false);
    assert.equal(assertSingleStatement("SELECT /* unterminated").ok, false);
    assert.equal(assertSingleStatement("SELECT $$unterminated").ok, false);
  });

  test("rejects empty and oversized input", () => {
    assert.equal(assertSingleStatement("").ok, false);
    assert.equal(assertSingleStatement("  \n ").ok, false);
    assert.equal(assertSingleStatement("x".repeat(MAX_SQL_LENGTH + 1)).ok, false);
  });

  test("rejects non-string input", () => {
    assert.equal(assertSingleStatement(null as unknown as string).ok, false);
    assert.equal(assertSingleStatement(5 as unknown as string).ok, false);
  });
});

describe("quotePgIdent", () => {
  test("quotes and escapes inner quotes", () => {
    assert.equal(quotePgIdent("users"), '"users"');
    assert.equal(quotePgIdent('weird"name'), '"weird""name"');
  });
});

describe("settings key and value validation", () => {
  test("accepts the panel's own key shape", () => {
    assert.ok(isValidSettingKey("panel_name").ok);
    assert.ok(isValidSettingKey("custom_css").ok);
    assert.ok(isValidSettingKey("discord_bot_token").ok);
    assert.ok(isValidSettingKey("a").ok);
  });

  test("rejects junk keys", () => {
    assert.equal(isValidSettingKey("").ok, false);
    assert.equal(isValidSettingKey("Uppercase").ok, false);
    assert.equal(isValidSettingKey("has space").ok, false);
    assert.equal(isValidSettingKey("has-dash").ok, false);
    assert.equal(isValidSettingKey("1starts_with_number").ok, false);
    assert.equal(isValidSettingKey("x".repeat(97)).ok, false);
    assert.equal(isValidSettingKey("; DROP TABLE settings").ok, false);
  });

  test("json keys must be valid JSON documents", () => {
    assert.equal(validateSettingValue("features_json", '[{"a":1}]').ok, true);
    assert.equal(validateSettingValue("nav_links_json", '{"Home":"/"}').ok, true);
    assert.equal(validateSettingValue("features_json", "").ok, true, "empty clears the setting");
    assert.equal(validateSettingValue("features_json", "not json").ok, false);
    assert.equal(validateSettingValue("features_json", "42").ok, false, "a bare number is not a feature list");
  });

  test("plain values are capped but otherwise free", () => {
    assert.equal(validateSettingValue("custom_css", "body { color: red }").ok, true);
    assert.equal(validateSettingValue("hero_title", "x".repeat(100_001)).ok, false);
  });
});

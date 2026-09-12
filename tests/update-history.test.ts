/**
 * Tests for the update changelog detail formatting (pure layer).
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatUpdateEventDetail, UPDATE_DETAIL_MAX } from "../src/lib/update-history";

describe("formatUpdateEventDetail", () => {
  test("full report: backup, file counts, config names", () => {
    const s = formatUpdateEventDetail({
      backupName: "tf2-2026-09-12",
      report: { added: 3, removed: 1, changed: 12, configsChanged: ["cfg/server.cfg", "cfg/motd.txt"] },
    });
    assert.match(s, /backup=tf2-2026-09-12/);
    assert.match(s, /files \+3 ~12 -1/);
    assert.match(s, /configs touched: cfg\/server\.cfg, cfg\/motd\.txt/);
  });

  test("no backup and no report still yields a row", () => {
    const s = formatUpdateEventDetail({ backupName: null, report: null });
    assert.match(s, /file report unavailable/);
    assert.doesNotMatch(s, /backup=/);
  });

  test("long config lists are truncated with a count", () => {
    const s = formatUpdateEventDetail({
      backupName: null,
      report: { added: 0, removed: 0, changed: 6, configsChanged: ["a.cfg", "b.cfg", "c.cfg", "d.cfg", "e.cfg"] },
    });
    assert.match(s, /a\.cfg, b\.cfg, c\.cfg \(\+2\)/);
  });

  test("detail is capped", () => {
    const s = formatUpdateEventDetail({
      backupName: "x".repeat(2000),
      report: null,
    });
    assert.ok(s.length <= UPDATE_DETAIL_MAX);
  });
});

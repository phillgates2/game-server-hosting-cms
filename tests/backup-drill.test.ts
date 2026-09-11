/**
 * Tests for backup restore drills.
 *
 * The verdict must reject empty extractions (torn archive, wrong file) and
 * the backup picker must only trust panel-shaped names, newest first.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assessDrill, latestBackupName, formatBytes } from "../src/lib/backup-drill";

describe("assessDrill", () => {
  test("a real extraction passes with counts", () => {
    const v = assessDrill([
      { name: "cfg", size: 0, isFile: false },
      { name: "server.cfg", size: 512, isFile: true },
      { name: "map.bsp", size: 1_000_000, isFile: true },
    ]);
    assert.equal(v.ok, true);
    assert.equal(v.fileCount, 2);
    assert.equal(v.dirCount, 1);
    assert.equal(v.totalBytes, 1_000_512);
    assert.match(v.reason, /restored 2 files/);
  });

  test("no files → fail", () => {
    const v = assessDrill([{ name: "empty-dir", size: 0, isFile: false }]);
    assert.equal(v.ok, false);
    assert.match(v.reason, /no files/);
  });

  test("all-empty files → fail", () => {
    const v = assessDrill([
      { name: "a", size: 0, isFile: true },
      { name: "b", size: 0, isFile: true },
    ]);
    assert.equal(v.ok, false);
    assert.match(v.reason, /empty/);
  });

  test("negative sizes are clamped, not summed negative", () => {
    const v = assessDrill([
      { name: "weird", size: -5, isFile: true },
      { name: "ok", size: 10, isFile: true },
    ]);
    assert.equal(v.totalBytes, 10);
  });

  test("empty tree → fail", () => {
    assert.equal(assessDrill([]).ok, false);
  });
});

describe("latestBackupName", () => {
  test("lexicographic order is chronological for ISO-stamped names", () => {
    const names = [
      "backup-2026-09-01T00-00-00.tar.gz",
      "backup-2026-09-10T12-30-00.tar.gz",
      "backup-2026-09-05T08-15-00.tar.gz",
    ];
    assert.equal(latestBackupName(names), "backup-2026-09-10T12-30-00.tar.gz");
  });

  test("foreign files are ignored, empty yields null", () => {
    assert.equal(latestBackupName(["notes.txt", "../../evil.tar.gz", "backup-2026-01-01T00-00-00.tar.gz"]), "backup-2026-01-01T00-00-00.tar.gz");
    assert.equal(latestBackupName([]), null);
    assert.equal(latestBackupName(["readme.md"]), null);
  });
});

describe("formatBytes", () => {
  test("human bands", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(5 * 1_048_576), "5.0 MB");
    assert.equal(formatBytes(3 * 1_073_741_824), "3.0 GB");
  });
});

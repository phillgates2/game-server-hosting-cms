/**
 * Tests for backup retention selection and the disk-space guard.
 *
 * Both decide whether files get deleted or a backup gets refused, so the
 * decision logic is pure and pinned here rather than discovered from a full
 * disk at 4am.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  selectBackupsToPrune,
  spacePlanForBackup,
  DEFAULT_BACKUP_RETENTION,
  BACKUP_SPACE_MARGIN_BYTES,
} from "../src/lib/backup";

const MB = 1024 * 1024;
const names = (ts: string[]) => ts.map((t) => `backup-${t}.tar.gz`);

describe("selectBackupsToPrune", () => {
  test("keeps the newest N, deletes the rest", () => {
    const all = names(["2026-09-01T00-00-00", "2026-09-02T00-00-00", "2026-09-03T00-00-00", "2026-09-04T00-00-00"]);
    assert.deepEqual(selectBackupsToPrune(all, 2), [all[0], all[1]].reverse(), "two oldest go");
  });

  test("keeps everything when under the limit", () => {
    const all = names(["2026-09-01T00-00-00", "2026-09-02T00-00-00"]);
    assert.deepEqual(selectBackupsToPrune(all, 5), []);
  });

  test("keep=0 is a valid 'prune to nothing' — the caller decides whether to use it", () => {
    const all = names(["2026-09-01T00-00-00"]);
    assert.deepEqual(selectBackupsToPrune(all, 0), all);
  });

  test("never touches files the panel did not create", () => {
    const mixed = [
      "backup-2026-09-01T00-00-00.tar.gz",
      "my-manual-copy.tar.gz",
      "notes.txt",
      "backup-evil/../../etc/passwd",
      "backup-2026-09-02T00-00-00.tar.gz",
    ];
    const doomed = selectBackupsToPrune(mixed, 1);
    assert.deepEqual(doomed, ["backup-2026-09-01T00-00-00.tar.gz"]);
    assert.ok(!doomed.some((d) => d.includes("..") || !d.startsWith("backup-")));
  });

  test("an unsorted input still prunes chronologically (name sort = time sort)", () => {
    const all = names(["2026-09-03T00-00-00", "2026-09-01T00-00-00", "2026-09-02T00-00-00"]);
    const doomed = selectBackupsToPrune(all, 1).sort();
    assert.deepEqual(doomed, names(["2026-09-01T00-00-00", "2026-09-02T00-00-00"]).sort());
  });

  test("the default retention is a positive, sane number", () => {
    assert.ok(DEFAULT_BACKUP_RETENTION >= 1 && DEFAULT_BACKUP_RETENTION <= 100);
  });
});

describe("spacePlanForBackup", () => {
  test("enough room passes", () => {
    const plan = spacePlanForBackup(10_000 * MB, 1_000 * MB);
    assert.equal(plan.ok, true);
  });

  test("needs size plus margin, not just size", () => {
    const free = 1_000 * MB + BACKUP_SPACE_MARGIN_BYTES - 1;
    const plan = spacePlanForBackup(free, 1_000 * MB);
    assert.equal(plan.ok, false);
    assert.match(plan.reason ?? "", /not enough free disk space/);
  });

  test("exactly size plus margin passes", () => {
    const free = 1_000 * MB + BACKUP_SPACE_MARGIN_BYTES;
    assert.equal(spacePlanForBackup(free, 1_000 * MB).ok, true);
  });

  test("a disk reporting zero or garbage free space refuses", () => {
    assert.equal(spacePlanForBackup(0, 1).ok, false);
    assert.equal(spacePlanForBackup(-5, 1).ok, false);
    assert.equal(spacePlanForBackup(Number.NaN, 1).ok, false);
  });

  test("an empty server still needs the margin", () => {
    assert.equal(spacePlanForBackup(BACKUP_SPACE_MARGIN_BYTES - 1, 0).ok, false);
    assert.equal(spacePlanForBackup(BACKUP_SPACE_MARGIN_BYTES, 0).ok, true);
  });
});

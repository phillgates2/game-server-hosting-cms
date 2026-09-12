/**
 * Tests for backup restore guards (pure layer).
 *
 * The contract: only stopped+dead servers on local nodes can be restored,
 * and backup names are validated hard enough that no path can escape the
 * backup directory.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveBackupPath, precheckRestore } from "../src/lib/backup-restore";

describe("precheckRestore", () => {
  test("stopped + dead + local passes", () => {
    assert.deepEqual(precheckRestore({ status: "stopped", processAlive: false, nodeIsLocal: true }), { ok: true });
  });

  test("running or installing refused", () => {
    assert.equal(precheckRestore({ status: "running", processAlive: false, nodeIsLocal: true }).ok, false);
    assert.equal(precheckRestore({ status: "installing", processAlive: false, nodeIsLocal: true }).ok, false);
  });

  test("a live pid is refused even if status says stopped", () => {
    const pre = precheckRestore({ status: "stopped", processAlive: true, nodeIsLocal: true });
    assert.equal(pre.ok, false);
    assert.match(pre.reason ?? "", /alive/);
  });

  test("remote nodes refused", () => {
    assert.equal(precheckRestore({ status: "stopped", processAlive: false, nodeIsLocal: false }).ok, false);
  });

  test("null nodeIsLocal (no node row) is treated as local", () => {
    assert.equal(precheckRestore({ status: "stopped", processAlive: false, nodeIsLocal: null }).ok, true);
  });
});

describe("resolveBackupPath", () => {
  test("accepts well-formed names inside the backup dir", () => {
    const p = resolveBackupPath("/srv/game/gsm-backups", "backup-2026-09-12T04-00-00.tar.gz");
    assert.equal(p, "/srv/game/gsm-backups/backup-2026-09-12T04-00-00.tar.gz");
  });

  test("rejects traversal attempts", () => {
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", "../evil.tar.gz"), null);
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", ".."), null);
  });

  test("rejects bad extensions and non-strings", () => {
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", "backup-x.tar"), null);
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", "backup-x.zip"), null);
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", "evil; rm -rf /.tar.gz"), null);
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", 42), null);
    assert.equal(resolveBackupPath("/srv/game/gsm-backups", null), null);
  });
});

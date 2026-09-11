/**
 * Tests for pre/post-update snapshot diffing (pure layer + fs walk).
 *
 * The contract: the diff reports exactly what changed (added/removed/changed),
 * flags config files specifically, caps report sizes, and the walker never
 * follows symlinks or exceeds the file cap.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diffSnapshots,
  isConfigPath,
  configFilesChanged,
  formatUpdateReport,
  snapshotInstallPath,
  REPORT_MAX_PATHS,
  SNAPSHOT_MAX_FILES,
  type SnapshotEntry,
} from "../src/lib/update-diff";

const f = (path: string, size = 10, mtimeMs = 1000): SnapshotEntry => ({ path, size, mtimeMs });

describe("diffSnapshots", () => {
  test("detects added, removed and changed files; counts the unchanged", () => {
    const before = [f("keep.bin"), f("gone.bin"), f("edit.cfg", 10, 1000), f("same.cfg")];
    const after = [f("keep.bin"), f("new.bin"), f("edit.cfg", 11, 1000), f("same.cfg")];
    const diff = diffSnapshots(before, after);
    assert.deepEqual(diff.added, ["new.bin"]);
    assert.deepEqual(diff.removed, ["gone.bin"]);
    assert.deepEqual(diff.changed, ["edit.cfg"]);
    assert.equal(diff.unchangedCount, 2);
    assert.equal(diff.truncated, false);
  });

  test("mtime-only changes count as changed (content touched in place)", () => {
    const diff = diffSnapshots([f("a.cfg", 10, 1000)], [f("a.cfg", 10, 2000)]);
    assert.deepEqual(diff.changed, ["a.cfg"]);
  });

  test("identical snapshots produce an empty diff", () => {
    const snap = [f("a"), f("b")];
    const diff = diffSnapshots(snap, snap.map((e) => ({ ...e })));
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
    assert.deepEqual(diff.changed, []);
    assert.equal(diff.unchangedCount, 2);
  });

  test("lists are sorted and capped at REPORT_MAX_PATHS", () => {
    const before: SnapshotEntry[] = [];
    const after: SnapshotEntry[] = [];
    for (let i = 0; i < REPORT_MAX_PATHS + 25; i++) after.push(f(`z${String(i).padStart(3, "0")}.bin`));
    const diff = diffSnapshots(before, after);
    assert.equal(diff.added.length, REPORT_MAX_PATHS);
    // sorted: the first entry is the lexicographically smallest
    assert.equal(diff.added[0], "z000.bin");
  });

  test("truncated flag propagates from either snapshot", () => {
    assert.equal(diffSnapshots([], [], true, false).truncated, true);
    assert.equal(diffSnapshots([], [], false, true).truncated, true);
    assert.equal(diffSnapshots([], [], false, false).truncated, false);
  });
});

describe("isConfigPath / configFilesChanged", () => {
  test("common config extensions are recognised case-insensitively", () => {
    assert.equal(isConfigPath("server.cfg"), true);
    assert.equal(isConfigPath("config/server.JSON"), true);
    assert.equal(isConfigPath("addons/sourcemod/configs/core.ini"), true);
    assert.equal(isConfigPath("game.yml"), true);
    assert.equal(isConfigPath("bin/server_linux"), false);
    assert.equal(isConfigPath("maps/de_dust2.bsp"), false);
    assert.equal(isConfigPath("cfg"), false); // no dot → not an extension
  });

  test("configFilesChanged filters the changed list", () => {
    const diff = diffSnapshots([f("a.cfg"), f("b.bin")], [f("a.cfg", 99), f("b.bin", 99)]);
    assert.deepEqual(configFilesChanged(diff), ["a.cfg"]);
  });
});

describe("formatUpdateReport", () => {
  test("plain report lists the three counts", () => {
    const diff = diffSnapshots([f("gone.bin")], [f("new.bin")]);
    const s = formatUpdateReport(diff);
    assert.match(s, /1 file\(s\) added/);
    assert.match(s, /0 changed/);
    assert.match(s, /1 removed/);
    assert.doesNotMatch(s, /config/);
  });

  test("config changes raise a warning with names", () => {
    const diff = diffSnapshots([f("server.cfg")], [f("server.cfg", 42, 2000)]);
    const s = formatUpdateReport(diff);
    assert.match(s, /⚠ config files changed: server\.cfg/);
  });

  test("truncated snapshots say so", () => {
    const s = formatUpdateReport(diffSnapshots([], [], true, false));
    assert.match(s, /capped/);
  });
});

describe("snapshotInstallPath (real fs)", () => {
  test("walks nested dirs, skips symlinks, reports relative paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "gsm-snap-"));
    try {
      await mkdir(join(root, "cfg"), { recursive: true });
      await mkdir(join(root, "bin"), { recursive: true });
      await writeFile(join(root, "server.cfg"), "hostname test");
      await writeFile(join(root, "bin", "run"), "x");
      await writeFile(join(root, "cfg", "mapcycle.txt"), "de_dust2");
      await symlink(join(root, "bin"), join(root, "bin-link")).catch(() => undefined);

      const { entries, truncated } = await snapshotInstallPath(root);
      assert.equal(truncated, false);
      const paths = entries.map((e) => e.path).sort();
      assert.deepEqual(paths, ["bin/run", "cfg/mapcycle.txt", "server.cfg"]);
      const cfg = entries.find((e) => e.path === "server.cfg");
      assert.ok(cfg && cfg.size > 0 && cfg.mtimeMs > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("SNAPSHOT_MAX_FILES is a sane memory guard", () => {
  assert.ok(SNAPSHOT_MAX_FILES >= 10_000 && SNAPSHOT_MAX_FILES <= 200_000);
});

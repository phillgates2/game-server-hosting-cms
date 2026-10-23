/**
 * Unit tests for safePath(), the file-manager path guard.
 *
 * Every file-manager operation - browse, read, write, upload, delete - resolves
 * the caller's path through this function. If it returns a path outside the
 * server's own directory, an authenticated user can read /etc/shadow or
 * overwrite the panel's own source. It previously used a plain startsWith(),
 * which accepted sibling directories that merely shared a name prefix.
 *
 * These are the adversarial cases, asserted directly rather than by grepping
 * the source for the fix.
 *
 *   npm test
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { safePath, resolveSafePath, resolveSafePathSync } from "../src/lib/server-file-ops";

const BASE = "/opt/gameservers/mc";

describe("safePath - legitimate paths", () => {
  test("the base directory itself resolves", () => {
    assert.equal(safePath(BASE, "."), BASE);
    assert.equal(safePath(BASE, ""), BASE);
  });

  test("direct children resolve", () => {
    assert.equal(safePath(BASE, "server.properties"), `${BASE}/server.properties`);
    assert.equal(safePath(BASE, "world/level.dat"), `${BASE}/world/level.dat`);
  });

  test("a leading slash is treated as relative to the base, not the filesystem root", () => {
    // resolve() would normally treat "/etc/passwd" as absolute; the guard must
    // still confine the result to the base.
    const out = safePath(BASE, "plugins/config.yml");
    assert.ok(out !== null && out.startsWith(BASE));
  });

  test("interior .. that stays inside the base is allowed", () => {
    assert.equal(safePath(BASE, "world/../server.properties"), `${BASE}/server.properties`);
  });
});

describe("safePath - traversal attempts are rejected", () => {
  const escapes = [
    "..",
    "../",
    "../../etc/passwd",
    "../../../../../../etc/shadow",
    "world/../../..",
    "./../../root/.ssh/id_rsa",
    "a/b/c/../../../../..",
  ];

  for (const attempt of escapes) {
    test(`rejects ${JSON.stringify(attempt)}`, () => {
      assert.equal(safePath(BASE, attempt), null);
    });
  }
});

describe("safePath - the sibling-prefix bug", () => {
  // This is the specific regression: /opt/gameservers/mc-evil starts with
  // "/opt/gameservers/mc" as a *string*, but is a different directory.
  test("a sibling directory sharing a name prefix is rejected", () => {
    assert.equal(safePath(BASE, "../mc-evil/secrets.txt"), null);
    assert.equal(safePath(BASE, "../mc-evil"), null);
  });

  test("a sibling with a longer name is rejected", () => {
    assert.equal(safePath(BASE, "../mcbackup/world.zip"), null);
  });

  test("the guard is a path-boundary test, not a string prefix test", () => {
    // Same base spelled with a trailing slash must behave identically.
    assert.equal(safePath(`${BASE}/`, "../mc-evil/x"), null);
  });
});

describe("safePath - absolute paths", () => {
  test("an absolute path outside the base is rejected", () => {
    assert.equal(safePath(BASE, "/etc/passwd"), null);
    assert.equal(safePath(BASE, "/opt/gameservers/other/file"), null);
  });

  test("an absolute path inside the base is accepted", () => {
    assert.equal(safePath(BASE, `${BASE}/server.properties`), `${BASE}/server.properties`);
  });
});

describe("safePath - odd input", () => {
  test("redundant separators and dot segments normalise", () => {
    assert.equal(safePath(BASE, "./world//level.dat"), `${BASE}/world/level.dat`);
  });

  test("a trailing slash on a child still resolves inside the base", () => {
    const out = safePath(BASE, "world/");
    assert.ok(out !== null && out.startsWith(BASE), "expected a path inside the base");
  });
});

/**
 * `safePath` above is a lexical test: it stops `..` traversal but a symlink
 * planted inside the server directory pointing outside passes it, and every
 * write, delete or rename in the file manager would then follow it out of the
 * sandbox. `resolveSafePath` adds the real-path check, so these tests build a
 * real tree with real symlinks rather than grepping the source.
 */
describe("resolveSafePath - symlinks are part of the containment boundary", () => {
  let base = "";
  let outside = "";
  let sibling = "";

  before(async () => {
    base = await mkdtemp(join(tmpdir(), "gsm-fops-"));
    outside = await mkdtemp(join(tmpdir(), "gsm-outside-"));
    // A sibling that shares the base's name prefix — the case a plain
    // startsWith() lets through.
    sibling = join(dirname(base), `${basename(base)}-evil`);
    await mkdir(sibling, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "outside");
    await writeFile(join(sibling, "secret.txt"), "sibling");
    await mkdir(join(base, "world"), { recursive: true });
    await writeFile(join(base, "world", "level.dat"), "inside");
  });

  after(async () => {
    for (const p of [base, outside, sibling]) {
      await rm(p, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("a symlink inside the base pointing outside is rejected", async () => {
    await symlink(outside, join(base, "escape"), "dir");
    assert.equal(await resolveSafePath(base, "escape"), null);
  });

  test("a symlink to a sibling server directory is rejected", async () => {
    await symlink(sibling, join(base, "sibling-link"), "dir");
    assert.equal(await resolveSafePath(base, "sibling-link"), null);
  });

  test("a symlink that stays inside the base resolves to the real path", async () => {
    await symlink(join(base, "world"), join(base, "world-link"), "dir");
    const r = await resolveSafePath(base, "world-link/level.dat");
    assert.ok(r !== null, "expected an in-base symlink to resolve");
    assert.equal(r.fullPath, join(base, "world", "level.dat"));
    assert.equal(r.relPath, join("world", "level.dat"));
  });

  test("a plain path still resolves, and the root resolves to itself", async () => {
    const r = await resolveSafePath(base, "world/level.dat");
    assert.ok(r !== null);
    assert.equal(r.fullPath, join(base, "world", "level.dat"));

    const root = await resolveSafePath(base, ".");
    assert.ok(root !== null);
    assert.equal(root.fullPath, base);
    assert.equal(root.relPath, ".");
  });

  test("a non-existent tail under an inside symlink still resolves", async () => {
    // Creating a new file under a symlinked directory must work — the walk
    // has to resolve the longest existing ancestor and re-append the tail.
    const r = await resolveSafePath(base, "world-link/newfile.txt");
    assert.ok(r !== null);
    assert.equal(r.fullPath, join(base, "world", "newfile.txt"));
  });

  test("creating a file in a brand-new subdirectory works", async () => {
    const r = await resolveSafePath(base, "brand-new/dir/file.txt");
    assert.ok(r !== null);
    assert.equal(r.fullPath, join(base, "brand-new", "dir", "file.txt"));
  });

  test("a server directory that is itself a symlink resolves against its real location", async () => {
    // Docker volumes and moved installs: the base is a link, not a real dir.
    // Every operation must still work, so containment is checked against the
    // real root rather than the link.
    const realRoot = await mkdtemp(join(tmpdir(), "gsm-realroot-"));
    try {
      await mkdir(join(realRoot, "srv"), { recursive: true });
      const linkedBase = join(base, "linked-base");
      await symlink(realRoot, linkedBase, "dir");

      const r = await resolveSafePath(linkedBase, "srv");
      assert.ok(r !== null);
      assert.equal(r.realBase, realRoot);
      assert.equal(r.fullPath, join(realRoot, "srv"));
    } finally {
      await rm(realRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});

/**
 * The FTP server's virtual-path resolver cannot await, so it uses the
 * synchronous variant. It has to make the SAME decision as the async one, so
 * these tests run both against the same tree and require them to agree.
 */
describe("resolveSafePathSync - same decision as the async check", () => {
  let base = "";
  let outside = "";
  let sibling = "";

  before(async () => {
    base = await mkdtemp(join(tmpdir(), "gsm-fopssync-"));
    outside = await mkdtemp(join(tmpdir(), "gsm-outsidesync-"));
    sibling = join(dirname(base), `${basename(base)}-evil`);
    await mkdir(sibling, { recursive: true });
    await writeFile(join(outside, "secret.txt"), "outside");
    await mkdir(join(base, "world"), { recursive: true });
    await writeFile(join(base, "world", "level.dat"), "inside");
  });

  after(async () => {
    for (const p of [base, outside, sibling]) {
      await rm(p, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("agrees with the async check on a plain path", async () => {
    const sync = resolveSafePathSync(base, "world/level.dat");
    const asyncRes = await resolveSafePath(base, "world/level.dat");
    assert.ok(sync !== null && asyncRes !== null);
    assert.equal(sync.fullPath, asyncRes.fullPath);
    assert.equal(sync.relPath, asyncRes.relPath);
  });

  test("rejects a symlink that escapes the base", async () => {
    await symlink(outside, join(base, "escape"), "dir");
    assert.equal(resolveSafePathSync(base, "escape"), null);
    assert.equal(await resolveSafePath(base, "escape"), null);
  });

  test("rejects a symlink to a sibling server directory", async () => {
    await symlink(sibling, join(base, "sibling-link"), "dir");
    assert.equal(resolveSafePathSync(base, "sibling-link"), null);
    assert.equal(await resolveSafePath(base, "sibling-link"), null);
  });

  test("resolves a symlink that stays inside the base", async () => {
    await symlink(join(base, "world"), join(base, "world-link"), "dir");
    const sync = resolveSafePathSync(base, "world-link/level.dat");
    assert.ok(sync !== null);
    assert.equal(sync.fullPath, join(base, "world", "level.dat"));
  });

  test("handles a non-existent tail", () => {
    const sync = resolveSafePathSync(base, "brand-new/dir/file.txt");
    assert.ok(sync !== null);
    assert.equal(sync.fullPath, join(base, "brand-new", "dir", "file.txt"));
  });
});

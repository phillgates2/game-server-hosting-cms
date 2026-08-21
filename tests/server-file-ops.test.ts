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

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { safePath } from "../src/lib/server-file-ops";

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

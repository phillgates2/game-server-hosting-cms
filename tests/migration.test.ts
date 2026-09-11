/**
 * Tests for server migration between nodes.
 *
 * The pure pieces decide WHERE a server lands and WHETHER it may move; both
 * are pinned here. The bytes-on-the-wire part is covered by the agent e2e
 * suite, which exercises the real download/import endpoints.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  slugify,
  computeDestInstallPath,
  migrationBlockReason,
  MIGRATION_CHUNK_BYTES,
} from "../src/lib/migration";

describe("slugify", () => {
  test("lowercases and dashes", () => {
    assert.equal(slugify("My TF2 Server!"), "my-tf2-server");
  });

  test("trims edge dashes and caps length", () => {
    assert.equal(slugify("--hello--"), "hello");
    assert.ok(slugify("x".repeat(200)).length <= 64);
  });

  test("never yields an empty slug", () => {
    assert.equal(slugify("!!!"), "server");
    assert.equal(slugify(""), "server");
  });
});

describe("computeDestInstallPath", () => {
  test("composes node base / game / server", () => {
    assert.equal(
      computeDestInstallPath("/opt/gameservers", "team-fortress-2", "My Server"),
      "/opt/gameservers/team-fortress-2/my-server"
    );
  });

  test("strips trailing slashes on the node base", () => {
    assert.equal(
      computeDestInstallPath("/opt/gameservers///", "gmod", "Box"),
      "/opt/gameservers/gmod/box"
    );
  });

  test("falls back to a sane base and game dir", () => {
    assert.equal(computeDestInstallPath(null, null, "S"), "/opt/gameservers/game/s");
  });
});

describe("migrationBlockReason", () => {
  test("a running server cannot move", () => {
    assert.match(String(migrationBlockReason("running")), /Stop the server/);
  });

  test("an installing server cannot move", () => {
    assert.match(String(migrationBlockReason("installing")), /install/);
  });

  test("stopped and crashed servers may move", () => {
    assert.equal(migrationBlockReason("stopped"), null);
    assert.equal(migrationBlockReason("crashed"), null);
  });

  test("the chunk size is sane for base64 transport", () => {
    assert.ok(MIGRATION_CHUNK_BYTES > 0);
    // Must stay comfortably inside the agent's 32 MB request cap once base64
    // inflates it by ~33%.
    assert.ok(Math.ceil(MIGRATION_CHUNK_BYTES * 4 / 3) < 32 * 1024 * 1024);
  });
});

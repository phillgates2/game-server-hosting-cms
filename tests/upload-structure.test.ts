/**
 * Tests for folder-preserving uploads.
 *
 * Dropping a folder used to flatten it: DataTransfer.files discards directory
 * structure, so every file landed in the target directory and nested layouts
 * (plugins/, world/region/, config trees) were destroyed.
 *
 * The client now walks the drop with the entry API and sends a nested
 * destination path. That means the *client* controls part of the write path,
 * so these tests cover both halves: the structure is recreated faithfully, and
 * a malicious relative path still cannot escape the server directory.
 *
 *   npm test
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveUploadedFile } from "../src/lib/server-file-ops";

let base: string;

before(() => {
  base = mkdtempSync(join(tmpdir(), "gsm-upload-test-"));
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("nested uploads recreate the folder structure", () => {
  test("a loose file lands at the root", async () => {
    const r = await saveUploadedFile(base, ".", "server.properties", Buffer.from("a=1"));
    assert.equal(r.path, "server.properties");
    assert.ok(existsSync(join(base, "server.properties")));
  });

  test("a one-level folder is created", async () => {
    const r = await saveUploadedFile(base, "./plugins", "config.yml", Buffer.from("x: 1"));
    assert.equal(r.path, "plugins/config.yml");
    assert.equal(readFileSync(join(base, "plugins", "config.yml"), "utf8"), "x: 1");
  });

  test("deeply nested folders are created recursively", async () => {
    const r = await saveUploadedFile(
      base,
      "./plugins/EssentialsX/userdata",
      "player.yml",
      Buffer.from("uuid: abc")
    );
    assert.equal(r.path, "plugins/EssentialsX/userdata/player.yml");
    assert.ok(existsSync(join(base, "plugins", "EssentialsX", "userdata", "player.yml")));
  });

  test("sibling trees do not collide", async () => {
    await saveUploadedFile(base, "./world/region", "r.0.0.mca", Buffer.from("A"));
    await saveUploadedFile(base, "./world_nether/region", "r.0.0.mca", Buffer.from("B"));
    assert.equal(readFileSync(join(base, "world", "region", "r.0.0.mca"), "utf8"), "A");
    assert.equal(readFileSync(join(base, "world_nether", "region", "r.0.0.mca"), "utf8"), "B");
  });

  test("uploading into an existing folder does not clobber its siblings", async () => {
    await saveUploadedFile(base, "./plugins", "second.yml", Buffer.from("y: 2"));
    assert.ok(existsSync(join(base, "plugins", "config.yml")), "earlier file must survive");
    assert.ok(existsSync(join(base, "plugins", "second.yml")));
  });
});

describe("a client-supplied path cannot escape the server directory", () => {
  // The relative path now comes from the browser, so it is untrusted input.
  const escapes: Array<[string, string, string]> = [
    ["../..", "escape.txt", "parent traversal in the directory"],
    ["./plugins/../../../etc", "passwd", "traversal in the middle of the path"],
    [".", "../../evil.txt", "traversal smuggled in the file name"],
    ["/etc", "passwd", "absolute directory"],
    ["./a/../../../..", "x", "many levels up"],
  ];

  for (const [dir, name, label] of escapes) {
    test(`rejects ${label}`, async () => {
      await assert.rejects(
        () => saveUploadedFile(base, dir, name, Buffer.from("pwned")),
        /outside server directory/i,
        `${dir}/${name} should not be writable`
      );
    });
  }

  test("nothing was written outside the base directory", () => {
    assert.ok(!existsSync(join(base, "..", "escape.txt")));
    assert.ok(!existsSync(join(base, "..", "evil.txt")));
  });
});

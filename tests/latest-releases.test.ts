import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ETLEGACY_RELEASE_PARSER, VINTAGE_STORY_RELEASE_PARSER } from "../src/db/games/release-resolvers";
import { wolfensteinET } from "../src/db/games/wolfenstein-et";

const page = `<h2>ET: Legacy stable release 2.99.0 - Test</h2>
<a href="/download/file/9001"><span>x86_64</span> archive</a>
<a href="https://www.etlegacy.com/download/file/9002">i386 archive</a>
<a href="/download/file/9003">All supported archive</a>`;
function parse(source: string, input: string) {
  return spawnSync("python3", ["-c", source], { input, encoding: "utf8" });
}

describe("latest stable release resolution", () => {
  test("ET engine and mod links resolve together without fixed IDs", () => {
    const result = parse(ETLEGACY_RELEASE_PARSER, page);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [
      "2.99.0", "https://www.etlegacy.com/download/file/9001",
      "https://www.etlegacy.com/download/file/9002", "https://www.etlegacy.com/download/file/9003",
    ]);
  });
  test("ET refuses incomplete metadata, nonstable pages and foreign download links", () => {
    for (const input of ["", page.replace("All supported archive", "missing"), page.replace("stable release", "snapshot"), page.replace("https://www.etlegacy.com/download/file/9002", "https://untrusted.test/download/file/9002")]) {
      const failed = parse(ETLEGACY_RELEASE_PARSER, input);
      assert.notEqual(failed.status, 0, `input ${JSON.stringify(input.slice(0, 40))} should fail closed`);
      // The reason must reach stdout: the panel's update log is how the
      // user sees it, and a bare "Exit 1" is undiagnosable.
      assert.match(failed.stdout, /could not resolve the latest stable ET:Legacy engine and mod archives/, failed.stderr);
    }
  });
  test("Vintage Story selects the marked stable Linux server, not the first key or preview", () => {
    const result = parse(VINTAGE_STORY_RELEASE_PARSER, JSON.stringify({
      "1.22.7": { linuxserver: {} }, "1.23.0-rc.1": { linuxserver: { latest: 1 } },
      "1.23.0": { linuxserver: { latest: 1 } },
    }));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "1.23.0");
  });
  test("Vintage Story fails closed if metadata is invalid, missing or ambiguous", () => {
    for (const input of ["not json", "{}", '{"1.23.0":{"linuxserver":{"latest":1}},"1.24.0":{"linuxserver":{"latest":1}}}']) {
      assert.notEqual(parse(VINTAGE_STORY_RELEASE_PARSER, input).status, 0);
    }
  });

  test("ET updates existing engine and mod files, and rejects a mod archive missing the selected architecture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gsm-et-update-"));
    try {
      const install = join(dir, "server");
      const bin = join(dir, "bin");
      await mkdir(bin);
      await mkdir(join(install, "legacy"), { recursive: true });
      await mkdir(join(install, "etmain"));
      await writeFile(join(install, "legacy/qagame.mp.x86_64.so"), "old mod");
      await writeFile(join(install, "legacy/server.cfg"), "custom config");
      await writeFile(join(install, "etlded"), "old engine");
      for (const name of ["pak0.pk3", "pak1.pk3", "pak2.pk3"]) await writeFile(join(install, "etmain", name), "base assets");
      await writeFile(join(dir, "page.html"), page);
      const zipResult = spawnSync("python3", ["-c", `
import zipfile, sys
from pathlib import Path
root = Path(sys.argv[1])
with zipfile.ZipFile(root / "engine.zip", "w") as z:
    z.writestr("etlded", "new engine")
with zipfile.ZipFile(root / "mod.zip", "w") as z:
    z.writestr("legacy/qagame.mp.x86_64.so", "new mod")
    z.writestr("legacy/legacy_v2.99.0.pk3", "new assets")
with zipfile.ZipFile(root / "bad-mod.zip", "w") as z:
    z.writestr("legacy/qagame.mp.i386.so", "wrong arch")
`, dir], { encoding: "utf8" });
      assert.equal(zipResult.status, 0, zipResult.stderr);
      await writeFile(join(bin, "curl"), `#!/bin/bash
out=""; url=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o) shift; out="$1";; https:*) url="$1";; esac
  shift
done
case "$url" in
  https://www.etlegacy.com/download) cat "$FIXTURE/page.html" ;;
  */9001) cp "$FIXTURE/engine.zip" "$out" ;;
  */9003) cp "$FIXTURE/$MOD_ARCHIVE" "$out" ;;
  *) echo "Unexpected URL: $url" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
      const script = wolfensteinET.installScript.split("# ── Step 4:")[0]
        .replaceAll("{{INSTALL_PATH}}", install).replaceAll("{{ET_MOD}}", "legacy");
      const run = (archive: string) => spawnSync("bash", ["-c", script], {
        encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE: dir, MOD_ARCHIVE: archive },
      });
      const updated = run("mod.zip");
      assert.equal(updated.status, 0, updated.stdout + updated.stderr);
      assert.match(updated.stdout, /Resolved ET:Legacy stable release: 2.99.0/);
      assert.equal(await readFile(join(install, "etlded"), "utf8"), "new engine");
      assert.equal(await readFile(join(install, "legacy/qagame.mp.x86_64.so"), "utf8"), "new mod");
      assert.equal(await readFile(join(install, "legacy/legacy_v2.99.0.pk3"), "utf8"), "new assets");
      assert.equal(await readFile(join(install, "legacy/server.cfg"), "utf8"), "custom config");
      const failed = run("bad-mod.zip");
      assert.notEqual(failed.status, 0);
      assert.match(failed.stderr, /lacks the x86_64 server module/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

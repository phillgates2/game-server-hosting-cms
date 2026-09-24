import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildTemplateUpdateScript } from "../src/lib/server-update-script";
import { buildSteamUpdateScript, formatUpdateFailure, runUpdateScript } from "../src/lib/server-update-runner";
import { gameTemplates } from "../src/db/games";

const server = {
  name: "Test server", installPath: "/tmp/test-server", port: 25565,
  queryPort: null, rconPort: null, variables: {}, config: {},
  gameSlug: null, installScript: null, steamcmdPath: null,
};

describe("server update scripts", () => {
  test("every non-Steam bundled game has a syntactically valid update script", () => {
    for (const template of gameTemplates.filter(t => !t.steamAppId)) {
      const script = buildTemplateUpdateScript({ ...server, gameSlug: template.slug });
      assert.ok(script, template.slug);
      assert.ok(!script.includes("{{"), `unresolved variables in ${template.slug}`);
      const check = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
      assert.equal(check.status, 0, `${template.slug}: ${check.stderr}`);
    }
  });

  test("uses current bundled downloader rather than stale stored script", () => {
    const script = buildTemplateUpdateScript({ ...server, gameSlug: "minecraft-java", installScript: "echo stale" });
    assert.ok(script);
    assert.doesNotMatch(script, /echo stale/);
    assert.match(script, /server\.jar/);
  });

  test("preserves version pins and defaults missing template variables", () => {
    const script = buildTemplateUpdateScript({ ...server, gameSlug: "minecraft-fabric", variables: { MC_VERSION: "1.21.1" } });
    assert.ok(script);
    assert.match(script, /MC_VERSION="1\.21\.1"/);
    assert.doesNotMatch(script, /\{\{/);
  });

  test("custom scripts use stored variables but authoritative install paths", () => {
    const script = buildTemplateUpdateScript({
      ...server, installScript: 'echo "{{VERSION}} {{PORT}} {{INSTALL_PATH}} {{STEAMCMD_PATH}}"',
      config: { VERSION: "old" }, variables: { VERSION: "latest", INSTALL_PATH: "/wrong" },
      steamcmdPath: "/srv/steamcmd",
    });
    assert.match(script!, /latest 25565 \/tmp\/test-server \/srv\/steamcmd/);
    assert.doesNotMatch(script!, /\/wrong/);
  });

  test("renders placeholders inside literal heredocs like the installer", () => {
    const script = buildTemplateUpdateScript({ ...server, installScript: "cat <<'EOF'\n{{SERVER_NAME}}\nEOF" });
    assert.match(script!, /\nTest server\nEOF/);
  });

  test("missing custom downloader is unsupported, not a successful no-op", () => {
    assert.equal(buildTemplateUpdateScript(server), null);
    assert.equal(buildTemplateUpdateScript({ ...server, installScript: "  " }), null);
  });

  test("Steam updates retain app_update validate and the node's SteamCMD path", () => {
    const script = buildSteamUpdateScript({ ...server, gameName: "Test", steamAppId: "740", steamcmdDir: "/srv/steamcmd" });
    assert.match(script, /\/srv\/steamcmd\/steamcmd.sh/);
    assert.match(script, /\+app_update 740 validate \+quit/);
  });

  test("failure responses keep stderr — where installers report real errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gsm-update-stderr-"));
    try {
      let failed: unknown;
      try {
        await runUpdateScript({ installPath: dir, script: "echo progress on stdout\necho 'curl: (22) The requested URL returned error: 403' >&2\nexit 1" });
        throw new Error("expected runUpdateScript to reject");
      } catch (e) { failed = e; }
      const err = failed as Error & { stdout?: string; stderr?: string };
      assert.match(err.message, /Exit 1/);
      assert.match(err.stdout ?? "", /progress on stdout/);
      assert.match(err.stderr ?? "", /curl: \(22\)/);

      const formatted = formatUpdateFailure(err);
      assert.equal(formatted.error, "Update failed (exit 1)");
      assert.match(formatted.output, /progress on stdout/);
      assert.match(formatted.errorOutput, /curl: \(22\)/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("formatUpdateFailure keeps descriptive errors and trims long streams", () => {
    assert.deepEqual(formatUpdateFailure({}), { error: "Update failed", output: "", errorOutput: "" });
    assert.equal(formatUpdateFailure({ message: "Update timed out" }).error, "Update timed out");
    assert.equal(formatUpdateFailure({ message: "Remote update failed (exit 127)" }).error, "Remote update failed (exit 127)");
    const big = "x".repeat(9000);
    const out = formatUpdateFailure({ message: "Exit 2", stdout: big, stderr: big });
    assert.equal(out.output.length, 4000);
    assert.equal(out.errorOutput.length, 4000);
  });

  test("ET:Legacy update retries the large engine download like the other fetches", () => {
    const script = buildTemplateUpdateScript({ ...server, gameSlug: "wolfenstein-et" });
    assert.ok(script, "wolfenstein-et update script");
    assert.match(script!, /curl -fL --retry 3 --retry-delay 2 -A "\$ETL_UA" -o etlegacy-archive "\$ETL_URL"/);
  });

  test("runs a custom downloader in place without regenerating configs or saves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gsm-update-test-"));
    try {
      await writeFile(join(dir, "server.cfg"), "custom config");
      await writeFile(join(dir, "world.save"), "world data");
      await writeFile(join(dir, "server.bin"), "old");
      const script = buildTemplateUpdateScript({ ...server, installPath: dir, installScript: 'printf latest > server.bin\necho updated' });
      const result = await runUpdateScript({ installPath: dir, script: script! });
      assert.match(result.stdout, /updated/);
      assert.equal(await readFile(join(dir, "server.bin"), "utf8"), "latest");
      assert.equal(await readFile(join(dir, "server.cfg"), "utf8"), "custom config");
      assert.equal(await readFile(join(dir, "world.save"), "utf8"), "world data");
      await assert.rejects(runUpdateScript({ installPath: dir, script: "exit 7" }), /Exit 7/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

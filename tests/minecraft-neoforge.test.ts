/**
 * Tests for the Minecraft NeoForge template.
 *
 * NeoForge installs through official installer jars on maven.neoforged.net:
 * the script resolves the latest stable version from Maven metadata, ensures
 * a suitable Java runtime (mirroring the vanilla template's ensure_java), runs
 * the installer headless (--installServer), then starts via run.sh with a
 * panel-managed user_jvm_args.txt. The loader needs Java 25 for the 26.x
 * (Minecraft year-based) line and Java 21 for the legacy 21.x line.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { minecraftNeoForge } from "../src/db/games/minecraft-neoforge";

const S = minecraftNeoForge.installScript;

describe("minecraft-neoforge install script", () => {
  test("resolves the latest STABLE version from the official Maven metadata", () => {
    assert.match(S, /maven\.neoforged\.net\/releases\/net\/neoforged\/neoforge\/maven-metadata\.xml/);
    assert.match(S, /grep -vE -- '-beta\|-alpha\|-rc'/);
    assert.match(S, /sort -V \| tail -1/, "highest release wins");
    assert.match(S, /NEOFORGE_VERSION="\{\{NEOFORGE_VERSION\}\}"/, "a pinned version wins");
  });

  test("picks Java 25 for the 26.x line and 21 for legacy", () => {
    assert.match(S, /26\.\*\) MIN_JAVA=25/);
    assert.match(S, /\*\)    MIN_JAVA=21/);
    assert.match(S, /case "\$NEOFORGE_VERSION" in/, "the heuristic is keyed on the version");
  });

  test("ensure_java is actually invoked (regression: defined but never called)", () => {
    assert.match(S, /ensure_java "\$MIN_JAVA"/);
  });

  test("downloads the installer and runs it headless with --installServer", () => {
    assert.match(S, /neoforge-\$NEOFORGE_VERSION-installer\.jar/);
    assert.match(S, /\$JAVA_BIN" -jar "\$INSTALLER" --installServer/);
  });

  test("keeps the expanded shell escapes intact (no literal ${have:-none})", () => {
    // The shared ensure_java text must reach the script un-escaped: bash
    // expands ${have:-none}, it must not appear as "\${have:-none}".
    assert.match(S, /found: \$\{have:-none\}/);
    assert.ok(!S.includes("\\\\${have:-none}"), "no backslash before the shell variable");
  });

  test("validates the installer output (run.sh + versioned unix_args.txt)", () => {
    assert.match(S, /if \[ ! -f run\.sh \] \|\| \[ ! -f "libraries\/net\/neoforged\/neoforge\/\$NEOFORGE_VERSION\/unix_args\.txt" \]/);
    assert.match(S, /chmod \+x run\.sh/);
  });

  test("writes a panel-owned user_jvm_args.txt (one flag per line) and the EULA", () => {
    assert.match(S, /-Xms\{\{MIN_RAM\}\}G/);
    assert.match(S, /-Xmx\{\{MAX_RAM\}\}G/);
    assert.match(S, /tr ' ' '\\n'/, "JVM_FLAGS are split onto their own lines");
    assert.match(S, /echo "eula=true" > eula\.txt/);
  });
});

describe("minecraft-neoforge start + config", () => {
  test("starts via run.sh, preferring a server-local Java on PATH", () => {
    const start = minecraftNeoForge.startCommand ?? "";
    assert.match(start, /export PATH="\$PWD\/\.java\/bin:\$PATH"/);
    assert.ok(start.indexOf("export PATH") < start.indexOf("run.sh nogui"), "PATH is set before the launch");
    assert.match(start, /exec bash run\.sh nogui/);
  });

  test("server.properties is the config file (same properties as vanilla)", () => {
    assert.deepEqual(minecraftNeoForge.configFiles, { "server.properties": "server.properties" });
    const cfg = JSON.stringify(minecraftNeoForge.defaultConfig);
    assert.ok(cfg.includes('"server-port":"{{PORT}}"'));
    assert.ok(cfg.includes('"enable-rcon":"{{ENABLE_RCON}}"'));
  });

  test("the template declares the version pin variable", () => {
    const pin = minecraftNeoForge.variables.find((v) => v.env_variable === "NEOFORGE_VERSION");
    assert.ok(pin, "NEOFORGE_VERSION variable exists");
    assert.equal(pin.default_value, "");
  });
});

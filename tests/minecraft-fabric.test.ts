/**
 * Tests for the Minecraft Fabric template.
 *
 * Fabric installs through the official fabric-installer, resolved from
 * meta.fabricmc.net (loader, game version, installer). The installer writes
 * fabric-server-launch.jar, which is how the server starts. The 26.x
 * (Minecraft year-based) line needs Java 25, older lines Java 21.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { minecraftFabric } from "../src/db/games/minecraft-fabric";

const S = minecraftFabric.installScript;

describe("minecraft-fabric install script", () => {
  test("resolves loader, game and installer from the official meta API", () => {
    assert.match(S, /https:\/\/meta\.fabricmc\.net\/v2\/versions\/loader/);
    assert.match(S, /https:\/\/meta\.fabricmc\.net\/v2\/versions\/game/);
    assert.match(S, /https:\/\/meta\.fabricmc\.net\/v2\/versions\/installer/);
  });

  test("picks only STABLE entries (whitespace-tolerant flat JSON)", () => {
    assert.match(S, /tr -d '\\n '/, "newlines AND spaces are stripped before parsing");
    assert.match(S, /"stable":true/, "the stable flag gates the pick");
    assert.match(S, /head -1/, "newest first wins");
  });

  test("pinned wizard fields win over the meta lookup", () => {
    assert.match(S, /FABRIC_LOADER="\{\{FABRIC_LOADER\}\}"/);
    assert.match(S, /MC_VERSION="\{\{MC_VERSION\}\}"/);
  });

  test("chooses Java 25 for the 26.x line, 21 otherwise", () => {
    assert.match(S, /26\.\*\) MIN_JAVA=25/);
    assert.match(S, /\*\)    MIN_JAVA=21/);
  });

  test("ensure_java is actually invoked", () => {
    assert.match(S, /ensure_java "\$MIN_JAVA"/);
  });

  test("runs the official installer in server mode and validates its output", () => {
    assert.match(S, /server -dir \. -mcversion "\$MC_VERSION" -loader "\$FABRIC_LOADER" -downloadMinecraft/);
    assert.match(S, /fabric-server-launch\.jar/);
    assert.match(S, /if \[ ! -f fabric-server-launch\.jar \] \|\| \[ ! -f server\.jar \]/);
  });

  test("writes the EULA and keeps shell escapes intact", () => {
    assert.match(S, /echo "eula=true" > eula\.txt/);
    assert.match(S, /found: \$\{have:-none\}/);
    assert.ok(!S.includes("\\\\${have:-none}"));
  });
});

describe("minecraft-fabric start + config", () => {
  test("starts fabric-server-launch.jar with a panel-managed heap", () => {
    const start = minecraftFabric.startCommand ?? "";
    assert.match(start, /-jar fabric-server-launch\.jar nogui --port \{\{PORT\}\}/);
    assert.match(start, /-Xms\{\{MIN_RAM\}\}G -Xmx\{\{MAX_RAM\}\}G/);
    assert.match(start, /export PATH="\$PWD\/\.java\/bin:\$PATH"/);
  });

  test("variable declarations include the version pins; config is server.properties", () => {
    assert.ok(minecraftFabric.variables.some((v) => v.env_variable === "FABRIC_LOADER"));
    assert.ok(minecraftFabric.variables.some((v) => v.env_variable === "MC_VERSION"));
    assert.deepEqual(minecraftFabric.configFiles, { "server.properties": "server.properties" });
    assert.match(JSON.stringify(minecraftFabric.defaultConfig), /"server-port":"\{\{PORT\}\}"/);
  });
});

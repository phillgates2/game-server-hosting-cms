/**
 * Tests for the Terraria/TShock template's .NET runtime handling.
 *
 * TShock 6.x ships a framework-dependent .NET 9 apphost: without the runtime
 * the server dies at start with "You must install .NET to run this
 * application / Failed to resolve libhostfxr.so". The template therefore
 * installs a server-local runtime (mirroring the Minecraft template's
 * ensure_java) and the start command points DOTNET_ROOT at it.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { terraria } from "../src/db/games/terraria";

describe("terraria template (.NET runtime)", () => {
  test("the install script calls ensure_dotnet (warning-only on failure)", () => {
    const script = terraria.installScript;
    assert.match(script, /ensure_dotnet\(\) \{/);
    assert.match(script, /ensure_dotnet \|\| true/, "a failed runtime install must not abort the install");
  });

  test("a system .NET 9 runtime is accepted", () => {
    assert.match(terraria.installScript, /dotnet --list-runtimes/);
    assert.match(terraria.installScript, /Microsoft\.NETCore\.App 9/);
  });

  test("otherwise a server-local runtime is fetched from the official script", () => {
    const script = terraria.installScript;
    assert.match(script, /https:\/\/dot\.net\/v1\/dotnet-install\.sh/);
    assert.match(script, /--channel 9\.0/);
    assert.match(script, /--runtime aspnetcore/, "aspnetcore is a superset of the core runtime");
    assert.match(script, /--install-dir "\$INSTALL_DIR\/\.dotnet"/);
  });

  test("the start command prefers the server-local runtime", () => {
    const start = terraria.startCommand ?? "";
    assert.match(start, /DOTNET_ROOT="\{\{INSTALL_PATH\}\}\/\.dotnet"/);
    assert.match(start, /PATH="\{\{INSTALL_PATH\}\}\/\.dotnet:\$PATH"/);
    const guard = start.indexOf("[ -x \"{{INSTALL_PATH}}/.dotnet/dotnet\" ]");
    const exec = start.indexOf("exec ./TShock.Server");
    assert.ok(guard >= 0 && guard < exec, "DOTNET_ROOT must be set before the server starts");
  });

  test("the TShock launch arguments survive the runtime wiring", () => {
    const start = terraria.startCommand ?? "";
    for (const arg of ["-ip 0.0.0.0", "-port {{PORT}}", "-maxplayers {{MAX_PLAYERS}}", "-autocreate {{WORLD_SIZE}}", '-world "{{INSTALL_PATH}}/worlds/{{WORLD_NAME}}.wld"']) {
      assert.ok(start.includes(arg), `missing launch argument: ${arg}`);
    }
  });
});

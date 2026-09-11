/**
 * Tests for the four new game templates: Unturned, Core Keeper, Mindustry,
 * Vintage Story.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unturned } from "../src/db/games/unturned";
import { coreKeeper } from "../src/db/games/core-keeper";
import { mindustry } from "../src/db/games/mindustry";
import { vintageStory } from "../src/db/games/vintage-story";

describe("unturned", () => {
  test("installs AppID 1110390 for linux with the 32-bit warning off", () => {
    assert.match(unturned.installScript, /STEAM_APPID="1110390"/);
    // linux is the builder's default: no ForcePlatformType flag is emitted and
    // no 32-bit multiarch warning applies (this is an x86_64 server).
    assert.ok(!unturned.installScript.includes("ForcePlatformType"));
    assert.ok(!unturned.installScript.includes("i386"), "x86_64 server, no multiarch warning");
  });

  test("writes Commands.dat (with the panel's values) into Servers/<dir>/Server", () => {
    assert.match(unturned.installScript, /Servers\/\$SERVER_DIR\/Server\/Commands\.dat/);
    assert.match(unturned.installScript, /Name \{\{SERVER_NAME\}\}/);
    assert.match(unturned.installScript, /Map \{\{MAP\}\}/);
    assert.match(unturned.installScript, /MaxPlayers \{\{MAX_PLAYERS\}\}/);
    assert.match(unturned.installScript, /Mode \{\{MODE\}\}/);
  });

  test("starts the headless binary with the InternetServer instance", () => {
    const start = unturned.startCommand ?? "";
    assert.match(start, /Unturned_Headless\.x86_64 -batchmode -nographics -bind 0\.0\.0\.0 -port \{\{PORT\}\}/);
    assert.match(start, /\+InternetServer\/\{\{SERVER_DIR\}\}/);
  });

  test("defaults are PEI / Normal / Both on port 27015", () => {
    assert.equal(unturned.defaultPort, 27015);
    assert.equal(unturned.steamAppId, "1110390");
    assert.equal(unturned.variables.find((v) => v.env_variable === "MAP")?.default_value, "PEI");
    assert.equal(unturned.variables.find((v) => v.env_variable === "PERSPECTIVE")?.default_value, "Both");
  });
});

describe("core-keeper", () => {
  test("uses the dedicated-server AppID 1963720 (NOT 1005950)", () => {
    assert.equal(coreKeeper.steamAppId, "1963720");
    assert.match(coreKeeper.installScript, /STEAM_APPID="1963720"/);
  });

  test("starts _launch.sh with -datapath inside the install dir", () => {
    const start = coreKeeper.startCommand ?? "";
    assert.match(start, /bash _launch\.sh -batchmode/);
    assert.match(start, /-datapath "\{\{INSTALL_PATH\}\}\/DedicatedServer"/);
    assert.match(start, /-port \{\{PORT\}\}/);
    assert.match(start, /-maxplayers \{\{MAX_PLAYERS\}\}/);
  });

  test("renders ServerConfig.json with the world + network keys", () => {
    const cfg = JSON.stringify(coreKeeper.defaultConfig);
    assert.ok(cfg.includes('"gameId":"{{GAME_ID}}"'));
    assert.ok(cfg.includes('"world":"{{WORLD}}"'));
    assert.ok(cfg.includes('"worldMode":"{{WORLD_MODE}}"'));
    assert.ok(cfg.includes('"maxNumberPlayers":"{{MAX_PLAYERS}}"'));
    assert.ok(cfg.includes('"seasonOverride":"{{SEASON}}"'));
  });
});

describe("mindustry", () => {
  test("downloads server-release.jar and validates it", () => {
    assert.match(mindustry.installScript, /server-release\.jar/);
    assert.match(mindustry.installScript, /"PK"/, "the jar is zip-magic checked");
  });

  test("the wrapper pipes 'config port' + 'host' and bridges console input", () => {
    assert.match(mindustry.installScript, /config port %s/);
    assert.match(mindustry.installScript, /host%s/);
    assert.match(mindustry.installScript, /cat; \}/);
    assert.match(mindustry.installScript, /mindustry-start\.sh/);
  });

  test("mode is folded into the host args (never a bare mode)", () => {
    const fold = mindustry.installScript.split("\n").find((l) => l.includes('EXTRA="$EXTRA'));
    assert.ok(fold && fold.includes('$MODE'), "fold line: " + fold);
    assert.ok(!fold?.includes('EXTRA="$EXTRA $MODE"'), "mode must not appear alone");
  });

  test("run command uses the wrapper; port default 6567", () => {
    assert.match(mindustry.startCommand ?? "", /bash mindustry-start\.sh/);
    assert.equal(mindustry.defaultPort, 6567);
  });
});

describe("vintage-story", () => {
  test("pins a server version and downloads from the official CDN", () => {
    assert.equal(vintageStory.variables.find((v) => v.env_variable === "VS_VERSION")?.default_value, "1.22.7");
    assert.match(vintageStory.installScript, /cdn\.vintagestory\.at\/gamefiles\/stable/);
    assert.match(vintageStory.installScript, /vs_server_linux-x64_\$VS_VERSION\.tar\.gz/);
  });

  test("installs a server-local .NET 10 runtime (1.22.x demands it)", () => {
    assert.match(vintageStory.installScript, /--channel 10\.0/);
    assert.match(vintageStory.installScript, /--runtime aspnetcore/);
    assert.match(vintageStory.installScript, /ensure_dotnet \|\| true/);
  });

  test("starts the apphost with DOTNET_ROOT pointing at the local runtime", () => {
    const start = vintageStory.startCommand ?? "";
    assert.match(start, /DOTNET_ROOT="\{\{INSTALL_PATH\}\}\/\.dotnet"/);
    assert.match(start, /exec \.\/VintagestoryServer --dataPath "\{\{INSTALL_PATH\}\}\/data"/);
  });

  test("renders serverconfig.json into the data path", () => {
    assert.deepEqual(vintageStory.configFiles, { "data/serverconfig.json": "serverconfig.json" });
    const cfg = JSON.stringify(vintageStory.defaultConfig);
    assert.ok(cfg.includes('"ServerName":"{{SERVER_NAME}}"'));
    assert.ok(cfg.includes('"SaveName":"{{SAVE_NAME}}"'));
  });
});

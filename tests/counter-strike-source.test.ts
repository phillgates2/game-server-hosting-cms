/**
 * Tests for the Counter-Strike: Source template.
 *
 * CS:S runs Valve's 32-bit srcds (AppID 740) — the i386 warning must be on.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { counterStrikeSource } from "../src/db/games/counter-strike-source";

describe("counter-strike-source template", () => {
  test("installs AppID 740 with the i386 warning (32-bit srcds)", () => {
    const script = counterStrikeSource.installScript;
    assert.match(script, /STEAM_APPID="740"/);
    // The builder emits the multiarch warning when the i386 flag is set.
    assert.match(script, /dpkg --add-architecture i386/);
    assert.match(script, /lib32gcc-s1 lib32stdc\+\+6/);
  });

  test("starts srcds_run in cstrike mode with the panel's server args", () => {
    const start = counterStrikeSource.startCommand ?? "";
    assert.match(start, /\.\/srcds_run -game cstrike -console -port \{\{PORT\}\}/);
    assert.match(start, /\+maxplayers \{\{MAX_PLAYERS\}\} \+map \{\{MAP\}\} \+sv_setsteamaccount \{\{GSLT_TOKEN\}\}/);
  });

  test("writes server.cfg into cstrike/cfg and stops via quit", () => {
    assert.deepEqual(counterStrikeSource.configFiles, { "cstrike/cfg/server.cfg": "server.cfg" });
    assert.equal(counterStrikeSource.stopCommand, "quit");
  });

  test("defaults match a classic CS:S server (de_dust2, no friendly fire)", () => {
    const cfg = JSON.stringify(counterStrikeSource.defaultConfig);
    assert.match(cfg, /"hostname":"\{\{SERVER_NAME\}\}"/);
    assert.match(cfg, /"mp_timelimit":"\{\{MP_TIMELIMIT\}\}"/);
    const map = counterStrikeSource.variables.find((v) => v.env_variable === "MAP");
    assert.equal(map?.default_value, "de_dust2");
    const ff = counterStrikeSource.variables.find((v) => v.env_variable === "MP_FRIENDLYFIRE");
    assert.equal(ff?.default_value, "0");
  });
});

/**
 * Tests for the shared SteamCMD install-script builder.
 *
 * The node's `steamcmdPath` must reach the generated script: templates
 * reference {{STEAMCMD_PATH}} and fall back to the classic /opt/steamcmd when
 * the token is missing (custom flows, offline harnesses). The SDK shim copies
 * must follow the same directory, otherwise a non-default SteamCMD path
 * installs the game but never ships steamclient.so.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { steamInstallScript } from "../src/db/games/steamcmd";

const LAYOUT = { appId: "740", name: "Counter-Strike: Source" };

describe("steamInstallScript", () => {
  const script = steamInstallScript(LAYOUT);

  test("references {{STEAMCMD_PATH}} with the classic default fallback", () => {
    assert.match(script, /STEAMCMD_PATH="\{\{STEAMCMD_PATH\}\}"/);
    assert.match(script, /\[ -z "\$STEAMCMD_PATH" \] && STEAMCMD_PATH="\/opt\/steamcmd"/);
    assert.match(script, /STEAMCMD_BIN="\$STEAMCMD_PATH\/steamcmd\.sh"/);
  });

  test("SDK shim copies follow the same SteamCMD directory", () => {
    assert.match(script, /"\$STEAMCMD_PATH\/linux32\/steamclient\.so"/);
    assert.match(script, /"\$STEAMCMD_PATH\/linux64\/steamclient\.so"/);
  });

  test("no hardcoded absolute /opt/steamcmd path in the executable lines", () => {
    // Allowed: the default-fallback assignment and the error hint. Every line
    // that actually RUNS steamcmd or copies the SDK must use $STEAMCMD_PATH.
    const toolLines = script.split("\n").filter((l) => /steamcmd\.sh|steamclient\.so/.test(l));
    assert.ok(toolLines.length > 0, "script must reference the SteamCMD tool");
    for (const l of toolLines) {
      if (l.includes("STEAMCMD_BIN=")) continue; // definition, not execution
      assert.ok(!/\/opt\/steamcmd/.test(l), `executable line must use $STEAMCMD_PATH: ${l}`);
    }
    const hint = script.split("\n").filter((l) => l.includes("/opt/steamcmd") && l.includes("not installed"));
    assert.equal(hint.length, 1, "only the error hint may mention /opt/steamcmd in prose");
  });

  test("retains the retry loop, beta flags and platform forcing", () => {
    const full = steamInstallScript({ ...LAYOUT, beta: "latest_experimental", platform: "windows" });
    assert.match(full, /STEAMCMD_ATTEMPT=1/);
    assert.match(full, /\+app_update \$STEAM_APPID -beta latest_experimental/);
    assert.match(full, /\+@sSteamCmdForcePlatformType windows/);
    assert.match(full, /\+login anonymous/);
  });
});

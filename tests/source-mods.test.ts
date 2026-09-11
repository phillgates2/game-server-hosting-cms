/**
 * Tests for the Source-mod (Metamod/SourceMod) install wiring.
 *
 * The end-to-end install is exercised by verify-installers (which runs the
 * real scripts against a mock AlliedModders mirror); these pin the template
 * wiring itself: every classic Source game offers the choice, the generated
 * script targets the right game directory, and the vdf points the engine at
 * the loader.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gameTemplates } from "../src/db/games/index";
import { SOURCE_GAME_DIRS, sourceModInstallBlock, sourceModVariables } from "../src/db/games/source-mods";

const SOURCE_SLUGS = ["tf2", "counter-strike-source", "gmod", "l4d2"];

describe("modding option", () => {
  test("every classic Source game offers the MOD_PLATFORM choice, default vanilla", () => {
    for (const slug of SOURCE_SLUGS) {
      const t = gameTemplates.find((g) => g.slug === slug);
      assert.ok(t, `${slug} template exists`);
      const v = t!.variables.find((x) => x.env_variable === "MOD_PLATFORM");
      assert.ok(v, `${slug} has MOD_PLATFORM`);
      assert.equal(v!.default_value, "none", `${slug} defaults to a vanilla server`);
      assert.deepEqual(Object.keys(v!.enum_values ?? {}), ["none", "metamod", "sourcemod"]);
    }
  });

  test("the shared variable group exposes exactly one option", () => {
    assert.equal(sourceModVariables().length, 1);
  });
});

describe("install block", () => {
  test("each game directory is known and distinct", () => {
    assert.deepEqual(SOURCE_GAME_DIRS, {
      tf2: "tf",
      "counter-strike-source": "cstrike",
      gmod: "garrysmod",
      l4d2: "left4dead2",
    });
  });

  test("the block downloads from AlliedModders and extracts into the game dir", () => {
    const block = sourceModInstallBlock("cstrike");
    assert.match(block, /mms\.alliedmods\.net\/mmsdrop\/\$MMS_BRANCH\/mmsource-latest-linux/);
    assert.match(block, /sm\.alliedmods\.net\/smdrop\/\$SM_BRANCH\/sourcemod-latest-linux/);
    assert.match(block, /tar -xzf .* -C "\$INSTALL_DIR\/cstrike"/);
  });

  test("the metamod.vdf points the engine at the loader for this game dir", () => {
    const block = sourceModInstallBlock("tf");
    assert.match(block, /addons\/metamod\.vdf/);
    assert.match(block, /"\.\/tf\/addons\/metamod\/bin\/server"|"\.\.\/tf\/addons\/metamod\/bin\/server"/);
  });

  test("sourcemod is only fetched when the sourcemod platform is chosen", () => {
    const block = sourceModInstallBlock("tf");
    // The SourceMod download sits inside the MOD_PLATFORM = sourcemod branch.
    const smGate = block.split('\nif [ "$MOD_PLATFORM" = "sourcemod" ]; then')[1];
    assert.ok(smGate, "sourcemod branch exists");
    assert.match(smGate, /sm\.alliedmods\.net/);
    // The Metamod branch must NOT fetch SourceMod.
    const mmBranch = block.split('\nif [ "$MOD_PLATFORM" = "sourcemod" ]; then')[0];
    assert.ok(!/sm\.alliedmods\.net/.test(mmBranch), "metamod-only branch stays clean");
  });

  test("every Source template embeds the block for its own directory", () => {
    for (const slug of SOURCE_SLUGS) {
      const t = gameTemplates.find((g) => g.slug === slug)!;
      const dir = SOURCE_GAME_DIRS[slug];
      assert.ok(t.installScript.includes("mms.alliedmods.net"), `${slug} installs Metamod code`);
      assert.ok(t.installScript.includes(`-C "$INSTALL_DIR/${dir}"`), `${slug} extracts into ${dir}/`);
      assert.ok(t.installScript.includes(`${dir}/addons/metamod.vdf`), `${slug} writes the vdf`);
    }
  });
});

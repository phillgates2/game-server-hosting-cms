/**
 * Unit tests for the config renderer.
 *
 * This module turns a template's `defaultConfig` into the actual files a game
 * server reads at boot. It supports ten output formats and is the last step
 * before bytes hit disk, so a regression here silently produces a config the
 * engine rejects - or worse, one it accepts with the wrong values.
 *
 * verify-templates.ts checks that every declared variable reaches a file;
 * these tests check the *serialisation itself* is correct per format.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderConfigFile, resolveFormat, resolveConfigFiles } from "../src/lib/config-render";

describe("resolveFormat", () => {
  test("an explicit __gsm_format wins over the file extension", () => {
    assert.equal(resolveFormat("server.cfg", { __gsm_format: "quake3" }), "quake3");
    assert.equal(resolveFormat("anything.txt", { __gsm_format: "json" }), "json");
  });

  test("falls back to the file extension", () => {
    assert.equal(resolveFormat("settings.json", {}), "json");
    assert.equal(resolveFormat("config.ini", {}), "ini");
    assert.equal(resolveFormat("paper.yml", {}), "yaml");
  });

  test("unknown extensions fall back to key=value", () => {
    assert.equal(resolveFormat("server.properties", {}), "properties");
    assert.equal(resolveFormat("weird.xyz", {}), "properties");
  });
});

describe("renderConfigFile - properties", () => {
  test("emits key=value lines", () => {
    const out = renderConfigFile("server.properties", { "max-players": 20, pvp: true });
    assert.match(out, /^max-players=20$/m);
    assert.match(out, /^pvp=true$/m);
  });

  test("does not emit the panel's own directives", () => {
    const out = renderConfigFile("server.properties", {
      __gsm_format: "properties",
      motd: "hi",
    });
    assert.ok(!out.includes("__gsm_format"), "internal directive leaked into output");
    assert.match(out, /^motd=hi$/m);
  });
});

describe("renderConfigFile - JSON", () => {
  test("produces parseable JSON with the right values", () => {
    const out = renderConfigFile("settings.json", { Name: "Test", Port: 9876, Public: false });
    const parsed = JSON.parse(out);
    assert.equal(parsed.Name, "Test");
    assert.equal(parsed.Port, 9876);
    assert.equal(parsed.Public, false);
  });

  test("strips panel directives from the document", () => {
    const parsed = JSON.parse(renderConfigFile("a.json", { __gsm_format: "json", x: 1 }));
    assert.ok(!("__gsm_format" in parsed));
    assert.equal(parsed.x, 1);
  });

  test("keeps nested objects intact (V Rising stat modifiers)", () => {
    const parsed = JSON.parse(
      renderConfigFile("game.json", {
        GameModeType: "PvP",
        CastleStatModifiers_Global: { TickPeriod: 5.0, CastleLimit: 2 },
      })
    );
    assert.equal(parsed.CastleStatModifiers_Global.TickPeriod, 5);
    assert.equal(parsed.CastleStatModifiers_Global.CastleLimit, 2);
  });
});

describe("renderConfigFile - INI", () => {
  test("groups values under their section header", () => {
    const out = renderConfigFile("server_cfg.ini", {
      SERVER: { NAME: "My Server", MAX_CLIENTS: 18 },
      PRACTICE: { TIME: 60 },
    });
    assert.match(out, /^\[SERVER\]$/m);
    assert.match(out, /^NAME=My Server$/m);
    assert.match(out, /^MAX_CLIENTS=18$/m);
    assert.match(out, /^\[PRACTICE\]$/m);
    assert.match(out, /^TIME=60$/m);
    // The section header must come before its keys.
    assert.ok(out.indexOf("[SERVER]") < out.indexOf("NAME=My Server"));
  });
});

describe("renderConfigFile - Quake 3 family", () => {
  test("quake3 uses set cvar \"value\"", () => {
    const out = renderConfigFile("server.cfg", {
      __gsm_format: "quake3",
      sv_hostname: "ET Server",
      g_gametype: 2,
    });
    assert.match(out, /^set sv_hostname "ET Server"$/m);
    assert.match(out, /^set g_gametype "2"$/m);
  });

  test("q3seta uses seta", () => {
    const out = renderConfigFile("server.cfg", { __gsm_format: "q3seta", sv_hostname: "Q" });
    assert.match(out, /^seta sv_hostname "Q"$/m);
  });

  test("source omits the set keyword entirely", () => {
    const out = renderConfigFile("server.cfg", { __gsm_format: "source", hostname: "CS2" });
    assert.match(out, /^hostname "CS2"$/m);
    assert.ok(!/^set /m.test(out), "source format must not emit 'set'");
  });
});

describe("renderConfigFile - Arma", () => {
  test("emits key = value; with quoted strings", () => {
    const out = renderConfigFile("server.cfg", {
      __gsm_format: "arma",
      hostname: "Arma Server",
      maxPlayers: 32,
    });
    assert.match(out, /^hostname = "Arma Server";$/m);
    assert.match(out, /^maxPlayers = 32;$/m);
  });
});

describe("renderConfigFile - XML (7 Days to Die)", () => {
  test("emits property elements and a root", () => {
    const out = renderConfigFile("serverconfig.xml", { ServerName: "7DTD", ServerPort: 26900 });
    assert.match(out, /<property name="ServerName" value="7DTD"\s*\/>/);
    assert.match(out, /<property name="ServerPort" value="26900"\s*\/>/);
    assert.match(out, /<\?xml/);
  });

  test("escapes XML metacharacters so the file stays well formed", () => {
    const out = renderConfigFile("serverconfig.xml", { ServerName: 'A & B <"x">' });
    assert.ok(!/value="A & B/.test(out), "raw ampersand would break the XML parser");
    assert.match(out, /&amp;/);
  });
});

describe("renderConfigFile - YAML", () => {
  test("emits key: value", () => {
    const out = renderConfigFile("paper.yml", { "max-players": 20, motd: "hello" });
    assert.match(out, /^max-players: 20$/m);
    assert.match(out, /^motd: /m);
  });
});

describe("renderConfigFile - Palworld", () => {
  test("wraps everything in the OptionSettings tuple", () => {
    const out = renderConfigFile("PalWorldSettings.ini", {
      __gsm_format: "palworld",
      ServerName: "Pal",
      ServerPlayerMaxNum: 32,
    });
    assert.match(out, /OptionSettings=\(/);
    assert.match(out, /ServerName="Pal"/);
    assert.match(out, /ServerPlayerMaxNum=32/);
    assert.match(out, /\)\s*$/);
  });
});

describe("resolveConfigFiles", () => {
  test("without __files, every file gets the same values", () => {
    const files = resolveConfigFiles({ "server.properties": "server.properties" }, {
      motd: "hi",
    });
    assert.deepEqual(Object.keys(files), ["server.properties"]);
    assert.equal(files["server.properties"].motd, "hi");
  });

  test("with __files, each path gets only its own values", () => {
    // The keys of configFiles are the on-disk paths, exactly as the V Rising
    // template declares them, and __files is keyed by those same paths.
    const host = "save-data/Settings/ServerHostSettings.json";
    const game = "save-data/Settings/ServerGameSettings.json";
    const files = resolveConfigFiles(
      { [host]: "ServerHostSettings.json", [game]: "ServerGameSettings.json" },
      {
        __files: {
          [host]: { Name: "VR", Port: 9876 },
          [game]: { GameModeType: "PvP" },
        },
      }
    );
    assert.equal(files[host].Name, "VR");
    assert.ok(!("GameModeType" in files[host]), "host file must not receive game values");
    assert.equal(files[game].GameModeType, "PvP");
    assert.ok(!("Port" in files[game]), "game file must not receive host values");
  });

  test("a path missing from __files is skipped, not filled with everything", () => {
    const files = resolveConfigFiles(
      { "a.json": "a.json", "b.json": "b.json" },
      { __files: { "a.json": { x: 1 } } }
    );
    assert.equal(files["a.json"].x, 1);
    assert.ok(!("b.json" in files), "b.json should be left alone entirely");
  });
});

describe("value coercion", () => {
  test("booleans render as true/false, not 1/0", () => {
    const out = renderConfigFile("server.properties", { pvp: true, hardcore: false });
    assert.match(out, /^pvp=true$/m);
    assert.match(out, /^hardcore=false$/m);
  });

  test("an empty string still emits its key", () => {
    // Dropping the key entirely would make the engine fall back to a built-in
    // default rather than the intentionally blank value.
    const out = renderConfigFile("server.properties", { "resource-pack": "" });
    assert.match(out, /^resource-pack=$/m);
  });
});

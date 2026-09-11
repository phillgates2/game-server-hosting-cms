/**
 * Tests for server presets (one-click saved setups).
 *
 * Presets are a saved game + variable prefill. The security-critical
 * property is that a preset can only ever override variables the game
 * template declares — it must never smuggle arbitrary keys into the
 * server's environment at creation time.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validatePresetInput,
  validatePresetImport,
  mergePresetVariables,
  PRESET_NAME_MAX,
  PRESET_DESCRIPTION_MAX,
  PRESET_MAX_VARIABLES,
  PRESET_IMPORT_MAX,
} from "../src/lib/server-presets";

describe("validatePresetInput — happy paths", () => {
  test("accepts a minimal preset", () => {
    const res = validatePresetInput({ name: "TF2 casual", gameId: 7, variables: { MAX_PLAYERS: "24" } });
    assert.equal(res.ok, true);
    assert.equal(res.value?.name, "TF2 casual");
    assert.equal(res.value?.gameId, 7);
    assert.deepEqual(res.value?.variables, { MAX_PLAYERS: "24" });
    assert.equal(res.value?.description, null);
  });

  test("trims name and description", () => {
    const res = validatePresetInput({ name: "  Vanilla  ", description: "  desc  ", gameId: 1 });
    assert.equal(res.ok, true);
    assert.equal(res.value?.name, "Vanilla");
    assert.equal(res.value?.description, "desc");
  });

  test("empty description becomes null", () => {
    const res = validatePresetInput({ name: "x", gameId: 1, description: "   " });
    assert.equal(res.ok, true);
    assert.equal(res.value?.description, null);
  });

  test("variables may be omitted entirely", () => {
    const res = validatePresetInput({ name: "bare", gameId: 3 });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value?.variables, {});
  });

  test("numbers and booleans are stringified", () => {
    const res = validatePresetInput({ name: "x", gameId: 1, variables: { MAX_PLAYERS: 24, PUBLIC: true } });
    assert.equal(res.ok, true);
    assert.deepEqual(res.value?.variables, { MAX_PLAYERS: "24", PUBLIC: "true" });
  });
});

describe("validatePresetInput — rejection", () => {
  test("rejects non-object bodies", () => {
    for (const bad of [null, undefined, "hi", 5, [], true]) {
      assert.equal(validatePresetInput(bad).ok, false, String(bad));
    }
  });

  test("rejects missing or blank name", () => {
    assert.equal(validatePresetInput({ gameId: 1 }).ok, false);
    assert.equal(validatePresetInput({ name: "   ", gameId: 1 }).ok, false);
  });

  test("rejects over-long names", () => {
    assert.equal(validatePresetInput({ name: "a".repeat(PRESET_NAME_MAX), gameId: 1 }).ok, true);
    assert.equal(validatePresetInput({ name: "a".repeat(PRESET_NAME_MAX + 1), gameId: 1 }).ok, false);
  });

  test("truncates over-long descriptions", () => {
    const res = validatePresetInput({ name: "x", gameId: 1, description: "d".repeat(PRESET_DESCRIPTION_MAX + 50) });
    assert.equal(res.ok, true);
    assert.equal(res.value?.description?.length, PRESET_DESCRIPTION_MAX);
  });

  test("rejects invalid gameId values", () => {
    for (const bad of [0, -3, 1.5, "abc", NaN, null]) {
      assert.equal(validatePresetInput({ name: "x", gameId: bad }).ok, false, String(bad));
    }
  });

  test("rejects non-object variables containers", () => {
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: ["A=1"] }).ok, false);
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: "MAX_PLAYERS=24" }).ok, false);
  });

  test("rejects more than the variable cap", () => {
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < PRESET_MAX_VARIABLES + 1; i++) tooMany[`VAR_${i}`] = "1";
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: tooMany }).ok, false);
    delete tooMany[`VAR_${PRESET_MAX_VARIABLES}`];
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: tooMany }).ok, true);
  });

  test("rejects keys that are not UPPER_SNAKE identifiers", () => {
    for (const key of ["max_players", "MaxPlayers", "MY-VAR", "my var", "ÄÖÜ", ""]) {
      const res = validatePresetInput({ name: "x", gameId: 1, variables: { [key]: "1" } });
      assert.equal(res.ok, false, `key ${JSON.stringify(key)} should be rejected`);
    }
  });

  test("rejects non-scalar variable values", () => {
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: { A: { nested: 1 } } }).ok, false);
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: { A: null } }).ok, false);
    assert.equal(validatePresetInput({ name: "x", gameId: 1, variables: { A: ["1"] } }).ok, false);
  });

  test("rejects over-long variable values", () => {
    const res = validatePresetInput({ name: "x", gameId: 1, variables: { MOTD: "z".repeat(2001) } });
    assert.equal(res.ok, false);
  });
});

describe("mergePresetVariables — the smuggle gate", () => {
  const declared = new Set(["MAX_PLAYERS", "MAP_NAME", "SERVER_NAME", "PORT"]);

  test("overrides only declared keys", () => {
    const merged = mergePresetVariables({ MAX_PLAYERS: "16", MAP_NAME: "cp_badlands" }, { MAX_PLAYERS: "24" }, declared);
    assert.equal(merged.MAX_PLAYERS, "24");
    assert.equal(merged.MAP_NAME, "cp_badlands");
  });

  test("drops keys the template does not declare", () => {
    const merged = mergePresetVariables(
      { MAX_PLAYERS: "16" },
      { MAX_PLAYERS: "24", LD_PRELOAD: "/tmp/evil.so", PATH: "/tmp" },
      declared
    );
    assert.equal(merged.MAX_PLAYERS, "24");
    assert.equal("LD_PRELOAD" in merged, false);
    assert.equal("PATH" in merged, false);
  });

  test("keeps defaults untouched when preset is empty", () => {
    const defaults = { MAX_PLAYERS: "16", MAP_NAME: "koth_harvest" };
    assert.deepEqual(mergePresetVariables(defaults, {}, declared), defaults);
  });

  test("does not mutate the defaults object", () => {
    const defaults = { MAX_PLAYERS: "16" };
    mergePresetVariables(defaults, { MAX_PLAYERS: "24" }, declared);
    assert.equal(defaults.MAX_PLAYERS, "16");
  });

  test("SERVER_NAME and PORT presets are applied by the wizard, not the merge", () => {
    // Declared set still contains them (they are real template vars), so the
    // merge is neutral — the wizard copies them into the name/port fields.
    const merged = mergePresetVariables({}, { SERVER_NAME: "Casual #1", PORT: "27015" }, declared);
    assert.equal(merged.SERVER_NAME, "Casual #1");
    assert.equal(merged.PORT, "27015");
  });
});

describe("validatePresetImport", () => {
  const good = { name: "TF2 casual", gameId: 7, variables: { MAX_PLAYERS: "24" } };

  test("accepts a wrapped list of valid presets", () => {
    const res = validatePresetImport({ presets: [good, { name: "b", gameId: 2 }] });
    assert.equal(res.ok, true);
    assert.equal(res.value?.length, 2);
    assert.equal(res.value?.[0].variables.MAX_PLAYERS, "24");
  });

  test("rejects non-object and non-array payloads", () => {
    assert.equal(validatePresetImport(null).ok, false);
    assert.equal(validatePresetImport([good]).ok, false);
    assert.equal(validatePresetImport({ presets: "x" }).ok, false);
  });

  test("rejects an empty list", () => {
    assert.equal(validatePresetImport({ presets: [] }).ok, false);
  });

  test("rejects more than the import cap", () => {
    const over = Array.from({ length: PRESET_IMPORT_MAX + 1 }, (_, i) => ({ name: `p${i}`, gameId: 1 }));
    assert.equal(validatePresetImport({ presets: over }).ok, false);
    assert.equal(validatePresetImport({ presets: over.slice(0, PRESET_IMPORT_MAX) }).ok, true);
  });

  test("one bad item rejects the whole import with its error", () => {
    const res = validatePresetImport({ presets: [good, { name: "", gameId: 1 }] });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /name/i);
  });

  test("items keep full single-preset validation (keys, sizes)", () => {
    assert.equal(validatePresetImport({ presets: [{ name: "x", gameId: 1, variables: { bad_key: "1" } }] }).ok, false);
    assert.equal(validatePresetImport({ presets: [{ name: "a".repeat(PRESET_NAME_MAX + 1), gameId: 1 }] }).ok, false);
  });
});

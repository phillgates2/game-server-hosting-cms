/**
 * Tests for blueprint validation, expansion and naming (pure layer).
 *
 * The contract: blueprints are fleet helpers, not fork bombs — hard caps on
 * entries, per-entry copies and total servers, enforced BOTH at validation
 * and again at expansion.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateBlueprintInput,
  expandBlueprintEntries,
  blueprintServerName,
  BLUEPRINT_MAX_ENTRIES,
  BLUEPRINT_MAX_PER_ENTRY,
  BLUEPRINT_MAX_TOTAL,
} from "../src/lib/blueprints";

const entry = (presetId: number, count = 1, namePattern: string | null = null) => ({
  presetId,
  count,
  namePattern,
});

describe("validateBlueprintInput", () => {
  test("accepts a minimal valid blueprint (count defaults to 1)", () => {
    const v = validateBlueprintInput({ name: "Event night", entries: [{ presetId: 3 }] });
    assert.equal(v.ok, true);
    assert.equal(v.value?.name, "Event night");
    assert.deepEqual(v.value?.entries, [{ presetId: 3, count: 1, namePattern: null }]);
  });

  test("rejects missing/empty/oversized basics", () => {
    assert.equal(validateBlueprintInput(null).ok, false);
    assert.equal(validateBlueprintInput([]).ok, false);
    assert.equal(validateBlueprintInput({ name: "", entries: [entry(1)] }).ok, false);
    assert.equal(validateBlueprintInput({ name: "x".repeat(129), entries: [entry(1)] }).ok, false);
    assert.equal(validateBlueprintInput({ name: "ok" }).ok, false); // no entries
    assert.equal(validateBlueprintInput({ name: "ok", entries: [] }).ok, false);
  });

  test("rejects too many entries", () => {
    const entries = Array.from({ length: BLUEPRINT_MAX_ENTRIES + 1 }, (_, i) => entry(i + 1));
    const v = validateBlueprintInput({ name: "big", entries });
    assert.equal(v.ok, false);
    assert.match(v.error ?? "", /at most/);
  });

  test("rejects per-entry count above the cap", () => {
    const v = validateBlueprintInput({ name: "ok", entries: [entry(1, BLUEPRINT_MAX_PER_ENTRY + 1)] });
    assert.equal(v.ok, false);
  });

  test("rejects zero/negative/non-integer counts and bad preset ids", () => {
    assert.equal(validateBlueprintInput({ name: "ok", entries: [entry(1, 0)] }).ok, false);
    assert.equal(validateBlueprintInput({ name: "ok", entries: [entry(1, -2)] }).ok, false);
    assert.equal(validateBlueprintInput({ name: "ok", entries: [entry(1, 1.5)] }).ok, false);
    assert.equal(validateBlueprintInput({ name: "ok", entries: [entry(0)] }).ok, false);
    assert.equal(validateBlueprintInput({ name: "ok", entries: [entry(-4)] }).ok, false);
  });

  test("rejects totals above the fleet cap even with small entries", () => {
    // 5 entries x 4 copies = 20 > BLUEPRINT_MAX_TOTAL
    const entries = Array.from({ length: 5 }, (_, i) => entry(i + 1, 4));
    const v = validateBlueprintInput({ name: "swarm", entries });
    assert.equal(v.ok, false);
    assert.match(v.error ?? "", /total/);
  });

  test("trims and caps name patterns; description is optional", () => {
    const v = validateBlueprintInput({
      name: "ok",
      description: "  d  ",
      entries: [{ presetId: 1, count: 1, namePattern: "  Bot {n} " }],
    });
    assert.equal(v.ok, true);
    assert.equal(v.value?.entries[0].namePattern, "Bot {n}");
    assert.equal(v.value?.description, "d");
  });
});

describe("expandBlueprintEntries", () => {
  test("expands in entry order with 1-based global ordinals", () => {
    const expanded = expandBlueprintEntries([entry(7, 2), entry(9, 1)]);
    assert.equal(expanded.ok, true);
    if (expanded.ok) {
      assert.deepEqual(expanded.plan, [
        { presetId: 7, ordinal: 1 },
        { presetId: 7, ordinal: 2 },
        { presetId: 9, ordinal: 3 },
      ]);
    }
  });

  test("re-checks the total cap (no fork bombs past validation)", () => {
    const entries = [{ presetId: 1, count: BLUEPRINT_MAX_TOTAL + 1, namePattern: null }];
    const expanded = expandBlueprintEntries(entries);
    assert.equal(expanded.ok, false);
  });
});

describe("blueprintServerName", () => {
  test("replaces {n} with the ordinal", () => {
    assert.equal(blueprintServerName("Event Bot {n}", "TF2", 3), "Event Bot 3");
    assert.equal(blueprintServerName("{n}/{n}", "TF2", 7), "7/7");
  });

  test("falls back to PresetName #n when no pattern", () => {
    assert.equal(blueprintServerName(null, "TF2 casual", 2), "TF2 casual #2");
    assert.equal(blueprintServerName("   ", "TF2 casual", 1), "TF2 casual #1");
    assert.equal(blueprintServerName(null, "", 5), "Server #5");
  });

  test("caps absurd lengths", () => {
    const name = blueprintServerName("x".repeat(500), "TF2", 1);
    assert.ok(name.length <= 100);
  });
});

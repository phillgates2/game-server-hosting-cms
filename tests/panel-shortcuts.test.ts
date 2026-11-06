/**
 * The keyboard cheat sheet.
 *
 * The panel's single-key shortcuts were invisible, and the list shown to the
 * operator is now derived from the same navigation table the keyboard handler
 * uses. These tests pin the derivation: every shortcut offered is documented,
 * blanks are ignored, and no two panels can appear to own the same key.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL_SHORTCUTS,
  PALETTE_SHORTCUTS,
  buildPanelShortcuts,
  buildShortcutGroups,
} from "../src/lib/panel-shortcuts";

const panels = [
  { label: "Servers", shortcut: "S" },
  { label: "File Manager", shortcut: "F" },
  { label: "Servers", shortcut: "S" }, // duplicated entry, same key
  { label: "Settings" },
  { label: "Nodes", shortcut: "  n  " },
  { label: "Roles", shortcut: null },
];

describe("panel shortcuts", () => {
  test("every advertised shortcut appears once, in nav order", () => {
    const group = buildPanelShortcuts(panels);
    assert.deepEqual(group.entries, [
      { keys: ["S"], label: "Servers" },
      { keys: ["F"], label: "File Manager" },
      { keys: ["N"], label: "Nodes" },
    ]);
  });

  test("panels without a shortcut, or with a blank one, are omitted", () => {
    const group = buildPanelShortcuts([
      { label: "Settings" },
      { label: "Roles", shortcut: "" },
      { label: "Users", shortcut: "   " },
    ]);
    assert.deepEqual(group.entries, []);
  });

  test("keys are normalised and two panels cannot claim the same key", () => {
    const group = buildPanelShortcuts([
      { label: "Servers", shortcut: "s" },
      { label: "Shop", shortcut: "S" },
    ]);
    assert.equal(group.entries.length, 1);
    assert.equal(group.entries[0].keys[0], "S");
  });

  test("a garbage shortcut is not printed as a key", () => {
    const group = buildPanelShortcuts([{ label: "Weird", shortcut: "notakey" }]);
    assert.deepEqual(group.entries, []);
  });
});

describe("the full cheat sheet", () => {
  test("is global keys, then panels, then palette keys", () => {
    const groups = buildShortcutGroups(panels);
    assert.deepEqual(
      groups.map((group) => group.title),
      [GLOBAL_SHORTCUTS.title, "Jump straight to a panel", PALETTE_SHORTCUTS.title]
    );
  });

  test("never renders an empty section", () => {
    const groups = buildShortcutGroups([{ label: "Settings" }]);
    assert.deepEqual(
      groups.map((group) => group.title),
      [GLOBAL_SHORTCUTS.title, PALETTE_SHORTCUTS.title]
    );
    for (const group of groups) assert.ok(group.entries.length > 0);
  });

  test("documents the ways out of every dialog", () => {
    const groups = buildShortcutGroups(panels);
    const keys = groups.flatMap((group) => group.entries.flatMap((entry) => entry.keys));
    assert.ok(keys.includes("Esc"), "Escape is how every dialog closes");
    assert.ok(keys.includes("?"), "the list itself is reachable from the keyboard");
    assert.ok(
      groups.some((group) => group.entries.some((entry) => entry.keys.includes("Enter"))),
      "the palette can be driven without a mouse"
    );
  });
});

/**
 * Tests for per-server operator notes.
 *
 * Notes flow through the PATCH allowlist, so the interesting cases are the
 * normaliser (trim/cap/clear semantics) and the guarantee that opening the
 * allowlist for "notes" did not reopen previously locked-down fields.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeServerNotes,
  SERVER_NOTES_MAX_LENGTH,
  pickServerPatch,
  SERVER_PATCH_FIELDS,
} from "../src/lib/server-lifecycle";

describe("normalizeServerNotes", () => {
  test("null clears the note", () => {
    assert.deepEqual(normalizeServerNotes(null), { ok: true, value: null });
  });

  test("empty and whitespace-only strings clear the note", () => {
    assert.deepEqual(normalizeServerNotes(""), { ok: true, value: null });
    assert.deepEqual(normalizeServerNotes("   \n\t "), { ok: true, value: null });
  });

  test("trims surrounding whitespace", () => {
    const res = normalizeServerNotes("  map rotation tuesdays  ");
    assert.equal(res.ok, true);
    assert.equal(res.value, "map rotation tuesdays");
  });

  test("accepts up to the cap, rejects one over", () => {
    assert.equal(normalizeServerNotes("a".repeat(SERVER_NOTES_MAX_LENGTH)).ok, true);
    const over = normalizeServerNotes("a".repeat(SERVER_NOTES_MAX_LENGTH + 1));
    assert.equal(over.ok, false);
    assert.match(over.error ?? "", /2000/);
  });

  test("a trimmed note that fits after trimming is accepted", () => {
    const padded = " " + "b".repeat(SERVER_NOTES_MAX_LENGTH) + " ";
    const res = normalizeServerNotes(padded);
    assert.equal(res.ok, true);
    assert.equal(res.value?.length, SERVER_NOTES_MAX_LENGTH);
  });

  test("rejects non-string values", () => {
    for (const bad of [42, true, [], { text: "hi" }, undefined]) {
      assert.equal(normalizeServerNotes(bad).ok, false, String(bad));
    }
  });
});

describe("PATCH allowlist regression", () => {
  test("notes is client-writable", () => {
    assert.ok(SERVER_PATCH_FIELDS.includes("notes"));
    const { updates, rejected } = pickServerPatch({ notes: "hello" });
    assert.equal(updates.notes, "hello");
    assert.deepEqual(rejected, []);
  });

  test("panel-owned fields stay rejected alongside notes", () => {
    const { updates, rejected } = pickServerPatch({
      notes: "ok",
      installPath: "/evil",
      userId: 99,
      nodeId: 7,
      statusToken: "steal",
    });
    assert.equal(updates.notes, "ok");
    assert.deepEqual(rejected.sort(), ["installPath", "nodeId", "statusToken", "userId"]);
  });
});

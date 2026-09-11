/**
 * Tests for field-level server change diffs.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffServerPatch, renderChangeValue, sameChangeValue } from "../src/lib/server-changes";

describe("renderChangeValue", () => {
  test("null/undefined render as a dash", () => {
    assert.equal(renderChangeValue(null), "—");
    assert.equal(renderChangeValue(undefined), "—");
  });

  test("scalars stringify, objects JSON-ify", () => {
    assert.equal(renderChangeValue(24), "24");
    assert.equal(renderChangeValue("hi"), "hi");
    assert.equal(renderChangeValue(true), "true");
    assert.equal(renderChangeValue({ a: 1 }), '{"a":1}');
    assert.equal(renderChangeValue(["x"]), '["x"]');
  });
});

describe("sameChangeValue", () => {
  test("compares rendered forms", () => {
    assert.equal(sameChangeValue(24, "24"), true);
    assert.equal(sameChangeValue(null, undefined), true);
    assert.equal(sameChangeValue({ a: 1 }, { a: 1 }), true);
    assert.equal(sameChangeValue({ a: 1 }, { a: 2 }), false);
  });
});

describe("diffServerPatch", () => {
  const before = { name: "Old", port: 27015, notes: null, tags: ["a"], autoRestart: true };

  test("only changed fields produce rows", () => {
    const diff = diffServerPatch(before, { name: "New", port: 27015 });
    assert.deepEqual(diff, [{ field: "name", from: "Old", to: "New" }]);
  });

  test("undefined updates are skipped", () => {
    assert.deepEqual(diffServerPatch(before, { name: undefined }), []);
  });

  test("null ↔ value transitions render with dashes", () => {
    const diff = diffServerPatch(before, { notes: "hello" });
    assert.deepEqual(diff, [{ field: "notes", from: "—", to: "hello" }]);
  });

  test("jsonb fields diff by structure", () => {
    const diff = diffServerPatch(before, { tags: ["a", "b"] });
    assert.equal(diff.length, 1);
    assert.equal(diff[0].to, '["a","b"]');
    assert.deepEqual(diffServerPatch(before, { tags: ["a"] }), []);
  });

  test("values are capped at the limit", () => {
    const diff = diffServerPatch({ notes: null }, { notes: "x".repeat(5000) });
    assert.equal(diff[0].to.length, 2000);
  });

  test("identical patch yields nothing", () => {
    assert.deepEqual(diffServerPatch(before, { ...before }), []);
  });
});

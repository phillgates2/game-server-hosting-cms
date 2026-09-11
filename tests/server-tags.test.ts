/**
 * Tests for server tags — grouping labels that flow through the PATCH
 * allowlist into a JSONB column. Validation must reject anything that is
 * not a small list of safe, lower-cased identifiers.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeServerTags,
  tagsFromInput,
  sortTags,
  SERVER_TAGS_MAX_COUNT,
  SERVER_TAG_MAX_LENGTH,
} from "../src/lib/server-tags";

describe("normalizeServerTags — happy paths", () => {
  test("accepts a simple list", () => {
    const res = normalizeServerTags(["tf2", "eu"]);
    assert.deepEqual(res.value, ["tf2", "eu"]);
  });

  test("null and [] clear the tags", () => {
    assert.deepEqual(normalizeServerTags(null).value, []);
    assert.deepEqual(normalizeServerTags([]).value, []);
  });

  test("trims, lower-cases and dedupes", () => {
    const res = normalizeServerTags(["  EU ", "eu", "TF2"]);
    assert.deepEqual(res.value, ["eu", "tf2"]);
  });

  test("blank entries are dropped silently", () => {
    const res = normalizeServerTags(["a", "", "   ", "b"]);
    assert.deepEqual(res.value, ["a", "b"]);
  });

  test("accepts - and _ inside tags", () => {
    const res = normalizeServerTags(["friday-night", "my_tag", "a1"]);
    assert.deepEqual(res.value, ["friday-night", "my_tag", "a1"]);
  });
});

describe("normalizeServerTags — rejection", () => {
  test("rejects non-arrays", () => {
    for (const bad of ["tf2", { a: 1 }, 5, true]) {
      assert.equal(normalizeServerTags(bad).ok, false, String(bad));
    }
  });

  test("rejects non-string members", () => {
    assert.equal(normalizeServerTags(["ok", 42]).ok, false);
    assert.equal(normalizeServerTags([null]).ok, false);
    assert.equal(normalizeServerTags([{ t: "x" }]).ok, false);
  });

  test("rejects more than the tag cap", () => {
    const ok = Array.from({ length: SERVER_TAGS_MAX_COUNT }, (_, i) => `tag${i}`);
    assert.equal(normalizeServerTags(ok).ok, true);
    assert.equal(normalizeServerTags([...ok, "one-too-many"]).ok, false);
  });

  test("rejects grossly oversized arrays up front", () => {
    const huge = Array.from({ length: SERVER_TAGS_MAX_COUNT * 2 + 1 }, (_, i) => `t${i}`);
    assert.equal(normalizeServerTags(huge).ok, false);
  });

  test("rejects shell/path-hostile or malformed tags", () => {
    for (const bad of ["../etc", "a b", "semi;colon", "quote\"x", "-leading", "_leading", "UPPER CASE", "ünïcode", "a".repeat(SERVER_TAG_MAX_LENGTH + 1)]) {
      const res = normalizeServerTags([bad]);
      assert.equal(res.ok, false, `tag ${JSON.stringify(bad)} should be rejected`);
    }
  });

  test("longest allowed tag passes", () => {
    assert.equal(normalizeServerTags(["a".repeat(SERVER_TAG_MAX_LENGTH)]).ok, true);
  });
});

describe("tagsFromInput", () => {
  test("splits a comma-separated editor string", () => {
    const res = tagsFromInput("tf2, EU ,tournament");
    assert.deepEqual(res.value, ["tf2", "eu", "tournament"]);
  });

  test("empty input clears", () => {
    assert.deepEqual(tagsFromInput("").value, []);
    assert.deepEqual(tagsFromInput(" , , ").value, []);
  });

  test("propagates validation errors", () => {
    assert.equal(tagsFromInput("ok, bad tag").ok, false);
  });
});

describe("sortTags", () => {
  test("sorts a copy, tolerating null/undefined", () => {
    assert.deepEqual(sortTags(["b", "a"]), ["a", "b"]);
    assert.deepEqual(sortTags(null), []);
    assert.deepEqual(sortTags(undefined), []);
    const src = ["b", "a"];
    sortTags(src);
    assert.deepEqual(src, ["b", "a"], "input must not be mutated");
  });
});

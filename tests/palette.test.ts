/**
 * Tests for command palette selection math.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clampPaletteIndex, stepPaletteIndex } from "../src/lib/palette";

describe("clampPaletteIndex", () => {
  test("keeps valid indexes, clamps the rest", () => {
    assert.equal(clampPaletteIndex(2, 5), 2);
    assert.equal(clampPaletteIndex(9, 5), 4);
    assert.equal(clampPaletteIndex(-3, 5), 0);
    assert.equal(clampPaletteIndex(2.9, 5), 2);
  });

  test("empty lists always yield 0", () => {
    assert.equal(clampPaletteIndex(4, 0), 0);
    assert.equal(clampPaletteIndex(4, -2), 0);
  });

  test("garbage indexes fail safe", () => {
    assert.equal(clampPaletteIndex(NaN, 5), 0);
    assert.equal(clampPaletteIndex(Infinity, 5), 0);
  });
});

describe("stepPaletteIndex", () => {
  test("stops at both edges", () => {
    assert.equal(stepPaletteIndex(0, 5, -1), 0);
    assert.equal(stepPaletteIndex(4, 5, 1), 4);
    assert.equal(stepPaletteIndex(1, 5, 1), 2);
    assert.equal(stepPaletteIndex(3, 5, -1), 2);
  });

  test("clamps a stale index before stepping", () => {
    assert.equal(stepPaletteIndex(99, 5, 1), 4);
    assert.equal(stepPaletteIndex(99, 5, -1), 3);
  });

  test("empty list is a no-op", () => {
    assert.equal(stepPaletteIndex(3, 0, 1), 0);
  });
});

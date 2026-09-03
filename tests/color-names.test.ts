/**
 * Tests for the color name generator.
 *
 * Names must be deterministic (same hex, same name — always), describe the
 * hue truthfully (a blue is never called "Scarlet"), and the random generator
 * has to produce a valid hex and a non-empty name every time.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseHex,
  rgbToHsv,
  hsvToRgb,
  colorNameFor,
  nameForHsv,
  describeColor,
  randomColorName,
  toHex,
} from "../src/lib/color-names";

describe("parseHex", () => {
  test("accepts with and without the hash, rejects junk", () => {
    assert.ok(parseHex("#3b82f6"));
    assert.ok(parseHex("3b82f6"));
    assert.equal(parseHex("#FFF"), null, "three-digit shorthand is not accepted");
    assert.equal(parseHex("blue"), null);
    assert.equal(parseHex(""), null);
    assert.equal(parseHex("#gggggg"), null);
  });

  test("the round trip loses nothing", () => {
    const hsv = parseHex("#3b82f6");
    assert.ok(hsv);
    const { r, g, b } = hsvToRgb(hsv!.h, hsv!.s, hsv!.v);
    assert.equal(toHex(r, g, b), "#3b82f6");
  });
});

describe("nameForHsv / colorNameFor", () => {
  test("names are deterministic: same color, same name, always", () => {
    assert.equal(colorNameFor("#3b82f6"), colorNameFor("#3b82f6"));
    assert.equal(colorNameFor("#ef4444"), colorNameFor("#ef4444"));
    assert.equal(colorNameFor("#ff9800"), colorNameFor("#ff9800"));
  });

  test("a blue is never called a red", () => {
    const blue = colorNameFor("#3b82f6");
    const red = colorNameFor("#ef4444");
    assert.ok(blue && !/Scarlet|Rose|Amber|Ember/i.test(blue), `blue got: ${blue}`);
    assert.ok(red && !/Azurite|Cobalt|Sapphire|Teal/i.test(red), `red got: ${red}`);
    assert.match(String(blue), /Azurite|Cobalt/);
    assert.match(String(red), /Scarlet|Ember/);
  });

  test("modifiers follow saturation and lightness", () => {
    assert.equal(colorNameFor("#3b82f6"), "Vivid Azurite", "high saturation");
    assert.equal(colorNameFor("#ef4444"), "Bright Scarlet", "high lightness");
    assert.equal(colorNameFor("#123456"), "Deep Azurite", "darkness beats saturation");
  });

  test("grays get material names, not hue names", () => {
    const gray = colorNameFor("#808080");
    assert.ok(gray && /Slate|Ash|Silver|Frost|Ivory|Pearl|Graphite|Onyx/.test(gray), `gray got: ${gray}`);
  });

  test("invalid input yields null", () => {
    assert.equal(colorNameFor("not-a-color"), null);
  });
});

describe("describeColor", () => {
  test("returns name, normalized hex and css", () => {
    const c = describeColor("#3B82F6");
    assert.ok(c);
    assert.equal(c!.hex, "#3b82f6");
    assert.match(c!.css, /^rgb\(59, 130, 246\)$|^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
    assert.equal(c!.name, "Vivid Azurite");
  });

  test("unknown hex returns null", () => {
    assert.equal(describeColor("oops"), null);
  });
});

describe("randomColorName", () => {
  // A tiny deterministic LCG so the test is reproducible.
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  test("always returns a valid hex and a name", () => {
    const rng = lcg(42);
    for (let i = 0; i < 25; i++) {
      const c = randomColorName(rng);
      assert.match(c.hex, /^#[0-9a-f]{6}$/);
      assert.ok(c.name.length > 0);
      assert.match(c.css, /^rgb\(/);
    }
  });

  test("the generated color really has the generated name", () => {
    const rng = lcg(7);
    const c = randomColorName(rng);
    assert.equal(colorNameFor(c.hex), c.name);
  });

  test("is injectable and varied", () => {
    const a = randomColorName(lcg(1));
    const b = randomColorName(lcg(2));
    assert.notEqual(a.hex, b.hex, "two seeds should not collide in practice");
  });
});

describe("rgbToHsv", () => {
  test("primary colors land in the expected hue bands", () => {
    assert.ok(rgbToHsv(1, 0, 0).h < 15 || rgbToHsv(1, 0, 0).h > 345, "red");
    assert.ok(Math.abs(rgbToHsv(0, 0, 1).h - 240) < 60, "blue");
    const green = rgbToHsv(0, 1, 0);
    assert.ok(green.h > 60 && green.h < 180, "green");
  });
});

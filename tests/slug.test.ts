/**
 * Slug generation.
 *
 * Six call sites each had their own regex pair and they disagreed. The
 * custom-game variant replaced characters one at a time and stripped only a
 * single leading/trailing dash, so ordinary names came out malformed. Every
 * site also validated the caller's RAW input and then normalized it, letting
 * "-" and "   " through the required-field check and into the database as "".
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { slugify, toValidSlug, MAX_SLUG_LENGTH } from "../src/lib/slug";

describe("slugify", () => {
  test("lowercases and joins words with a single dash", () => {
    assert.equal(slugify("My Game"), "my-game");
    assert.equal(slugify("CS:GO 2"), "cs-go-2");
  });

  test("collapses runs of punctuation instead of one dash each", () => {
    // The old custom-game regex produced "my-game-" and "a--b".
    assert.equal(slugify("My Game!!"), "my-game");
    assert.equal(slugify("a  b"), "a-b");
    assert.equal(slugify("Don't Starve  Together"), "don-t-starve-together");
  });

  test("strips every leading and trailing dash, not just one", () => {
    // The old `/^-|-$/` stripped a single dash from each end.
    assert.equal(slugify("  spaced  "), "spaced");
    assert.equal(slugify("---lead---"), "lead");
    assert.equal(slugify("!!!Bang!!!"), "bang");
  });

  test("returns empty for input with nothing slug-worthy", () => {
    for (const input of ["", "   ", "-", "---", "!!!", "🎮", "///"]) {
      assert.equal(slugify(input), "", `expected "" for ${JSON.stringify(input)}`);
    }
  });

  test("handles null and undefined", () => {
    assert.equal(slugify(null), "");
    assert.equal(slugify(undefined), "");
  });

  test("caps length and never ends on a dash after the cut", () => {
    // Slicing mid-run would otherwise leave a trailing dash.
    const sliced = slugify("a".repeat(63) + " bbb");
    assert.ok(sliced.length <= MAX_SLUG_LENGTH);
    assert.ok(!sliced.endsWith("-"), `trailing dash in ${sliced}`);
    assert.equal(slugify("x".repeat(80)).length, MAX_SLUG_LENGTH);
  });

  test("respects a caller-supplied limit", () => {
    // Forum categories allow 128 and CMS pages 256; capping everything at the
    // game-definition width would silently truncate them.
    assert.equal(slugify("y".repeat(200), 128).length, 128);
    assert.equal(slugify("y".repeat(200), 256).length, 200);
  });

  test("is idempotent", () => {
    for (const input of ["My Game!!", "  spaced  ", "CS:GO 2"]) {
      assert.equal(slugify(slugify(input)), slugify(input));
    }
  });
});

describe("toValidSlug", () => {
  test("returns the slug when usable", () => {
    assert.equal(toValidSlug("My Game"), "my-game");
  });

  test("returns null rather than an empty slug", () => {
    // An empty slug is unreachable by URL and permanently occupies the unique
    // index, so the very next empty-slug insert fails with a raw 23505.
    for (const input of ["-", "   ", "---", "🎮", "", null, undefined]) {
      assert.equal(
        toValidSlug(input),
        null,
        `expected null for ${JSON.stringify(input)}`
      );
    }
  });

  test("a slug that survives validation is always fetchable back", () => {
    // The invariant the API boundary depends on: whatever we store can be
    // round-tripped through /api/<thing>/[slug] unchanged.
    for (const input of ["My Game!!", "  spaced  ", "CS:GO 2", "---lead---"]) {
      const slug = toValidSlug(input);
      assert.ok(slug, `${input} should produce a slug`);
      assert.equal(encodeURIComponent(slug), slug, `${slug} is not URL-safe`);
      assert.equal(slugify(slug), slug, `${slug} is not stable`);
    }
  });
});

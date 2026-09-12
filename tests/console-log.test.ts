/**
 * Tests for live-console plumbing (pure layer).
 *
 * The contract: tail sizes are clamped, tailLines never serves a partial
 * first line unless it has the whole file, and rotation is strictly
 * size-based.
 *
 *   npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampTailLines,
  tailLines,
  shouldRotateLog,
  consoleLogPath,
  CONSOLE_LOG_NAME,
  CONSOLE_MAX_BYTES,
  CONSOLE_DEFAULT_TAIL_LINES,
  CONSOLE_MAX_TAIL_LINES,
} from "../src/lib/console-log";

describe("clampTailLines", () => {
  test("defaults for junk, floors at the minimum, caps at the maximum", () => {
    assert.equal(clampTailLines(undefined), CONSOLE_DEFAULT_TAIL_LINES);
    assert.equal(clampTailLines("abc"), CONSOLE_DEFAULT_TAIL_LINES);
    assert.equal(clampTailLines(4), CONSOLE_DEFAULT_TAIL_LINES); // below the 10-line floor
    assert.equal(clampTailLines(50), 50);
    assert.equal(clampTailLines(10_000), CONSOLE_MAX_TAIL_LINES);
    assert.equal(clampTailLines(12.5), CONSOLE_DEFAULT_TAIL_LINES); // floats rejected
  });
});

describe("tailLines", () => {
  test("returns all lines when content is short (whole file)", () => {
    assert.deepEqual(tailLines("a\nb\nc\n", 200, true), ["a", "b", "c"]);
    assert.deepEqual(tailLines("", 200, true), []);
    assert.deepEqual(tailLines("single", 200, true), ["single"]);
  });

  test("takes the last N lines of a long file", () => {
    const content = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n") + "\n";
    assert.deepEqual(tailLines(content, 3, true), ["line7", "line8", "line9"]);
  });

  test("drops the possibly-partial first line when reading a window", () => {
    // Simulates a 512KB window that starts mid-line.
    const content = "partial-start\nline2\nline3\n";
    assert.deepEqual(tailLines(content, 200, false), ["line2", "line3"]);
  });

  test("keeps everything when the window is short but whole-file is false only drops one", () => {
    assert.deepEqual(tailLines("a\nb\n", 200, false), ["b"]);
  });

  test("content without trailing newline still yields the last line", () => {
    assert.deepEqual(tailLines("a\nb", 200, true), ["a", "b"]);
  });
});

describe("shouldRotateLog", () => {
  test("strictly size-based", () => {
    assert.equal(shouldRotateLog(CONSOLE_MAX_BYTES), false);
    assert.equal(shouldRotateLog(CONSOLE_MAX_BYTES + 1), true);
    assert.equal(shouldRotateLog(0), false);
  });
});

describe("consoleLogPath", () => {
  test("lives inside the install directory under a stable name", () => {
    const p = consoleLogPath("/srv/games/tf2-1");
    assert.ok(p.endsWith(`/${CONSOLE_LOG_NAME}`));
    assert.ok(p.startsWith("/srv/games/tf2-1"));
  });
});

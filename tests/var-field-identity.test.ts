/**
 * Regression test for the "cursor jumps out of the field after one letter" bug.
 *
 * VarField used to be declared *inside* ServersPanel. React compares component
 * types by reference, so a function re-created on every render is a different
 * type each time: React unmounts the old subtree and mounts a new one. For a
 * text input that means a brand-new DOM node, so focus and caret position are
 * destroyed after every keystroke.
 *
 * There is no DOM/renderer dependency in this repo, so rather than mount the
 * component this test asserts the structural property that caused the bug:
 * the component must be defined at module scope, not re-created per render.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PANEL = "src/components/panels/ServersPanel.tsx";

describe("VarField component identity", () => {
  const src = readFileSync(PANEL, "utf8");

  test("VarField is declared at module scope", () => {
    // Module scope means column 0. An indented declaration is nested inside
    // another component and will be re-created on every render.
    assert.match(
      src,
      /^function VarField\(/m,
      "VarField must be declared at module scope so its type identity is stable"
    );
  });

  test("VarField is not declared inside another component", () => {
    assert.ok(
      !/^[ \t]+function VarField\(/m.test(src),
      "found an indented `function VarField(` - nesting it remounts the input on every keystroke"
    );
  });

  test("VarField receives its value and change handler as props", () => {
    // A hoisted component cannot close over the panel's state, so the wiring
    // has to come through props. If these vanish, someone has re-nested it.
    assert.match(src, /onChange=\{setVarValue\}/, "expected the stable handler to be passed down");
    assert.match(src, /value=\{varValues\[v\.env_variable\]/, "expected the value to be passed down");
  });

  test("the change handler is memoised so props stay referentially stable", () => {
    assert.match(
      src,
      /const setVarValue = useCallback\(/,
      "setVarValue must be wrapped in useCallback, or VarField's props change every render"
    );
  });
});

describe("no component is defined inside another component", () => {
  // The same mistake anywhere else produces the same focus-loss symptom, so
  // guard the whole component tree rather than just the one file.
  function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, acc);
      else if (entry.endsWith(".tsx")) acc.push(full);
    }
    return acc;
  }

  const files = walk("src");

  test("no indented `function ComponentName(` returning JSX", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // Indented, capitalised function declaration = nested component.
        if (/^[ \t]+function [A-Z][A-Za-z0-9_]*\s*\(/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 70)}`);
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `nested component definitions remount their subtree on every render:\n${offenders.join("\n")}`
    );
  });
});

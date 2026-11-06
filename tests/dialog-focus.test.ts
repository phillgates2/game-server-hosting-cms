/**
 * Modal focus behaviour, exercised in a real DOM (jsdom).
 *
 * The panel's dialogs (quick jump, mobile navigation, the shortcut sheet) are
 * only usable from a keyboard if focus goes in, stays in, and comes back out.
 * A static render cannot show any of that, so this test mounts the actual hook
 * against jsdom and drives it with real key events:
 *
 *   - focus moves to the first control when the dialog opens
 *   - Tab at the end wraps to the start, Shift+Tab at the start wraps to the end
 *   - Escape closes, even from inside a text field
 *   - the page behind cannot scroll while it is open
 *   - closing returns focus to whatever opened it
 *
 *   npm test
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom: JSDOM;

before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  // Node 22 exposes some of these as getter-only globals, so define them.
  const set = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  set("window", dom.window);
  set("document", dom.window.document);
  set("navigator", dom.window.navigator);
  set("HTMLElement", dom.window.HTMLElement);
  set("KeyboardEvent", dom.window.KeyboardEvent);
  set("Event", dom.window.Event);
  set("IS_REACT_ACT_ENVIRONMENT", true);
});

after(() => {
  dom.window.close();
});

describe("dialog focus", () => {
  test("focus enters, is trapped, and comes back out", async () => {
    const { createElement } = await import("react");
    const { useRef } = await import("react");

    // Re-mount with a real ref so the container identity survives renders.
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { useDialogFocus } = await import("../src/components/useDialogFocus");

    const calls: string[] = [];
    const opener = document.createElement("button");
    opener.id = "opener";
    document.body.appendChild(opener);
    opener.focus();
    assert.equal(document.activeElement, opener);

    function Harness({ open }: { open: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null);
      const onKeyDown = useDialogFocus(open, ref, () => calls.push("close"));
      return createElement(
        "div",
        { ref, tabIndex: -1, onKeyDown },
        createElement("button", { id: "first" }, "First"),
        createElement("input", { id: "middle" }),
        createElement("button", { id: "last" }, "Last")
      );
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(createElement(Harness, { open: false })));

    await act(async () => root.render(createElement(Harness, { open: true })));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(document.activeElement?.id, "first", "focus moves to the first control");
    assert.equal(document.body.style.overflow, "hidden", "the page behind cannot scroll");

    const first = document.getElementById("first")!;
    const last = document.getElementById("last")!;
    const middle = document.getElementById("middle")!;

    // Tab off the last control wraps to the first.
    last.focus();
    await act(async () => {
      last.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
      );
    });
    assert.equal(document.activeElement?.id, "first", "Tab wraps from last to first");

    // Shift+Tab off the first wraps to the last.
    await act(async () => {
      first.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    assert.equal(document.activeElement?.id, "last", "Shift+Tab wraps from first to last");

    // A control in the middle is left alone — wrapping must not fight the browser.
    middle.focus();
    await act(async () => {
      middle.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
      );
    });
    assert.equal(document.activeElement?.id, "middle", "ordinary Tab is not intercepted");

    // Escape closes, from inside a text field.
    const escape = new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      middle.dispatchEvent(escape);
    });
    assert.deepEqual(calls, ["close"], "Escape closes the dialog");
    assert.equal(escape.defaultPrevented, true);

    await act(async () => root.render(createElement(Harness, { open: false })));
    assert.equal(document.activeElement, opener, "focus returns to the opener");
    assert.equal(document.body.style.overflow, "", "scrolling is restored");

    await act(async () => root.unmount());
    host.remove();
    opener.remove();
  });
});

/**
 * Tests for the embed snippets and server-event labels.
 *
 * The snippets get pasted into third-party sites, so their shape (and the
 * XSS escape inside the widget) is pinned here — including the origin
 * validation that keeps a hostile value out of the attribute and the script
 * block.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildEmbedIframe, buildEmbedWidget } from "../src/lib/status-share";
import { eventLabel, SERVER_EVENT_RETENTION_DAYS } from "../src/lib/server-events";

describe("buildEmbedIframe", () => {
  test("points at the panel's /status page", () => {
    const html = buildEmbedIframe("https://panel.example.com");
    assert.ok(html, "a valid origin must produce a snippet");
    assert.match(html, /src="https:\/\/panel\.example\.com\/status"/);
    assert.match(html, /<iframe/);
    assert.match(html, /title="Server Status"/);
  });

  test("tolerates trailing slashes on the origin", () => {
    const html = buildEmbedIframe("https://panel.example.com///");
    assert.ok(html);
    assert.match(html, /src="https:\/\/panel\.example\.com\/status"/);
    assert.ok(!html.includes(".com///"));
  });

  test("honours a custom height", () => {
    const html = buildEmbedIframe("https://x.test", 900);
    assert.ok(html);
    assert.match(html, /height:900px/);
  });

  test("clamps an absurd height instead of emitting it", () => {
    const html = buildEmbedIframe("https://x.test", 9_999_999);
    assert.ok(html);
    assert.match(html, /height:4000px/);
    assert.ok(!html.includes("999999"));
  });

  test("normalises a hostile origin down to scheme + host", () => {
    // URL.origin keeps only scheme://host[:port], so a path, query or embedded
    // script is discarded rather than escaped into the snippet. Both the
    // attribute breakout and the script breakout must not survive.
    const cases: Array<[string, string]> = [
      ['https://panel.example.com/"><script>alert(1)</script>', "https://panel.example.com/status"],
      ["https://panel.example.com/path?q=1", "https://panel.example.com/status"],
    ];
    for (const [hostile, expected] of cases) {
      const html = buildEmbedIframe(hostile);
      assert.ok(html, JSON.stringify(hostile));
      assert.ok(html.includes(`src="${expected}"`), `${JSON.stringify(hostile)} produced ${html}`);
      assert.ok(!html.includes("<script>alert"), "injected script must not survive");
      assert.ok(!html.includes('"><script>'), "attribute breakout must not survive");
      assert.ok(!html.includes("?q=1"), "query must not survive");
    }
  });

  test("refuses origins that cannot be a plain http(s) origin", () => {
    // `"` breaks out of src="...", `</script>` breaks out of the widget's
    // script block, and userinfo re-targets the request — so anything that is
    // not a bare scheme://host is rejected rather than escaped.
    const bad = [
      "",
      "https://",
      "not-a-url",
      "javascript:alert(1)",
      "ftp://x.test",
      "//evil.com",
      "https://user@evil.com",
      "https://user:pass@evil.com",
      'https://x.test" onload="alert(1)',
      "ftp://user@evil.com/x",
      null,
      undefined,
      42,
    ] as unknown as string[];
    for (const origin of bad) {
      assert.equal(buildEmbedIframe(origin), null, JSON.stringify(origin));
      assert.equal(buildEmbedWidget(origin), null, JSON.stringify(origin));
    }
  });
});

describe("buildEmbedWidget", () => {
  test("fetches the public JSON endpoint", () => {
    const html = buildEmbedWidget("https://panel.example.com");
    assert.ok(html);
    assert.match(html, /fetch\("https:\/\/panel\.example\.com\/api\/public\/status"\)/);
  });

  test("escapes server names before injecting them into HTML", () => {
    const html = buildEmbedWidget("https://x.test");
    assert.ok(html);
    assert.match(html, /replace\(\/\[<>&\]\/g, ""\)/);
  });
});

describe("eventLabel", () => {
  test("labels the known kinds", () => {
    assert.equal(eventLabel("crashed"), "💥 Crashed");
    assert.equal(eventLabel("watchdog-stop"), "⛔ Stopped by resource watchdog");
    assert.equal(eventLabel("auto-restarted"), "🔁 Auto-restarted");
  });

  test("unknown kinds pass through", () => {
    assert.equal(eventLabel("mystery"), "mystery");
  });

  test("history retention is a sane fortnight", () => {
    assert.equal(SERVER_EVENT_RETENTION_DAYS, 14);
  });
});

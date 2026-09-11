/**
 * Tests for the embed snippets and server-event labels.
 *
 * The snippets get pasted into third-party sites, so their shape (and the
 * XSS escape inside the widget) is pinned here.
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
    assert.match(html, /src="https:\/\/panel\.example\.com\/status"/);
    assert.match(html, /<iframe/);
    assert.match(html, /title="Server Status"/);
  });

  test("tolerates trailing slashes on the origin", () => {
    const html = buildEmbedIframe("https://panel.example.com///");
    assert.match(html, /src="https:\/\/panel\.example\.com\/status"/);
    assert.ok(!html.includes(".com///"));
  });

  test("honours a custom height", () => {
    assert.match(buildEmbedIframe("https://x.test", 900), /height:900px/);
  });
});

describe("buildEmbedWidget", () => {
  test("fetches the public JSON endpoint", () => {
    const html = buildEmbedWidget("https://panel.example.com");
    assert.match(html, /fetch\("https:\/\/panel\.example\.com\/api\/public\/status"\)/);
  });

  test("escapes server names before injecting them into HTML", () => {
    const html = buildEmbedWidget("https://x.test");
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

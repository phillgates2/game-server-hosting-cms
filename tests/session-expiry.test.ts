/**
 * Session-expiry detection.
 *
 * Two things matter: an expired session must be recognised from any panel
 * request, and the auth endpoints must never be mistaken for one (a signed-out
 * `/api/auth/me` is normal, and a 401 from the login form is a typo, not an
 * expiry). The watcher also has to be invisible to everything else — same
 * requests, same responses, uninstallable.
 *
 *   npm test
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_EXPIRED_EVENT,
  isSessionExpiryResponse,
  installSessionExpiryWatch,
} from "../src/lib/session-expiry";

describe("which 401s mean the session ended", () => {
  test("a rejected panel request does", () => {
    for (const url of ["/api/users", "/api/servers/3", "/api/settings/panel?x=1"]) {
      assert.equal(isSessionExpiryResponse(url, 401), true, url);
    }
  });

  test("the auth endpoints never do, whatever their status", () => {
    for (const url of [
      "/api/auth/me",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/register",
      "/api/auth/login?next=/",
    ]) {
      assert.equal(isSessionExpiryResponse(url, 401), false, url);
    }
  });

  test("another status is not an expiry", () => {
    for (const status of [200, 302, 400, 403, 404, 429, 500, 503]) {
      assert.equal(isSessionExpiryResponse("/api/users", status), false, `status ${status}`);
    }
  });

  test("non-API and malformed URLs are ignored", () => {
    assert.equal(isSessionExpiryResponse("/status", 401), false);
    assert.equal(isSessionExpiryResponse("/api", 401), false);
    assert.equal(isSessionExpiryResponse("", 401), false);
    assert.equal(isSessionExpiryResponse("http://[::1", 401), false);
  });

  test("a 401 from another origin is somebody else's problem", () => {
    assert.equal(isSessionExpiryResponse("https://billing.example.com/api/users", 401), false);
    assert.equal(isSessionExpiryResponse("http://panel.invalid/api/users", 401), true);
  });
});

describe("the watcher", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  });

  test("is a no-op without a browser", () => {
    delete (globalThis as { window?: unknown }).window;
    const uninstall = installSessionExpiryWatch();
    assert.equal(typeof uninstall, "function");
    assert.doesNotThrow(() => uninstall());
  });

  test("announces an expired session once and passes responses through", async () => {
    const events: string[] = [];
    const baseFetch = (async () => new Response(JSON.stringify({ nope: true }), { status: 401 })) as typeof fetch;
    const fakeWindow = {
      fetch: baseFetch,
      location: { origin: "http://panel.invalid" },
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    };
    (globalThis as { window?: unknown }).window = fakeWindow;

    const uninstall = installSessionExpiryWatch();
    assert.notEqual(fakeWindow.fetch, baseFetch, "fetch is wrapped while installed");

    // Two rejections in a row are one expired session, not two announcements.
    const first = await fakeWindow.fetch("/api/users");
    const second = await fakeWindow.fetch("/api/servers");
    assert.equal(first.status, 401);
    assert.deepEqual(await second.json(), { nope: true });
    assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);

    // An auth probe is not an announcement.
    await fakeWindow.fetch("/api/auth/me");
    assert.deepEqual(events, [SESSION_EXPIRED_EVENT]);

    uninstall();
    assert.equal(fakeWindow.fetch, baseFetch, "uninstall restores the original fetch");
  });

  test("installing twice still wraps once", async () => {
    const events: string[] = [];
    const baseFetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    const fakeWindow = {
      fetch: baseFetch,
      location: { origin: "http://panel.invalid" },
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    };
    (globalThis as { window?: unknown }).window = fakeWindow;

    const a = installSessionExpiryWatch();
    const wrappedOnce = fakeWindow.fetch;
    const b = installSessionExpiryWatch();
    assert.equal(fakeWindow.fetch, wrappedOnce, "a second install does not stack wrappers");

    a();
    assert.equal(fakeWindow.fetch, wrappedOnce, "one release leaves the other live");
    b();
    assert.equal(fakeWindow.fetch, baseFetch, "the last release restores the original");
  });
});

/**
 * Tests for the CSRF guard.
 *
 * The panel authenticates with a cookie, so any page on any site can cause the
 * browser to send an authenticated request. `sameSite: "lax"` covers most of
 * that but deliberately not top-level form submissions — and the file upload
 * route accepts multipart/form-data, which is exactly what a cross-site form
 * sends, with no CORS preflight to stop it.
 *
 * This guard runs in middleware over every API route, so the risk is not that
 * it fails open but that it fails *closed* on something legitimate: the
 * installer, a node heartbeat, or the panel's own fetches. Those cases are
 * tested here explicitly.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkCsrf, expectedOrigin } from "../src/lib/csrf";

const PANEL = "https://panel.example.com";

/** Shorthand for a browser request carrying a session cookie. */
function browser(method: string, origin: string | null, expected = PANEL) {
  return checkCsrf({ method, origin, referer: null, expected, hasApiKey: false });
}

describe("blocking cross-site writes", () => {
  test("rejects a POST from another origin", () => {
    // The attack: an auto-submitting form on evil.example fires a POST with
    // the victim's cookie attached.
    const v = browser("POST", "https://evil.example");
    assert.equal(v.ok, false);
    assert.match(String(v.reason), /Cross-site/);
  });

  test("rejects DELETE, PATCH and PUT too", () => {
    for (const m of ["DELETE", "PATCH", "PUT"]) {
      assert.equal(browser(m, "https://evil.example").ok, false, m);
    }
  });

  test("names the offending origin, so the log is actionable", () => {
    assert.match(String(browser("POST", "https://evil.example").reason), /evil\.example/);
  });

  test("a matching host on a different scheme is still cross-origin", () => {
    // http://panel and https://panel are different origins; treating them as
    // equal would let an attacker on a hijacked plaintext connection through.
    assert.equal(browser("POST", "http://panel.example.com").ok, false);
  });

  test("a subdomain is not the same origin", () => {
    assert.equal(browser("POST", "https://evil.panel.example.com").ok, false);
  });

  test("falls back to Referer when Origin is absent", () => {
    const v = checkCsrf({
      method: "POST",
      origin: null,
      referer: "https://evil.example/attack.html",
      expected: PANEL,
      hasApiKey: false,
    });
    assert.equal(v.ok, false);
  });
});

describe("allowing legitimate traffic", () => {
  test("allows the panel's own requests", () => {
    assert.equal(browser("POST", PANEL).ok, true);
  });

  test("never blocks reads", () => {
    // A GET cannot be a CSRF write, and blocking them would break the site.
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      assert.equal(browser(m, "https://evil.example").ok, true, m);
    }
  });

  test("allows API keys from any origin", () => {
    // A key travels in a header a cross-site form cannot set, so it is not a
    // CSRF vector. Blocking it would break every script and integration.
    const v = checkCsrf({
      method: "POST",
      origin: "https://some-tool.example",
      referer: null,
      expected: PANEL,
      hasApiKey: true,
    });
    assert.equal(v.ok, true);
  });

  test("allows a client that sends neither Origin nor Referer", () => {
    // curl, the installer's health checks, and node agents. These are not
    // driving a victim's browser, so they are not the threat being defended
    // against — and failing closed here would break the install flow.
    const v = checkCsrf({
      method: "POST",
      origin: null,
      referer: null,
      expected: PANEL,
      hasApiKey: false,
    });
    assert.equal(v.ok, true);
  });

  test("allows when the host cannot be determined", () => {
    // Without a Host header there is no expectation to compare against.
    // Failing closed would break local tooling for no benefit; sameSite still
    // applies.
    assert.equal(browser("POST", "https://evil.example", null as never).ok, true);
  });

  test("a malformed Origin does not block the request", () => {
    // Garbage in the header should not be treated as a hostile origin, or a
    // buggy client becomes an outage.
    const v = checkCsrf({
      method: "POST",
      origin: "not-a-url",
      referer: null,
      expected: PANEL,
      hasApiKey: false,
    });
    assert.equal(v.ok, true);
  });

  test("case in the method does not matter", () => {
    assert.equal(
      checkCsrf({ method: "post", origin: "https://evil.example", referer: null, expected: PANEL, hasApiKey: false }).ok,
      false
    );
  });
});

describe("determining the expected origin", () => {
  const h = (o: Record<string, string>) => new Headers(o);

  test("uses the Host header", () => {
    assert.equal(
      expectedOrigin({ url: "http://panel.example.com/api/x", headers: h({ host: "panel.example.com" }) }),
      "http://panel.example.com"
    );
  });

  test("honours x-forwarded-proto behind a reverse proxy", () => {
    // Caddy and the nginx/Apache setups terminate TLS, so the URL scheme is
    // http even though the browser used https. Getting this wrong would block
    // every write on a proxied install.
    assert.equal(
      expectedOrigin({
        url: "http://panel.example.com/api/x",
        headers: h({ host: "panel.example.com", "x-forwarded-proto": "https" }),
      }),
      "https://panel.example.com"
    );
  });

  test("prefers x-forwarded-host when present", () => {
    assert.equal(
      expectedOrigin({
        url: "http://internal:3000/api/x",
        headers: h({
          host: "internal:3000",
          "x-forwarded-host": "panel.example.com",
          "x-forwarded-proto": "https",
        }),
      }),
      "https://panel.example.com"
    );
  });

  test("keeps a non-standard port, which is the default install", () => {
    // A bare install serves on :3000 and the browser sends that in Origin.
    assert.equal(
      expectedOrigin({ url: "http://192.168.1.10:3000/api/x", headers: h({ host: "192.168.1.10:3000" }) }),
      "http://192.168.1.10:3000"
    );
  });

  test("returns null with no host at all", () => {
    assert.equal(expectedOrigin({ url: "http://x/api", headers: h({}) }), null);
  });
});

describe("end to end: a default LAN install", () => {
  test("the panel's own POST is allowed", () => {
    const headers = new Headers({ host: "192.168.1.10:3000", origin: "http://192.168.1.10:3000" });
    const v = checkCsrf({
      method: "POST",
      origin: headers.get("origin"),
      referer: null,
      expected: expectedOrigin({ url: "http://192.168.1.10:3000/api/servers", headers }),
      hasApiKey: false,
    });
    assert.equal(v.ok, true);
  });

  test("an attacker's form post is blocked", () => {
    const headers = new Headers({ host: "192.168.1.10:3000", origin: "https://evil.example" });
    const v = checkCsrf({
      method: "POST",
      origin: headers.get("origin"),
      referer: null,
      expected: expectedOrigin({ url: "http://192.168.1.10:3000/api/servers", headers }),
      hasApiKey: false,
    });
    assert.equal(v.ok, false);
  });
});

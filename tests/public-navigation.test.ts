import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PUBLIC_NAV_LINKS,
  MAX_PUBLIC_NAV_LINKS,
  isSafePublicNavHref,
  parsePublicNavLinks,
  publicNavTabForHref,
  validatePublicNavLinksJson,
} from "../src/lib/public-navigation";

describe("public navigation settings", () => {
  test("uses the existing menu when the setting has not been saved", () => {
    assert.deepEqual(parsePublicNavLinks(undefined), DEFAULT_PUBLIC_NAV_LINKS);
    assert.deepEqual(parsePublicNavLinks(""), DEFAULT_PUBLIC_NAV_LINKS);
  });

  test("preserves a deliberately empty menu", () => {
    assert.deepEqual(parsePublicNavLinks("[]"), []);
    assert.equal(validatePublicNavLinksJson("[]").ok, true);
  });

  test("parses editable links and normalises built-in destinations", () => {
    assert.deepEqual(
      parsePublicNavLinks(JSON.stringify([
        { label: "Community", href: "forums" },
        { label: "Docs", href: "/api-docs" },
        { label: "Discord", href: "https://example.com/invite" },
      ])),
      [
        { label: "Community", href: "#forums" },
        { label: "Docs", href: "/api-docs" },
        { label: "Discord", href: "https://example.com/invite" },
      ],
    );
  });

  test("supports the original label-to-URL object format", () => {
    assert.deepEqual(parsePublicNavLinks('{"Home":"/","Help":"/help"}'), [
      { label: "Home", href: "#home" },
      { label: "Help", href: "/help" },
    ]);
    assert.equal(validatePublicNavLinksJson('{"Home":"/"}').ok, true);
  });

  test("maps only built-in destinations to client-side tabs", () => {
    assert.equal(publicNavTabForHref("#shop"), "shop");
    assert.equal(publicNavTabForHref("BLOG"), "blog");
    assert.equal(publicNavTabForHref("/"), "home");
    assert.equal(publicNavTabForHref("/api-docs"), null);
  });

  test("accepts safe local, web, email, and telephone destinations", () => {
    for (const href of ["#forums", "/api-docs", "https://example.com", "http://example.com/help", "mailto:admin@example.com", "tel:+61 400 000 000"]) {
      assert.equal(isSafePublicNavHref(href), true, href);
    }
  });

  test("rejects unsafe or incomplete destinations", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "//example.com", "https://", "#", "relative-page"] ) {
      assert.equal(isSafePublicNavHref(href), false, href);
    }

    const unsafe = validatePublicNavLinksJson('[{"label":"Bad","href":"javascript:alert(1)"}]');
    assert.equal(unsafe.ok, false);
    assert.match(String(unsafe.error), /valid section or URL/);
  });

  test("validates link shape and menu size", () => {
    assert.equal(validatePublicNavLinksJson('[{"href":"#home"}]').ok, false);
    assert.equal(validatePublicNavLinksJson('[{"label":"Home"}]').ok, false);
    assert.equal(validatePublicNavLinksJson('"not a menu"').ok, false);
    assert.equal(validatePublicNavLinksJson("not json").ok, false);

    const tooMany = Array.from({ length: MAX_PUBLIC_NAV_LINKS + 1 }, (_, index) => ({
      label: `Link ${index}`,
      href: "#home",
    }));
    assert.match(String(validatePublicNavLinksJson(JSON.stringify(tooMany)).error), /up to/);
  });

  test("falls back to the default menu if a stored value is corrupt", () => {
    assert.deepEqual(parsePublicNavLinks("not json"), DEFAULT_PUBLIC_NAV_LINKS);
    assert.deepEqual(
      parsePublicNavLinks('[{"label":"Bad","href":"javascript:alert(1)"}]'),
      DEFAULT_PUBLIC_NAV_LINKS,
    );
  });
});

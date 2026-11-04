/**
 * Public-site URLs.
 *
 * The site is a single component with client-side views, so its hash is the
 * only thing a reader can share, bookmark or reload. These tests pin both the
 * happy path (a link lands on the view it names) and the safety property that
 * matters more: any hash at all — empty, truncated, mistyped, percent-encoded
 * or hostile — resolves to something renderable instead of throwing or
 * producing a route with no view behind it.
 *
 *   npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  HOME_ROUTE,
  parseSiteHash,
  siteRouteToHash,
  isSameRoute,
  type SiteRoute,
} from "../src/lib/site-url";
import { PUBLIC_NAV_DESTINATIONS } from "../src/lib/public-navigation";

describe("site hashes parse to routes", () => {
  test("every menu destination round-trips to its own tab", () => {
    for (const destination of PUBLIC_NAV_DESTINATIONS) {
      assert.deepEqual(parseSiteHash(destination.href), { kind: "tab", tab: destination.tab });
      assert.equal(siteRouteToHash({ kind: "tab", tab: destination.tab }), destination.href);
    }
  });

  test("an empty or missing hash is the homepage", () => {
    for (const value of ["", "#", "#/", "/", "#home", "home", null, undefined, "   "]) {
      assert.deepEqual(parseSiteHash(value), HOME_ROUTE, `${JSON.stringify(value)} is home`);
    }
  });

  test("detail views are addressable", () => {
    assert.deepEqual(parseSiteHash("#post/12"), { kind: "post", id: 12 });
    assert.deepEqual(parseSiteHash("#blog/12"), { kind: "post", id: 12 });
    assert.deepEqual(parseSiteHash("#forum/7"), { kind: "category", id: 7 });
    assert.deepEqual(parseSiteHash("#category/7"), { kind: "category", id: 7 });
    assert.deepEqual(parseSiteHash("#thread/7"), { kind: "thread", id: 7 });
    // A thread link written as a full forum path is still a thread.
    assert.deepEqual(parseSiteHash("#forum/thread/7"), { kind: "thread", id: 7 });
    assert.deepEqual(parseSiteHash("#site-editor"), { kind: "site-editor" });
  });

  test("hand-typed hashes are tolerated", () => {
    assert.deepEqual(parseSiteHash("  #FORUMS  "), { kind: "tab", tab: "forums" });
    assert.deepEqual(parseSiteHash("#post/12/"), { kind: "post", id: 12 });
    assert.deepEqual(parseSiteHash("#post/12?utm_source=x"), { kind: "post", id: 12 });
    assert.deepEqual(parseSiteHash("forums"), { kind: "tab", tab: "forums" });
    assert.deepEqual(parseSiteHash("#%70ost/12"), { kind: "post", id: 12 });
  });

  test("anything unrecognisable is the homepage, never a phantom view", () => {
    const junk = [
      "#nonsense",
      "#post",
      "#post/",
      "#post/abc",
      "#post/0",
      "#post/-1",
      "#post/1.5",
      "#post/1e9",
      "#post/2147483648",
      "#post/99999999999999",
      "#thread/",
      "#forum/thread/abc",
      "#forum/thread/7/8",
      "#%%%%",
      "#site-editor/7",
    ];
    for (const value of junk) {
      assert.deepEqual(parseSiteHash(value), HOME_ROUTE, `${value} falls back home`);
    }
  });

  test("ids at the edges of the range are accepted, beyond it they are not", () => {
    assert.deepEqual(parseSiteHash("#post/1"), { kind: "post", id: 1 });
    assert.deepEqual(parseSiteHash("#post/2147483647"), { kind: "post", id: 2147483647 });
    assert.deepEqual(parseSiteHash("#post/2147483648"), HOME_ROUTE);
  });
});

describe("ladder links", () => {
  test("the plain section is still just #ladder", () => {
    assert.deepEqual(parseSiteHash("#ladder"), { kind: "tab", tab: "ladder" });
    assert.equal(siteRouteToHash({ kind: "ladder", key: null, season: null }), "#ladder");
    assert.equal(isSameRoute({ kind: "ladder", key: null, season: null }, { kind: "tab", tab: "ladder" }), true);
  });

  test("a ladder and a season are addressable", () => {
    assert.deepEqual(parseSiteHash("#ladder/game:3"), { kind: "ladder", key: "game:3", season: null });
    assert.deepEqual(parseSiteHash("#ladder/game:3/S2"), { kind: "ladder", key: "game:3", season: "S2" });
  });

  test("standalone ladders keep their name and case", () => {
    const hash = "#ladder/standalone:Bronze%20League/Season%202";
    assert.deepEqual(parseSiteHash(hash), {
      kind: "ladder",
      key: "standalone:Bronze League",
      season: "Season 2",
    });
    // …and survive a round trip through the address bar unchanged.
    assert.deepEqual(parseSiteHash(siteRouteToHash(parseSiteHash(hash))), parseSiteHash(hash));
  });

  test("a key the ladder API could not understand still opens the ladder", () => {
    for (const hash of [
      "#ladder/nonsense",
      "#ladder/game:abc",
      "#ladder/game:0",
      "#ladder/game:2147483648",
      "#ladder/standalone:",
      "#ladder/game:3/", // trailing slash is fine
    ]) {
      const route = parseSiteHash(hash);
      if (hash.endsWith("/")) {
        assert.deepEqual(route, { kind: "ladder", key: "game:3", season: null }, hash);
      } else {
        assert.deepEqual(route, { kind: "tab", tab: "ladder" }, `${hash} falls back to the section`);
      }
    }
  });

  test("oversized or hostile values are dropped, not trusted", () => {
    assert.deepEqual(parseSiteHash(`#ladder/standalone:${"x".repeat(200)}`), {
      kind: "tab",
      tab: "ladder",
    });
    const longSeason = parseSiteHash(`#ladder/game:4/${"s".repeat(80)}`);
    assert.deepEqual(longSeason, { kind: "ladder", key: "game:4", season: null });
    assert.deepEqual(parseSiteHash("#ladder/game:4/%00"), {
      kind: "ladder",
      key: "game:4",
      season: null,
    });
  });
});

describe("routes serialise to canonical hashes", () => {
  const routes: SiteRoute[] = [
    HOME_ROUTE,
    { kind: "tab", tab: "forums" },
    { kind: "tab", tab: "ladder" },
    { kind: "post", id: 3 },
    { kind: "category", id: 4 },
    { kind: "thread", id: 5 },
    { kind: "ladder", key: "game:9", season: "S3" },
    { kind: "ladder", key: "standalone:Bronze League", season: null },
    { kind: "site-editor" },
  ];

  test("every route survives a trip through the address bar", () => {
    for (const route of routes) {
      const hash = siteRouteToHash(route);
      // No spaces, quotes or markup: a hash must survive being pasted into
      // chat, HTML and a shell without escaping tricks.
      assert.match(hash, /^#[^\s"'<>\\]+$/, `${hash} is a plain hash`);
      assert.deepEqual(parseSiteHash(hash), route);
      assert.equal(isSameRoute(parseSiteHash(hash), route), true);
    }
  });

  test("the same place written two ways compares equal", () => {
    assert.equal(isSameRoute(parseSiteHash("#blog/9"), { kind: "post", id: 9 }), true);
    assert.equal(isSameRoute(parseSiteHash("#post/9"), { kind: "post", id: 10 }), false);
    assert.equal(isSameRoute(parseSiteHash("#forums"), { kind: "tab", tab: "forums" }), true);
  });
});

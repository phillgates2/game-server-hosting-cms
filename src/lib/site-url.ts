/**
 * The public site's URL contract.
 *
 * The site is one React component with client-side tabs, so before this a
 * refresh always dropped you back on the homepage, a link to a forum thread
 * could not be sent to anyone, and the browser's Back button left the site
 * instead of returning to the list you came from. Every view now has a hash
 * (`#forums`, `#post/12`, `#thread/7`, …): the address bar is the source of
 * truth, the same way the panel's own routes are.
 *
 * Parsing is deliberately forgiving and total — a hand-typed, truncated or
 * hostile hash must resolve to *something* renderable, never throw and never
 * send the reader to a blank screen.
 */

import { PUBLIC_NAV_DESTINATIONS, type PublicNavTab } from "./public-navigation";

/** The six top-level sections of the site. */
export type SiteTab = PublicNavTab;

export type SiteRoute =
  | { kind: "tab"; tab: SiteTab }
  | { kind: "post"; id: number }
  | { kind: "category"; id: number }
  | { kind: "thread"; id: number }
  | { kind: "site-editor" };

export const HOME_ROUTE: SiteRoute = { kind: "tab", tab: "home" };

const MAX_ID = 2_147_483_647;

const HASH_BY_TAB = new Map<string, string>(
  PUBLIC_NAV_DESTINATIONS.map((destination) => [destination.tab, destination.href])
);

function isTab(value: string): value is SiteTab {
  return HASH_BY_TAB.has(value);
}

/** Positive integer ids only: `0`, `-3`, `1e9`, `12abc` are all rejected. */
function parseId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= MAX_ID ? id : null;
}

/**
 * Resolve a location hash (with or without the leading `#`) to a route.
 * Unknown, empty or malformed values fall back to the homepage.
 */
export function parseSiteHash(raw: string | null | undefined): SiteRoute {
  if (!raw) return HOME_ROUTE;

  let value = raw.trim();
  if (value.startsWith("#")) value = value.slice(1);
  if (value.startsWith("/")) value = value.slice(1);
  // Drop a query string, a second fragment or a trailing slash: `#post/3?x=1`
  // and `#post/3/` both mean the same post.
  const cut = value.search(/[?#]/);
  if (cut >= 0) value = value.slice(0, cut);
  value = value.replace(/\/+$/, "").toLowerCase();

  if (!value || value === "home") return HOME_ROUTE;

  // A hash someone pasted from a rendered link may still be percent-encoded.
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value).toLowerCase();
    } catch {
      return HOME_ROUTE;
    }
  }

  if (isTab(value)) return { kind: "tab", tab: value };

  if (value === "site-editor" || value === "editor") return { kind: "site-editor" };

  const segments = value.split("/").filter(Boolean);

  // `forum/thread/7` is checked before `forum/7`, which is a category.
  if (segments.length === 3 && segments[0] === "forum" && segments[1] === "thread") {
    const id = parseId(segments[2]);
    if (id !== null) return { kind: "thread", id };
    return HOME_ROUTE;
  }

  if (segments.length === 2) {
    const [head, tail] = segments;
    const id = parseId(tail);
    if (id === null) return HOME_ROUTE;
    if (head === "post" || head === "blog") return { kind: "post", id };
    if (head === "forum" || head === "category") return { kind: "category", id };
    if (head === "thread") return { kind: "thread", id };
  }

  return HOME_ROUTE;
}

/** The canonical hash for a route, safe to compare and to push. */
export function siteRouteToHash(route: SiteRoute): string {
  switch (route.kind) {
    case "tab":
      return HASH_BY_TAB.get(route.tab) ?? "#home";
    case "post":
      return `#post/${route.id}`;
    case "category":
      return `#forum/${route.id}`;
    case "thread":
      return `#thread/${route.id}`;
    case "site-editor":
      return "#site-editor";
  }
}

/** True when two routes address the same place (ignores how they were written). */
export function isSameRoute(a: SiteRoute, b: SiteRoute): boolean {
  return siteRouteToHash(a) === siteRouteToHash(b);
}

/**
 * The public site's URL contract.
 *
 * The site is one React component with client-side tabs, so before this a
 * refresh always dropped you back on the homepage, a link to a forum thread
 * could not be sent to anyone, and the browser's Back button left the site
 * instead of returning to the list you came from. Every view now has a hash
 * (`#forums`, `#post/12`, `#thread/7`, `#ladder/game:3/S2`, …): the address bar
 * is the source of truth.
 *
 * Parsing is deliberately forgiving and total — a hand-typed, truncated or
 * hostile hash must resolve to *something* renderable, never throw and never
 * send the reader to a blank screen. Case-insensitive keywords are compared
 * lower-case, but the parts people type themselves (a ladder name, a season
 * label) keep their original case.
 */

import { PUBLIC_NAV_DESTINATIONS, type PublicNavTab } from "./public-navigation";

/** The six top-level sections of the site. */
export type SiteTab = PublicNavTab;

export type SiteRoute =
  | { kind: "tab"; tab: SiteTab }
  | { kind: "post"; id: number }
  | { kind: "category"; id: number }
  | { kind: "thread"; id: number }
  /** `key` is `game:12` or `standalone:Name`; both null means "whatever is default". */
  | { kind: "ladder"; key: string | null; season: string | null }
  | { kind: "site-editor" };

export const HOME_ROUTE: SiteRoute = { kind: "tab", tab: "home" };

const MAX_ID = 2_147_483_647;
const MAX_LADDER_KEY_LENGTH = 120;
const MAX_SEASON_LENGTH = 64;

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

function safeDecode(value: string): string | null {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Accept only ladder identifiers the ladder API actually understands:
 * `game:<id>` or `standalone:<name>`. Anything else falls back to the ladder's
 * default view rather than requesting a ladder that cannot exist.
 */
export function parseLadderKey(value: string): string | null {
  const key = value.trim();
  if (!key || key.length > MAX_LADDER_KEY_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(key)) return null;

  const game = /^game:(\d{1,10})$/i.exec(key);
  if (game) {
    const id = parseId(game[1]);
    return id === null ? null : `game:${id}`;
  }

  const standalone = /^standalone:(.+)$/i.exec(key);
  if (standalone && standalone[1].trim()) {
    return `standalone:${standalone[1].trim()}`;
  }

  return null;
}

/** Encode a ladder key for a hash without escaping the readable colon. */
function encodeLadderPart(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":");
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
  value = value.replace(/\/+$/, "");
  if (!value) return HOME_ROUTE;

  const segments = value.split("/").filter(Boolean);
  const head = safeDecode(segments[0]);
  if (head === null) return HOME_ROUTE;
  const lowerHead = head.toLowerCase();

  if (segments.length === 1) {
    if (lowerHead === "home") return HOME_ROUTE;
    if (isTab(lowerHead)) return { kind: "tab", tab: lowerHead };
    if (lowerHead === "site-editor" || lowerHead === "editor") return { kind: "site-editor" };
  }

  // `#ladder`, `#ladder/game:3`, `#ladder/standalone:Name/S2`.
  if (lowerHead === "ladder") {
    if (segments.length === 1) return { kind: "ladder", key: null, season: null };
    const key = parseLadderKey(safeDecode(segments[1]) ?? "");
    if (!key) return { kind: "tab", tab: "ladder" };
    const seasonRaw = segments[2] ? safeDecode(segments[2]) : null;
    const season =
      seasonRaw &&
      seasonRaw.trim() &&
      seasonRaw.length <= MAX_SEASON_LENGTH &&
      !/[\u0000-\u001f\u007f]/.test(seasonRaw)
        ? seasonRaw.trim()
        : null;
    return { kind: "ladder", key, season };
  }

  // `forum/thread/7` is checked before `forum/7`, which is a category.
  if (segments.length === 3 && lowerHead === "forum" && segments[1].toLowerCase() === "thread") {
    const id = parseId(segments[2]);
    return id === null ? HOME_ROUTE : { kind: "thread", id };
  }

  if (segments.length === 2) {
    const id = parseId(segments[1]);
    if (id === null) return HOME_ROUTE;
    if (lowerHead === "post" || lowerHead === "blog") return { kind: "post", id };
    if (lowerHead === "forum" || lowerHead === "category") return { kind: "category", id };
    if (lowerHead === "thread") return { kind: "thread", id };
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
    case "ladder": {
      if (!route.key) return "#ladder";
      const path = `#ladder/${encodeLadderPart(route.key)}`;
      return route.season ? `${path}/${encodeLadderPart(route.season)}` : path;
    }
    case "site-editor":
      return "#site-editor";
  }
}

/** True when two routes address the same place (ignores how they were written). */
export function isSameRoute(a: SiteRoute, b: SiteRoute): boolean {
  return siteRouteToHash(a) === siteRouteToHash(b);
}

/**
 * The panel's address.
 *
 * The dashboard is one page with client-side panels, so a refresh always
 * dropped the operator back on Overview — on a host with thirty servers, losing
 * the panel you were watching (and the server detail inside it) every time you
 * hit F5. Panel tabs now live in the hash as `#panel/servers`, `#panel/monitor`
 * and so on, which also makes Back and Forward walk the panels you actually
 * visited.
 *
 * Panel hashes are namespaced so they can never be confused with the public
 * site's own hashes (`#forums`, `#ladder`, `#post/12`) — the two live on the
 * same URL.
 */

export const PANEL_HASH_PREFIX = "#panel/";

/** Where a panel lives: `servers` → `#panel/servers`. */
export function panelHash(tab: string): string {
  return `${PANEL_HASH_PREFIX}${tab.trim().toLowerCase()}`;
}

/**
 * The panel slug named by a hash, or null when the hash is not a panel address
 * (a public-site hash, a selection inside a panel, or junk).
 */
export function parsePanelHash(hash: string | null | undefined): string | null {
  if (!hash) return null;

  const value = hash.trim();
  if (!value.startsWith(PANEL_HASH_PREFIX)) return null;

  let slug = value.slice(PANEL_HASH_PREFIX.length);
  const cut = slug.search(/[?#]/);
  if (cut >= 0) slug = slug.slice(0, cut);
  slug = slug.replace(/\/+$/, "").toLowerCase();

  // Same shape as the panel keys themselves: short, lower-case, dashed.
  return /^[a-z][a-z0-9-]{0,31}$/.test(slug) ? slug : null;
}

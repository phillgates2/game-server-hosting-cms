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

const MAX_PART_LENGTH = 200;

/** Where a panel lives: `servers` → `#panel/servers`. */
export function panelHash(tab: string): string {
  return `${PANEL_HASH_PREFIX}${tab.trim().toLowerCase()}`;
}

export interface PanelAddress {
  tab: string;
  /** Anything after the panel name, decoded: `#panel/files/12/config` → ["12", "config"]. */
  parts: string[];
}

/** Where a panel's inner state lives: `panelAddressHash("files", ["12", "plugins"])`. */
export function panelAddressHash(tab: string, parts: readonly string[] = []): string {
  const encoded = parts
    .filter((part) => part && part.length <= MAX_PART_LENGTH)
    .map((part) => encodeURIComponent(part));
  return `${panelHash(tab)}${encoded.length ? `/${encoded.join("/")}` : ""}`;
}

/**
 * The panel address named by a hash, or null when the hash is not a panel
 * address (a public-site hash, or junk). Extra path segments are decoded and
 * bounded so a panel can use them — the file manager uses them to remember the
 * server and folder you were looking at.
 */
export function parsePanelAddress(hash: string | null | undefined): PanelAddress | null {
  if (!hash) return null;

  const value = hash.trim();
  if (!value.startsWith(PANEL_HASH_PREFIX)) return null;

  let rest = value.slice(PANEL_HASH_PREFIX.length);
  const cut = rest.search(/[?#]/);
  if (cut >= 0) rest = rest.slice(0, cut);
  rest = rest.replace(/\/+$/, "");

  const [rawTab, ...rawParts] = rest.split("/");
  const tab = (rawTab ?? "").toLowerCase();
  // Same shape as the panel keys themselves: short, lower-case, dashed.
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(tab)) return null;

  const parts: string[] = [];
  for (const raw of rawParts) {
    if (!raw) continue;
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      part = raw;
    }
    if (!part || part.length > MAX_PART_LENGTH) continue;
    if (/[\u0000-\u001f\u007f]/.test(part)) continue;
    parts.push(part);
  }

  return { tab, parts };
}

/**
 * The panel slug named by a hash, or null when the hash is not a panel address.
 */
export function parsePanelHash(hash: string | null | undefined): string | null {
  return parsePanelAddress(hash)?.tab ?? null;
}

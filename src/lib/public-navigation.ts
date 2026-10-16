/**
 * Public-site navigation stored in the `nav_links_json` setting.
 *
 * Built-in sections use hash-like destinations (for example `#forums`) so
 * the menu can drive PublicSite's client-side tabs. Regular local and external
 * URLs are also supported. Keeping parsing and validation here means a broken
 * or unsafe stored value never has to be trusted by the React component.
 */

export const PUBLIC_NAV_DESTINATIONS = [
  { tab: "home", href: "#home", label: "Home" },
  { tab: "shop", href: "#shop", label: "Shop" },
  { tab: "forums", href: "#forums", label: "Forums" },
  { tab: "ladder", href: "#ladder", label: "Ladder" },
  { tab: "blog", href: "#blog", label: "Blog" },
  { tab: "changelog", href: "#changelog", label: "Changelog" },
] as const;

export type PublicNavTab = (typeof PUBLIC_NAV_DESTINATIONS)[number]["tab"];

export interface PublicNavLink {
  label: string;
  href: string;
}

export const DEFAULT_PUBLIC_NAV_LINKS: readonly PublicNavLink[] = [
  { label: "Home", href: "#home" },
  { label: "🛒 Shop", href: "#shop" },
  { label: "Forums", href: "#forums" },
  { label: "Ladder", href: "#ladder" },
  { label: "Blog", href: "#blog" },
  { label: "Changelog", href: "#changelog" },
];

export const MAX_PUBLIC_NAV_LINKS = 24;
export const MAX_PUBLIC_NAV_LABEL_LENGTH = 80;
export const MAX_PUBLIC_NAV_HREF_LENGTH = 2_048;

interface DecodeResult {
  links?: PublicNavLink[];
  error?: string;
}

function defaultLinks(): PublicNavLink[] {
  return DEFAULT_PUBLIC_NAV_LINKS.map((link) => ({ ...link }));
}

/** Convert friendly built-in aliases to the canonical hash destination. */
export function normalisePublicNavHref(value: string): string {
  const href = value.trim();
  const lower = href.toLowerCase();

  if (lower === "/") return "#home";

  for (const destination of PUBLIC_NAV_DESTINATIONS) {
    if (lower === destination.tab || lower === destination.href) {
      return destination.href;
    }
  }

  return href;
}

/** Return the PublicSite tab represented by a menu destination, if any. */
export function publicNavTabForHref(value: string): PublicNavTab | null {
  const href = normalisePublicNavHref(value);
  return PUBLIC_NAV_DESTINATIONS.find((destination) => destination.href === href)?.tab ?? null;
}

/**
 * Only destinations React can safely put in an anchor are accepted.
 * Built-in tabs are handled as buttons, but pass this check as hashes too.
 */
export function isSafePublicNavHref(value: string): boolean {
  const href = normalisePublicNavHref(value);
  if (!href || href.length > MAX_PUBLIC_NAV_HREF_LENGTH || /[\u0000-\u001f\u007f]/.test(href)) {
    return false;
  }

  if (href.startsWith("#")) return href.length > 1 && !/\s/.test(href);
  if (href.startsWith("/") && !href.startsWith("//")) return !/\s/.test(href);

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  if (/^mailto:/i.test(href)) return /^mailto:[^\s@]+@[^\s@]+$/i.test(href);
  if (/^tel:/i.test(href)) return /^tel:\+?[0-9(). -]{3,}$/i.test(href);

  return false;
}

function decodeLink(labelValue: unknown, hrefValue: unknown, index: number): DecodeResult {
  if (typeof labelValue !== "string" || !labelValue.trim()) {
    return { error: `Navigation link ${index + 1} needs a label` };
  }
  const label = labelValue.trim();
  if (label.length > MAX_PUBLIC_NAV_LABEL_LENGTH) {
    return { error: `Navigation link ${index + 1} label is too long (max ${MAX_PUBLIC_NAV_LABEL_LENGTH} characters)` };
  }
  if (typeof hrefValue !== "string" || !isSafePublicNavHref(hrefValue)) {
    return { error: `Navigation link ${index + 1} needs a valid section or URL` };
  }

  return { links: [{ label, href: normalisePublicNavHref(hrefValue) }] };
}

function decodePublicNavValue(value: unknown): DecodeResult {
  let entries: Array<[unknown, unknown]>;

  if (Array.isArray(value)) {
    entries = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [undefined, undefined];
      const candidate = item as Record<string, unknown>;
      return [candidate.label, candidate.href];
    });
  } else if (value && typeof value === "object") {
    // Backwards compatibility for the early documented shape:
    // { "Home": "/", "Community": "https://example.com" }
    entries = Object.entries(value as Record<string, unknown>);
  } else {
    return { error: "nav_links_json must be an array of links" };
  }

  if (entries.length > MAX_PUBLIC_NAV_LINKS) {
    return { error: `Navigation supports up to ${MAX_PUBLIC_NAV_LINKS} links` };
  }

  const links: PublicNavLink[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const [label, href] = entries[index];
    const decoded = decodeLink(label, href, index);
    if (decoded.error) return decoded;
    links.push(decoded.links![0]);
  }

  return { links };
}

/**
 * Parse the stored setting for display. Missing/invalid settings retain the
 * default menu; a valid empty array deliberately means "show no menu links".
 */
export function parsePublicNavLinks(raw: string | null | undefined): PublicNavLink[] {
  if (typeof raw !== "string" || raw.trim() === "") return defaultLinks();

  try {
    const decoded = decodePublicNavValue(JSON.parse(raw));
    return decoded.links ?? defaultLinks();
  } catch {
    return defaultLinks();
  }
}

/** Validate the setting before it is persisted by the site-settings API. */
export function validatePublicNavLinksJson(raw: string): { ok: boolean; error?: string } {
  if (raw.trim() === "") return { ok: true };

  try {
    const decoded = decodePublicNavValue(JSON.parse(raw));
    return decoded.error ? { ok: false, error: decoded.error } : { ok: true };
  } catch {
    return { ok: false, error: "nav_links_json must be valid JSON" };
  }
}

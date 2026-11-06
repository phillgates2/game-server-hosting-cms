/**
 * Terms of Service and Privacy Policy.
 *
 * The panel ships one of these documents for every deployment, because a
 * hosting business that takes money and holds other people's data needs both
 * from the day it opens — and "write your own legal pages" is exactly the kind
 * of task that gets deferred forever. What ships is a starting point an
 * operator is expected to edit (Site Editor → Legal pages), not legal advice,
 * so everything here is built around being *edited*:
 *
 *   • The text lives in the `settings` table, not in a `.tsx` file, so changing
 *     a refund policy does not require a deploy.
 *   • It is rendered from a deliberately small subset of markdown, and inline
 *     HTML is never trusted — an operator pasting `<script>` gets the literal
 *     characters on the page, not an XSS hole on a page every visitor loads.
 *   • Every document is fingerprinted (`legalVersion`), and registration and
 *     checkout record *which* fingerprint a person accepted. When the text
 *     changes, the fingerprint changes, so "when did this customer agree to the
 *     current refund policy?" has an answer.
 *   • Placeholders (`{{operator}}`, `{{contact}}`, …) are filled from the same
 *     settings the rest of the site uses, so the documents cannot drift from
 *     the panel name in the header.
 *
 * Everything in this file is pure: no database, no React, no node:crypto. The
 * route handlers and the renderer are thin wrappers, and the tests can pin the
 * behaviour without either.
 */

/** `settings` keys holding the documents. Dotted in the UI, snake in the DB. */
export const TERMS_TEXT_KEY = "legal_terms_text";
export const PRIVACY_TEXT_KEY = "legal_privacy_text";
export const OPERATOR_NAME_KEY = "legal_operator_name";
export const CONTACT_EMAIL_KEY = "legal_contact_email";
export const JURISDICTION_KEY = "legal_jurisdiction";

export const LEGAL_TEXT_KEYS = [TERMS_TEXT_KEY, PRIVACY_TEXT_KEY] as const;

/** Who an operator is, for the documents' "we"/"us" and contact details. */
export const LEGAL_PROFILE_KEYS = [
  OPERATOR_NAME_KEY,
  CONTACT_EMAIL_KEY,
  JURISDICTION_KEY,
] as const;

/**
 * A document is stored in a `text` column and rendered on a single page. The
 * default Terms plus default Privacy are ~14 KB together; 80 KB each is room
 * for a decade of amendments without letting one settings save carry a novel.
 */
export const MAX_LEGAL_TEXT_LENGTH = 80_000;

/** The two documents exist as a pair: one URL each, one acceptance each. */
export type LegalDocumentId = "terms" | "privacy";

export const LEGAL_DOCUMENTS: ReadonlyArray<{
  id: LegalDocumentId;
  path: string;
  title: string;
  /** Which stored setting supplies the body. */
  key: typeof TERMS_TEXT_KEY | typeof PRIVACY_TEXT_KEY;
  /** Accessible name for the tab / link. */
  shortTitle: string;
}> = [
  {
    id: "terms",
    path: "/terms",
    title: "Terms of Service",
    shortTitle: "Terms",
    key: TERMS_TEXT_KEY,
  },
  {
    id: "privacy",
    path: "/privacy",
    title: "Privacy Policy",
    shortTitle: "Privacy",
    key: PRIVACY_TEXT_KEY,
  },
];

export function legalDocument(id: LegalDocumentId) {
  return LEGAL_DOCUMENTS.find((doc) => doc.id === id) ?? LEGAL_DOCUMENTS[0];
}

// ── Placeholders ────────────────────────────────────────────────────────────

export const LEGAL_PLACEHOLDER_KEYS = [
  "panel",
  "operator",
  "contact",
  "contact_link",
  "jurisdiction",
  "updated",
  "year",
] as const;

export type LegalPlaceholderKey = (typeof LEGAL_PLACEHOLDER_KEYS)[number];

export interface LegalProfile {
  /** The site's name, from `panel_name` — same value the header shows. */
  panelName: string;
  /** The legal entity operating this deployment. Falls back to the panel name. */
  operatorName: string;
  /** Address people write to for support, privacy and complaints. */
  contactEmail: string;
  /** Governing law, e.g. "Queensland, Australia". */
  jurisdiction: string;
  /** Human date the documents were last changed, e.g. "7 November 2026". */
  updated: string;
}

/** Shown where a contact address was never configured, so the gap is visible. */
export const MISSING_CONTACT_TEXT = "(contact address not configured)";

export const DEFAULT_JURISDICTION = "Queensland, Australia";

/** The `{{…}}` tokens a stored document may use. */
export function legalPlaceholders(profile: LegalProfile): Record<LegalPlaceholderKey, string> {
  const panelName = profile.panelName.trim() || "this service";
  const contact = profile.contactEmail.trim();
  return {
    panel: panelName,
    operator: profile.operatorName.trim() || panelName,
    contact: contact || MISSING_CONTACT_TEXT,
    // `{{contact_link}}` renders as a mailto link when there is an address,
    // and as the visible warning text when there is not — so a document never
    // publishes a link that goes nowhere.
    contact_link: contact ? `[${contact}](mailto:${contact})` : MISSING_CONTACT_TEXT,
    jurisdiction: profile.jurisdiction.trim() || DEFAULT_JURISDICTION,
    updated: profile.updated.trim(),
    year: String(new Date().getUTCFullYear()),
  };
}

/**
 * Replace `{{key}}` tokens, case-insensitively and tolerating inner spaces
 * (`{{ contact }}`), which is what people actually type.
 *
 * Unknown tokens are left alone deliberately: silently deleting them would
 * hide a typo, and rendering them shows the operator exactly what is wrong on
 * the page they can see.
 */
export function renderLegalText(template: string, placeholders: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return Object.prototype.hasOwnProperty.call(placeholders, key) ? placeholders[key] : whole;
  });
}

// ── Versioning ──────────────────────────────────────────────────────────────

/**
 * A short, stable fingerprint of the accepted text.
 *
 * This is a content hash, not cryptography: it only has to change when the
 * words change, and be cheap enough to compute during a render. FNV-1a in two
 * 32-bit lanes gives a 16-hex-character id — collision risk is irrelevant
 * because the value is compared against the same document's own history, and
 * every acceptance row also carries its timestamp.
 */
export function legalVersion(...documents: string[]): string {
  const input = documents.join("\u0000");
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= code + i;
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// ── Rendering: a small, safe subset of markdown ──────────────────────────────

export type LegalInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

export type LegalBlock =
  /** `# Heading` — the document title. */
  | { kind: "title"; inlines: LegalInline[] }
  /** `## Heading` — a numbered section in practice. */
  | { kind: "heading"; inlines: LegalInline[] }
  | { kind: "paragraph"; inlines: LegalInline[] }
  | { kind: "bullets"; items: LegalInline[][] }
  | { kind: "ordered"; items: LegalInline[][]; start: number };

/** Only schemes a policy has any business linking to. */
export function isSafeLegalHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("#")) return value.length > 1;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return /^(https?:\/\/|mailto:)/i.test(value) && !/\s/.test(value);
}

/**
 * Split one line into text, **bold** and [links](href).
 *
 * Anything that fails to parse (an unclosed `**`, a `javascript:` href) is
 * emitted as literal text: a policy that renders its own markup is less
 * confusing than one that silently drops a sentence.
 */
export function parseLegalInline(line: string): LegalInline[] {
  const out: LegalInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const end = line.indexOf("**", i + 2);
      const body = end === -1 ? "" : line.slice(i + 2, end);
      if (end !== -1 && body.trim()) {
        flush();
        out.push({ kind: "bold", text: body });
        i = end + 2;
        continue;
      }
    }

    if (line[i] === "[") {
      const labelEnd = line.indexOf("]", i + 1);
      const hrefEnd = labelEnd === -1 ? -1 : line.indexOf(")", labelEnd + 1);
      if (labelEnd !== -1 && hrefEnd !== -1 && line[labelEnd + 1] === "(") {
        const label = line.slice(i + 1, labelEnd);
        const href = line.slice(labelEnd + 2, hrefEnd).trim();
        if (label.trim() && isSafeLegalHref(href)) {
          flush();
          out.push({ kind: "link", text: label, href });
          i = hrefEnd + 1;
          continue;
        }
      }
    }

    buffer += line[i];
    i += 1;
  }

  flush();
  return out.length > 0 ? out : [{ kind: "text", text: "" }];
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/;

/**
 * Parse a whole document into blocks.
 *
 * Whitespace-only input is an empty document (not an error): the caller
 * decides whether that means "use the shipped default" or "the operator
 * cleared this page".
 */
export function parseLegalDocument(source: string): LegalBlock[] {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] | null = null;
  let ordered: { items: string[]; start: number } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", inlines: parseLegalInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushLists = () => {
    if (bullets) {
      blocks.push({ kind: "bullets", items: bullets.map((item) => parseLegalInline(item)) });
      bullets = null;
    }
    if (ordered) {
      blocks.push({
        kind: "ordered",
        items: ordered.items.map((item) => parseLegalInline(item)),
        start: ordered.start,
      });
      ordered = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushLists();
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    if (/^#\s+/.test(line)) {
      flushAll();
      blocks.push({ kind: "title", inlines: parseLegalInline(line.replace(/^#\s+/, "").trim()) });
      continue;
    }

    if (/^#{2,6}\s+/.test(line)) {
      flushAll();
      blocks.push({ kind: "heading", inlines: parseLegalInline(line.replace(/^#{2,6}\s+/, "").trim()) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flushParagraph();
      if (ordered) flushLists();
      bullets = bullets ?? [];
      bullets.push(bullet[1].trim());
      continue;
    }

    const numbered = ORDERED_RE.exec(line);
    if (numbered) {
      flushParagraph();
      if (bullets) flushLists();
      if (!ordered) ordered = { items: [], start: Number(numbered[1]) || 1 };
      ordered.items.push(numbered[2].trim());
      continue;
    }

    // A plain line inside a list continues the previous item: policies are
    // often hard-wrapped, and a wrapped bullet should not become a paragraph.
    if (bullets) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line.trim()}`;
      continue;
    }
    if (ordered) {
      ordered.items[ordered.items.length - 1] = `${ordered.items[ordered.items.length - 1]} ${line.trim()}`;
      continue;
    }

    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}

// ── Stored values ───────────────────────────────────────────────────────────

export interface LegalTextCheck {
  ok: boolean;
  error?: string;
  value: string;
}

/**
 * Normalise a document before it is stored.
 *
 * Blank means "use the shipped default" rather than "publish a blank policy",
 * so clearing the box in the editor is a legitimate way to go back to the
 * template. Control characters are stripped because they are invisible in the
 * editor and corrupt the version fingerprint without changing what a reader
 * can see.
 */
export function normaliseLegalText(raw: unknown): LegalTextCheck {
  const value = typeof raw === "string" ? raw : String(raw ?? "");
  const cleaned = value.replace(/\r\n/g, "\n").split("").filter((ch) => {
    const code = ch.charCodeAt(0);
    return code === 9 || code === 10 || (code >= 32 && code !== 127);
  }).join("").trim();

  if (cleaned.length > MAX_LEGAL_TEXT_LENGTH) {
    return {
      ok: false,
      error: `Documents are limited to ${MAX_LEGAL_TEXT_LENGTH.toLocaleString("en-US")} characters`,
      value: "",
    };
  }
  return { ok: true, value: cleaned };
}

/** Contact addresses are shown on a public page and used by `mailto:` links. */
export function isValidLegalContact(value: string): boolean {
  const email = value.trim();
  if (email === "") return true; // unset is allowed; the page says so
  if (email.length > 254) return false;
  return /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/.test(email);
}

// ── Acceptance ──────────────────────────────────────────────────────────────

/**
 * The gate every accepting surface shares.
 *
 * Two failures matter and they are different: a person who never ticked the box
 * (400 — fix the form), and a person whose tab held an older copy of the
 * policy than the one now published (409 — re-read and try again). Collapsing
 * those into one message is how a silently-stale acceptance gets recorded.
 */
export type AcceptanceFailure = "not-accepted" | "stale" | "bad-version";

export interface AcceptanceCheck {
  ok: boolean;
  failure?: AcceptanceFailure;
  error?: string;
}

export function checkLegalAcceptance(input: {
  accepted: unknown;
  shownVersion: unknown;
  currentVersion: string;
}): AcceptanceCheck {
  if (input.accepted !== true) {
    return {
      ok: false,
      failure: "not-accepted",
      error: "You must accept the Terms of Service and Privacy Policy to continue.",
    };
  }
  if (typeof input.shownVersion !== "string" || input.shownVersion.trim() === "") {
    return {
      ok: false,
      failure: "bad-version",
      error: "Reload the page before continuing — the policy version was not sent.",
    };
  }
  if (input.shownVersion.trim() !== input.currentVersion) {
    return {
      ok: false,
      failure: "stale",
      error:
        "The Terms of Service changed while this page was open. Reload it, read the new version and accept again.",
    };
  }
  return { ok: true };
}

/** Where an acceptance was captured, so a record is never mis-attributed. */
export type AcceptanceSurface = "register" | "checkout";

export function isAcceptanceSurface(value: unknown): value is AcceptanceSurface {
  return value === "register" || value === "checkout";
}

/**
 * A document id may be sent as one id, "both", or an array. Normalised here so
 * the order and duplicates cannot vary between payloads and DDL-free checks.
 */
export function normaliseAcceptedDocuments(value: unknown): LegalDocumentId[] {
  const wanted = new Set<LegalDocumentId>();
  const push = (item: unknown) => {
    if (item === "both") {
      wanted.add("terms");
      wanted.add("privacy");
      return;
    }
    if (item === "terms" || item === "privacy") wanted.add(item);
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return LEGAL_DOCUMENTS.map((doc) => doc.id).filter((id) => wanted.has(id));
}

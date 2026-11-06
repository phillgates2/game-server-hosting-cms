/**
 * Building the legal documents for display.
 *
 * Split from `legal-store.ts` — which talks to the database — so the page and
 * the tests can resolve the published text without a database connection. The
 * rule inside is the important part: **stored text wins, blank means "use the
 * shipped default"**, and the version is a fingerprint of the *rendered* text,
 * which is exactly what a reader is shown and what an acceptance records.
 */

import {
  DEFAULT_JURISDICTION,
  PRIVACY_TEXT_KEY,
  TERMS_TEXT_KEY,
  legalDocument,
  legalPlaceholders,
  legalVersion,
  normaliseLegalText,
  parseLegalDocument,
  renderLegalText,
  type LegalBlock,
  type LegalDocumentId,
  type LegalProfile,
} from "./legal";
import { DEFAULT_LEGAL_DATE, DEFAULT_LEGAL_TEXTS } from "./legal-documents";

/** `panel_name` lives in the public site settings, not the legal keys. */
export const PANEL_NAME_SETTING_KEY = "panel_name";

/** The month-and-day form the documents use, e.g. "7 November 2026". */
export function formatLegalDate(date: Date): string {
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface LegalSource {
  /** Raw stored text; `""` means the operator cleared it. */
  text: string;
  /** `true` when the text shown is the shipped template. */
  isDefault: boolean;
}

export interface LegalVersion {
  /** Fingerprint of both documents, formatted as `2026-11-07-<hash>`. */
  version: string;
  /** The date half, for display. */
  date: string;
}

export interface LegalDocumentView extends LegalSource {
  id: LegalDocumentId;
  title: string;
  path: string;
  /** The document with placeholders filled — what a reader sees. */
  rendered: string;
  blocks: LegalBlock[];
}

export interface LegalDocuments {
  profile: LegalProfile;
  version: LegalVersion;
  documents: Record<LegalDocumentId, LegalDocumentView>;
}

/**
 * Build both documents from raw stored values.
 *
 * Pure and synchronous: no database, no clock beyond the `updatedAt`/`now` the
 * caller supplies, so the admin editor's preview and the tests see exactly what
 * a visitor would.
 */
export function buildLegalDocuments(input: {
  values: Record<string, string | null | undefined>;
  /** When either document was last saved; null for a fresh install. */
  updatedAt?: Date | null;
  /** Unused for dating; kept so callers can pin a clock without surprises. */
  now?: Date;
}): LegalDocuments {
  const stored = (key: string) => {
    const raw = input.values[key];
    return typeof raw === "string" ? raw : "";
  };
  const panelName = stored(PANEL_NAME_SETTING_KEY).trim() || "GameServer Manager";
  // A stored document carries the moment it was saved; the shipped text
  // carries its own revision date. Neither falls back to "today", which would
  // re-version an untouched policy every midnight.
  const effectiveDate = input.updatedAt ?? new Date(`${DEFAULT_LEGAL_DATE}T00:00:00Z`);
  const updated = formatLegalDate(effectiveDate);

  const profile: LegalProfile = {
    panelName,
    operatorName: stored("legal_operator_name"),
    contactEmail: stored("legal_contact_email"),
    jurisdiction: stored("legal_jurisdiction") || DEFAULT_JURISDICTION,
    updated,
  };
  const placeholders = legalPlaceholders(profile);

  const sources: Record<LegalDocumentId, string> = {
    terms: stored(TERMS_TEXT_KEY),
    privacy: stored(PRIVACY_TEXT_KEY),
  };

  const built = {} as LegalDocuments["documents"];
  for (const id of ["terms", "privacy"] as const) {
    const meta = legalDocument(id);
    const raw = normaliseLegalText(sources[id]).value;
    const isDefault = raw === "";
    const template = isDefault ? DEFAULT_LEGAL_TEXTS[id] : raw;
    const rendered = renderLegalText(template, placeholders);
    built[id] = {
      id,
      title: meta.title,
      path: meta.path,
      text: raw,
      isDefault,
      rendered,
      blocks: parseLegalDocument(rendered),
    };
  }

  return {
    profile,
    version: {
      // The date is part of the version, so two different edits on different
      // days cannot collide even in principle, and the numbers a reader sees
      // (`v2026-11-07-ab12…`) say when it changed as well as what it said.
      version: `${effectiveDate.toISOString().slice(0, 10)}-${legalVersion(
        built.terms.rendered,
        built.privacy.rendered
      )}`,
      date: updated,
    },
    documents: built,
  };
}

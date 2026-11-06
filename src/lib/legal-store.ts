/**
 * Loading published legal documents.
 *
 * The one place the terms/privacy text is resolved, so the public pages, the
 * acceptance gate in registration and checkout, and the admin editor can never
 * disagree about what is currently published. That matters more than it looks:
 * the version a person accepts is computed from exactly these strings, so a
 * surface that resolved them differently would record acceptances for text
 * nobody was shown.
 *
 * Precedence is deliberately "stored, else shipped": an operator who clears a
 * document gets the template back rather than a blank page or a 404.
 */

import { db } from "@/db";
import { legalAcceptances, settings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { LEGAL_PROFILE_KEYS, LEGAL_TEXT_KEYS, type LegalDocumentId } from "./legal";
import {
  PANEL_NAME_SETTING_KEY,
  buildLegalDocuments,
  type LegalDocuments,
} from "./legal-view";

// Re-exported so callers have one import for "legal documents", whichever
// half of the job they need.
export { buildLegalDocuments, formatLegalDate } from "./legal-view";
export type {
  LegalDocumentView,
  LegalDocuments,
  LegalSource,
  LegalVersion,
} from "./legal-view";

const READ_KEYS = [...LEGAL_TEXT_KEYS, ...LEGAL_PROFILE_KEYS, PANEL_NAME_SETTING_KEY];

/** Read the published documents from the database. */
export async function loadLegalDocuments(now: Date = new Date()): Promise<LegalDocuments> {
  const rows = await db
    .select({ key: settings.key, value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(inArray(settings.key, READ_KEYS as unknown as string[]));

  const values: Record<string, string | null> = {};
  let updatedAt: Date | null = null;
  for (const row of rows) {
    values[row.key] = row.value;
    if (LEGAL_TEXT_KEYS.includes(row.key as (typeof LEGAL_TEXT_KEYS)[number]) && row.value) {
      if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
    }
  }

  return buildLegalDocuments({ values, updatedAt, now });
}

/**
 * The current acceptance version, for callers that only need to compare.
 *
 * Fails soft: a database that cannot be reached must not turn a signup into a
 * 500, and `null` tells the caller to skip the check rather than to invent a
 * version nobody was shown.
 */
export async function currentLegalVersion(): Promise<string | null> {
  try {
    const docs = await loadLegalDocuments();
    return docs.version.version;
  } catch {
    return null;
  }
}

export interface LegalAcceptanceRecord {
  userId?: number | null;
  surface: "register" | "checkout";
  version: string;
  documents: LegalDocumentId[];
  email?: string | null;
  /** Reference to whatever was created alongside it: a user id, an order id. */
  reference?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The acceptance table, created on demand like the other opt-in features. */
export async function ensureLegalAcceptancesTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS legal_acceptances (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      surface VARCHAR(16) NOT NULL,
      version VARCHAR(64) NOT NULL,
      documents TEXT NOT NULL,
      email VARCHAR(254),
      reference VARCHAR(64),
      ip_address VARCHAR(45),
      user_agent VARCHAR(256),
      accepted_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS legal_acceptances_user_id_idx
      ON legal_acceptances (user_id)
  `);
}

/**
 * Record that someone accepted a version.
 *
 * Best-effort by design: registration and checkout must not fail because the
 * evidence log could not be written, but a failure is returned so the caller
 * can note it rather than pretend. `reference` is the user id (text) for a
 * signup and the order id for a checkout.
 */
export async function recordLegalAcceptance(
  record: LegalAcceptanceRecord
): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureLegalAcceptancesTable();
    await db.insert(legalAcceptances).values({
      userId: record.userId ?? null,
      surface: record.surface,
      version: record.version,
      documents: record.documents.join(","),
      email: record.email ?? null,
      reference: record.reference ?? null,
      ipAddress: record.ipAddress ?? null,
      userAgent: record.userAgent?.slice(0, 256) ?? null,
    });
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not record acceptance" };
  }
}

/**
 * The panel access gate (CD-key style).
 *
 * When enabled, login/registration/OAuth all require a valid access key in
 * addition to normal credentials. Two operator escape hatches, both
 * deliberate:
 *
 *  - GSM_ACCESS_GATE=on|off force-overrides the stored setting.
 *  - GSM_PANEL_MASTER_KEY, when at least 16 chars, always opens the gate —
 *    the "never lock myself out" key that lives outside the database.
 */

import { db } from "@/db";
import { accessKeys, settings } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  ACCESS_GATE_SETTING_KEY,
  hashAccessKey,
  isValidAccessKeyFormat,
  normalizeAccessKey,
} from "./access-keys";

export const ACCESS_GATE_ENV = "GSM_ACCESS_GATE";
export const PANEL_MASTER_KEY_ENV = "GSM_PANEL_MASTER_KEY";
export const PANEL_MASTER_KEY_MIN_LENGTH = 16;

export const ACCESS_GATE_ERROR =
  "A valid panel access key is required. Ask the operator for one.";

/** Idempotent — upgrades predate the gate. */
export async function ensureAccessKeysTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS access_keys (
      id SERIAL PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix VARCHAR(16) NOT NULL,
      label VARCHAR(128),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      last_used_at TIMESTAMP,
      revoked_at TIMESTAMP
    )
  `);
}

/** Is the gate currently required? Env overrides win over the stored flag. */
export async function accessGateRequired(): Promise<boolean> {
  const forced = process.env[ACCESS_GATE_ENV];
  if (forced === "on") return true;
  if (forced === "off") return false;
  try {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, ACCESS_GATE_SETTING_KEY))
      .limit(1);
    return row?.value === "true";
  } catch {
    return false;
  }
}

/**
 * Does the presented key open the gate? Master-key env first (escape hatch),
 * then the database of active keys. A revoked or unknown key fails closed.
 */
export async function verifyAccessKey(presented: unknown): Promise<boolean> {
  const master = process.env[PANEL_MASTER_KEY_ENV];
  if (
    master &&
    master.length >= PANEL_MASTER_KEY_MIN_LENGTH &&
    typeof presented === "string" &&
    presented.trim().length >= PANEL_MASTER_KEY_MIN_LENGTH &&
    presented.trim() === master
  ) {
    return true;
  }

  const normalized = normalizeAccessKey(presented);
  if (!isValidAccessKeyFormat(normalized)) return false;

  try {
    await ensureAccessKeysTable();
    const [row] = await db
      .select({ id: accessKeys.id })
      .from(accessKeys)
      .where(and(eq(accessKeys.keyHash, hashAccessKey(normalized)), isNull(accessKeys.revokedAt)))
      .limit(1);
    if (!row) return false;
    await db
      .update(accessKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(accessKeys.id, row.id));
    return true;
  } catch {
    // Fresh install without the table: fail closed only matters when the gate
    // is required; callers check accessGateRequired() first.
    return false;
  }
}

/**
 * The single decision used by every entry point: when the gate is off,
 * everything passes; when it is on, only a valid key passes.
 */
export async function accessGatePassed(presented: unknown): Promise<boolean> {
  if (!(await accessGateRequired())) return true;
  return verifyAccessKey(presented);
}

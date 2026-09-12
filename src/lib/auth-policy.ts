/**
 * Operator-configurable authentication policy.
 *
 * Kept separate from `auth.ts` because that module is imported by the edge
 * runtime and by unit tests, and must not drag the database client along with
 * it. This module is only used from route handlers, which already have a
 * database connection.
 *
 * Values are cached briefly: registration and login are hot paths, and a
 * settings query on each would be wasteful. A save invalidates the cache, so
 * the delay only applies to changes made directly in the database.
 */

import { db } from "@/db";
import { settings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { applyAuthSettings } from "@/lib/auth";
import { AUSTRALIAN_MINIMUM_ACCOUNT_AGE } from "@/lib/age-verification";

export interface AuthPolicy {
  registrationEnabled: boolean;
  defaultMaxServers: number;
  loginThrottleAttempts: number;
  sessionDays: number;
  /** Whether registration demands a date of birth meeting the minimum age. */
  ageVerificationEnabled: boolean;
  /** Minimum age to hold an account (Australian statutory floor: 16). */
  minimumAccountAge: number;
}

const DEFAULTS: AuthPolicy = {
  registrationEnabled: true,
  defaultMaxServers: 5,
  // Must match panel-settings' display default: the settings page shows 5,
  // so enforcing 10 before the operator ever saves the form meant the panel
  // lied about its own lockout threshold (found in the Stage 46 debug pass).
  loginThrottleAttempts: 5,
  sessionDays: 7,
  ageVerificationEnabled: true,
  minimumAccountAge: AUSTRALIAN_MINIMUM_ACCOUNT_AGE,
};

const KEYS = [
  "registration_enabled",
  "default_max_servers",
  "login_throttle_attempts",
  "session_days",
  "age_verification_enabled",
  "minimum_account_age",
];

let cache: { value: AuthPolicy; at: number } | null = null;
const TTL_MS = 30_000;

export async function getAuthPolicy(): Promise<AuthPolicy> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;

  const value: AuthPolicy = { ...DEFAULTS };
  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, KEYS));

    for (const row of rows) {
      const raw = String(row.value ?? "");
      if (row.key === "registration_enabled") {
        value.registrationEnabled = raw !== "false";
        continue;
      }
      if (row.key === "age_verification_enabled") {
        value.ageVerificationEnabled = raw !== "false";
        continue;
      }
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) continue;
      if (row.key === "default_max_servers") value.defaultMaxServers = n;
      if (row.key === "login_throttle_attempts" && n > 0) value.loginThrottleAttempts = n;
      if (row.key === "session_days" && n > 0) value.sessionDays = n;
      // Never accept a stored value below the statutory floor, even if the
      // database was edited by hand.
      if (row.key === "minimum_account_age" && n >= AUSTRALIAN_MINIMUM_ACCOUNT_AGE) {
        value.minimumAccountAge = n;
      }
    }
  } catch {
    // No settings table yet (fresh install) — the defaults are correct.
  }

  // Push the two values auth.ts owns into it, so the throttle and session
  // length stay in step without auth.ts needing database access.
  applyAuthSettings({
    loginThrottleAttempts: value.loginThrottleAttempts,
    sessionDays: value.sessionDays,
  });

  cache = { value, at: now };
  return value;
}

/** Drop the cache so a save takes effect on the next request. */
export function invalidateAuthPolicy() {
  cache = null;
}

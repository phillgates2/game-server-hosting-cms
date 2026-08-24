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

export interface AuthPolicy {
  registrationEnabled: boolean;
  defaultMaxServers: number;
  loginThrottleAttempts: number;
  sessionDays: number;
}

const DEFAULTS: AuthPolicy = {
  registrationEnabled: true,
  defaultMaxServers: 5,
  loginThrottleAttempts: 10,
  sessionDays: 7,
};

const KEYS = [
  "registration_enabled",
  "default_max_servers",
  "login_throttle_attempts",
  "session_days",
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
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) continue;
      if (row.key === "default_max_servers") value.defaultMaxServers = n;
      if (row.key === "login_throttle_attempts" && n > 0) value.loginThrottleAttempts = n;
      if (row.key === "session_days" && n > 0) value.sessionDays = n;
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

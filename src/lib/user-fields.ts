/**
 * Validation for user-account fields edited by admins.
 *
 * The users PATCH route gated *who* may edit (permissions) but never *what*
 * the values may contain: an unknown role string landed straight in the JWT
 * claim, `maxServers` had no bounds, and emails/passwords had no shape at
 * all — a duplicate email surfaced as a raw 500.
 *
 * The UI offers exactly three roles and three statuses, so the allowlists
 * match what the panel can actually represent.
 */

export const USER_ROLES = ["user", "moderator", "admin"] as const;
export const USER_STATUSES = ["active", "suspended", "banned"] as const;

export const MAX_EMAIL_LENGTH = 255;
export const MAX_PROFILE_FIELD_LENGTH = 512;
export const MAX_SERVERS_LIMIT = 10_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldCheck<T> = { ok: true; value: T } | { ok: false; error: string };

/** Role strings are a JWT claim; only the three real ones are allowed. */
export function normalizeRole(raw: unknown): FieldCheck<string> {
  if (typeof raw !== "string" || !(USER_ROLES as readonly string[]).includes(raw)) {
    return { ok: false, error: `role must be one of: ${USER_ROLES.join(", ")}` };
  }
  return { ok: true, value: raw };
}

export function normalizeStatus(raw: unknown): FieldCheck<string> {
  if (typeof raw !== "string" || !(USER_STATUSES as readonly string[]).includes(raw)) {
    return { ok: false, error: `status must be one of: ${USER_STATUSES.join(", ")}` };
  }
  return { ok: true, value: raw };
}

/** 0 means unlimited, stored as NULL; anything sane counts as a limit. */
export function normalizeMaxServers(raw: unknown): FieldCheck<number | null> {
  if (raw === "" || raw === null || raw === undefined) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SERVERS_LIMIT) {
    return { ok: false, error: `maxServers must be a whole number between 0 and ${MAX_SERVERS_LIMIT}` };
  }
  return { ok: true, value: n === 0 ? null : n };
}

export function normalizeEmail(raw: unknown): FieldCheck<string> {
  const email = String(raw ?? "").trim();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return { ok: false, error: "A valid email address is required" };
  }
  return { ok: true, value: email };
}

/** Bound a free-text profile field; empty clears it. */
export function normalizeProfileText(raw: unknown, label: string, max = MAX_PROFILE_FIELD_LENGTH): FieldCheck<string | null> {
  const text = String(raw ?? "").trim();
  if (text.length > max) {
    return { ok: false, error: `${label} is limited to ${max} characters` };
  }
  return { ok: true, value: text || null };
}

export function checkPassword(raw: unknown): FieldCheck<string> {
  const password = String(raw ?? "");
  if (password.length < 8 || password.length > 256) {
    return { ok: false, error: "Password must be 8-256 characters" };
  }
  return { ok: true, value: password };
}

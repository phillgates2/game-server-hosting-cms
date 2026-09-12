/**
 * Licensing: this panel doubles as the LICENSE SERVER (the "master panel").
 * Admins issue GSM-LIC-… keys here; downstream installations must present a
 * valid one to install, validated against this server in real time.
 *
 * Security model:
 *   - Only the SHA-256 hash of a key is stored; plaintext is shown ONCE.
 *   - The public validate endpoint is rate-limited per IP and answers with
 *     the same generic shape either way (no key-existence oracle beyond
 *     the verdict itself, which a key holder is entitled to).
 *   - Activations are bound to a fingerprint (sha256 of hostname+url); a
 *     repeat validation from the same fingerprint is a re-check, not a new
 *     activation.
 */

export const LICENSE_KEY_PREFIX = "GSM-LIC";
export const LICENSE_KEY_GROUPS = 5;
export const LICENSE_KEY_GROUP_LEN = 5;
export const LICENSE_LABEL_MAX = 128;
export const LICENSE_MAX_ACTIVATIONS_CAP = 100;
/** One key per installation unless the operator says otherwise. */
export const LICENSE_DEFAULT_MAX_ACTIVATIONS = 1;

/** GSM-LIC-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX (hex groups). */
export function isValidLicenseKeyFormat(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const groups = `[0-9a-fA-F]{${LICENSE_KEY_GROUP_LEN}}`;
  const re = new RegExp(`^${LICENSE_KEY_PREFIX}-(${groups}-){${LICENSE_KEY_GROUPS - 1}}${groups}$`);
  return re.test(value.trim());
}

/** Display-safe prefix: GSM-LIC-XXXXX… (first key group only). */
export function licenseKeyDisplayLabel(key: string): string {
  const parts = key.trim().split("-");
  return parts.length >= 3 ? `${parts[0]}-${parts[1]}-${parts[2]}…` : key.slice(0, 12);
}

/** Generate a fresh key (crypto — dynamic import keeps this module test-safe). */
export async function generateLicenseKey(): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const bytes = randomBytes(Math.ceil((LICENSE_KEY_GROUPS * LICENSE_KEY_GROUP_LEN) / 2) + 1);
  const hex = bytes.toString("hex");
  const groups: string[] = [];
  for (let i = 0; i < LICENSE_KEY_GROUPS; i++) {
    groups.push(hex.slice(i * LICENSE_KEY_GROUP_LEN, (i + 1) * LICENSE_KEY_GROUP_LEN));
  }
  return `${LICENSE_KEY_PREFIX}-${groups.join("-")}`;
}

/** SHA-256 of the key — what the database stores and compares. */
export async function hashLicenseKey(key: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(key.trim().toLowerCase()).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export async function safeEqualHex(a: string, b: string): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Activation fingerprint: binds a key to one installation. */
export async function licenseFingerprint(hostname: string, panelUrl: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update(`${hostname.trim().toLowerCase()}|${panelUrl.trim().toLowerCase()}`)
    .digest("hex");
}

export type LicenseCheckCode = "ok" | "invalid" | "revoked" | "expired" | "limit-reached";

/**
 * Pure verdict from already-fetched facts. A same-fingerprint activation is
 * always allowed through (re-validation), even at the activation cap.
 */
export function decideLicenseCheck(input: {
  keyFound: boolean;
  revoked: boolean;
  expired: boolean;
  activeActivations: number;
  maxActivations: number;
  sameFingerprintActive: boolean;
}): LicenseCheckCode {
  if (!input.keyFound) return "invalid";
  if (input.revoked) return "revoked";
  if (input.expired) return "expired";
  if (input.sameFingerprintActive) return "ok";
  if (input.activeActivations >= input.maxActivations) return "limit-reached";
  return "ok";
}

/** Human messages shared by the API and the installer. */
export function licenseCheckMessage(code: LicenseCheckCode): string {
  switch (code) {
    case "ok":
      return "License key accepted.";
    case "revoked":
      return "That license key has been revoked. Contact the provider.";
    case "expired":
      return "That license key has expired. Contact the provider for a renewal.";
    case "limit-reached":
      return "That license key has reached its activation limit.";
    default:
      return "Invalid license key. Check it with the person who gave it to you.";
  }
}

/** Clamp requested max activations into 1..cap. */
export function clampMaxActivations(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return LICENSE_DEFAULT_MAX_ACTIVATIONS;
  return Math.min(n, LICENSE_MAX_ACTIVATIONS_CAP);
}

// ── Anonymous-endpoint rate limiting (pure, unit-tested) ────────────────────

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * Sliding-window counter. Mutates `state` (the caller owns the Map) and
 * returns true when `ip` has EXCEEDED the allowance for this window.
 * Failure attempts count too — brute force is the threat model.
 */
export function checkRateLimit(
  state: Map<string, RateLimitEntry>,
  ip: string,
  nowMs: number,
  windowMs: number,
  maxPerWindow: number
): boolean {
  const entry = state.get(ip);
  if (!entry || nowMs - entry.windowStart >= windowMs) {
    state.set(ip, { count: 1, windowStart: nowMs });
    // Opportunistic prune so the map can't grow unbounded.
    if (state.size > 5_000) {
      for (const [k, v] of state) {
        if (nowMs - v.windowStart >= windowMs) state.delete(k);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > maxPerWindow;
}

// ── DB helpers ──────────────────────────────────────────────────────────────

/** Idempotent — upgrades predate the tables. */
export async function ensureLicenseTables(): Promise<void> {
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS license_keys (
      id SERIAL PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix VARCHAR(20) NOT NULL,
      label VARCHAR(128),
      max_activations INTEGER NOT NULL DEFAULT 1,
      expires_at TIMESTAMP,
      revoked_at TIMESTAMP,
      expiry_notified_at TIMESTAMP,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS license_activations (
      id SERIAL PRIMARY KEY,
      key_id INTEGER NOT NULL REFERENCES license_keys(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      hostname TEXT,
      panel_url TEXT,
      ip_address VARCHAR(45),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  // Upgrades: pre-existing databases miss columns added by later stages.
  await db.execute(sql`ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMP`);
}

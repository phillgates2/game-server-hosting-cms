/**
 * Panel access keys — the CD-key style gate.
 *
 * When the gate is enabled, nobody can log in or register without a key the
 * operator handed them. Keys look like GSM-XXXX-XXXX-XXXX-XXXX; only their
 * SHA-256 hash is stored, exactly like API keys.
 *
 * Pure helpers only; the DB-touching gate decision lives in access-gate.ts.
 */

import { createHash, randomBytes } from "node:crypto";

/** Unambiguous alphabet: no I/L/O/0/1 so keys survive being read aloud. */
export const ACCESS_KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ACCESS_KEY_GROUPS = 4;
export const ACCESS_KEY_GROUP_LENGTH = 4;
export const ACCESS_KEY_PREFIX_LABEL = "GSM";
export const ACCESS_KEY_BODY_LENGTH = ACCESS_KEY_GROUPS * ACCESS_KEY_GROUP_LENGTH;

export const ACCESS_GATE_SETTING_KEY = "accessGateEnabled";

/**
 * Strip whitespace/dashes, upper-case, and drop the display prefix so that
 * "GSM-ABCD-…" and the bare 16-char body verify identically.
 */
export function normalizeAccessKey(input: unknown): string {
  if (typeof input !== "string") return "";
  let out = input.replace(/[\s-]/g, "").toUpperCase();
  if (out.startsWith(ACCESS_KEY_PREFIX_LABEL) && out.length === ACCESS_KEY_PREFIX_LABEL.length + ACCESS_KEY_BODY_LENGTH) {
    out = out.slice(ACCESS_KEY_PREFIX_LABEL.length);
  }
  return out;
}

/** True when the normalised value is exactly 16 alphabet characters. */
export function isValidAccessKeyFormat(normalized: string): boolean {
  if (normalized.length !== ACCESS_KEY_BODY_LENGTH) return false;
  for (const ch of normalized) {
    if (!ACCESS_KEY_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** SHA-256 hex of the normalised key. */
export function hashAccessKey(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

/** Format a 16-char body as GSM-XXXX-XXXX-XXXX-XXXX. */
export function formatAccessKey(body: string): string {
  const groups: string[] = [];
  for (let i = 0; i < ACCESS_KEY_BODY_LENGTH; i += ACCESS_KEY_GROUP_LENGTH) {
    groups.push(body.slice(i, i + ACCESS_KEY_GROUP_LENGTH));
  }
  return `${ACCESS_KEY_PREFIX_LABEL}-${groups.join("-")}`;
}

/** Display prefix shown in the key list ("GSM-ABCD"). */
export function accessKeyPrefix(formattedKey: string): string {
  return formattedKey.slice(0, ACCESS_KEY_PREFIX_LABEL.length + 1 + ACCESS_KEY_GROUP_LENGTH);
}

/** Generate a fresh key: formatted plaintext (shown once) + stored hash. */
export function generateAccessKey(): { key: string; hash: string; prefix: string } {
  // Rejection sampling (248 = 31 * 8) keeps the alphabet uniform — no modulo
  // bias toward the first characters.
  const limit = Math.floor(256 / ACCESS_KEY_ALPHABET.length) * ACCESS_KEY_ALPHABET.length;
  let body = "";
  while (body.length < ACCESS_KEY_BODY_LENGTH) {
    for (const byte of randomBytes(ACCESS_KEY_BODY_LENGTH * 2)) {
      if (body.length >= ACCESS_KEY_BODY_LENGTH) break;
      if (byte >= limit) continue;
      body += ACCESS_KEY_ALPHABET[byte % ACCESS_KEY_ALPHABET.length];
    }
  }
  const key = formatAccessKey(body);
  return { key, hash: hashAccessKey(body), prefix: accessKeyPrefix(key) };
}

/** Bounds-check a label for key creation. */
export const ACCESS_KEY_LABEL_MAX = 128;
export function normalizeAccessKeyLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, ACCESS_KEY_LABEL_MAX);
}

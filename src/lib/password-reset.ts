/**
 * Password-reset tokens.
 *
 * Forgot-password was missing entirely: a lost password meant an admin
 * editing the database by hand. This module is the pure half of the flow —
 * token generation, hashing and expiry — so the security-relevant decisions
 * are unit-tested. The routes (api/auth/forgot-password, api/auth/reset-
 * password) own the database and email side.
 *
 * The raw token exists only in the email; the database stores its SHA-256
 * hash, so a database leak cannot be spent resetting anyone's password.
 */

import { randomBytes, createHash } from "node:crypto";

/** 256 bits: unguessable even against an attacker who knows the flow. */
export const RESET_TOKEN_BYTES = 32;

/** Reset links die after an hour. */
export const RESET_TTL_MS = 60 * 60_000;

/** Exactly the shape both routes accept — nothing else reaches the DB. */
export const RESET_TOKEN_RE = /^[a-f0-9]{64}$/;

export function isValidResetToken(token: unknown): token is string {
  return typeof token === "string" && RESET_TOKEN_RE.test(token);
}

/** SHA-256 hex of a token — the only form ever stored. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a fresh token pair: the raw value (for the email link) and its
 * hash (for the database row).
 */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(RESET_TOKEN_BYTES).toString("hex");
  return { token, tokenHash: hashResetToken(token) };
}

/** The expiry timestamp for a link created now. */
export function resetExpiry(now: Date = new Date(), ttlMs: number = RESET_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs);
}

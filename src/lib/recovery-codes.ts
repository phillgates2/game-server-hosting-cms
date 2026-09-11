/**
 * One-time 2FA recovery codes.
 *
 * A lost phone must not mean a locked-out admin. Enabling 2FA mints a small
 * batch of single-use codes; each login may present either a TOTP code or one
 * recovery code, and a spent code is deleted from the stored set.
 *
 * Only SHA-256 hashes are stored: a database leak reveals no usable codes.
 * The flow mirrors the password-reset design for the same reason.
 */

import { randomBytes, createHash } from "node:crypto";

export const RECOVERY_CODE_COUNT = 8;

/** Unambiguous alphabet — no i/l/o/0/1 to misread from a printout. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Strip formatting and case so "ABCD-EFGH" and "abcdefgh" both work. */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/**
 * Mint a batch of codes plus their hashes. 80 random bits each; the readable
 * shape is five chars, a dash, five chars.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): {
  codes: string[];
  hashes: string[];
} {
  const codes: string[] = [];
  const hashes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < count) {
    const bytes = randomBytes(10);
    let raw = "";
    for (let j = 0; j < 10; j++) {
      raw += CODE_ALPHABET[(bytes[j] as number) % CODE_ALPHABET.length];
    }
    if (seen.has(raw)) continue; // never mint a duplicate
    seen.add(raw);
    const code = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    codes.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { codes, hashes };
}

/**
 * Spend one code. Pure: given the stored hashes and the presented code,
 * report whether it matches and hand back the hash list WITHOUT it, so the
 * caller persists the consumed state. A non-match returns the list intact.
 */
export function consumeRecoveryCode(
  storedHashes: readonly string[],
  input: string
): { match: boolean; remaining: string[] } {
  const h = hashRecoveryCode(input);
  const idx = storedHashes.indexOf(h);
  if (idx === -1) return { match: false, remaining: [...storedHashes] };
  const remaining = storedHashes.filter((_, i) => i !== idx);
  return { match: true, remaining };
}

/**
 * Distinguish a recovery code from a TOTP attempt without revealing which.
 * A TOTP is exactly 6 digits; a recovery code normalises to 10 alphanumerics.
 */
export function isLikelyRecoveryCode(input: string): boolean {
  return normalizeRecoveryCode(input).length === 10;
}

/**
 * Authenticated encryption for the few secrets the panel must give *back* to
 * their owner.
 *
 * Password hashes (bcrypt) are the right storage for anything only ever
 * compared — a login, a recovery code. They are the wrong storage for an FTP
 * password: operators expect to read it out of the panel whenever they set up
 * a client, and "shown once at creation" for a credential people paste into
 * FileZilla two weeks later is a support ticket generator.
 *
 * So transfer passwords are encrypted with AES-256-GCM under a key derived
 * from the panel's own secret material:
 *
 *   - `GSM_FILE_TRANSFER_SECRET` when set (lets an operator rotate the
 *     transfer passwords independently of everything else),
 *   - otherwise `JWT_SECRET`, which every production install already has and
 *     which is already the panel's root of trust,
 *   - otherwise, in development only, a random per-process key: passwords stop
 *     decrypting on restart, which is exactly the safe way to fail (the panel
 *     then asks for a rotation instead of silently refusing logins).
 *
 * The payload is versioned (`v1.iv.tag.ciphertext`, all base64) so a future
 * algorithm change can be detected rather than misparsed.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
/** Separate derivation context so this key can never collide with another use. */
const HKDF_INFO = "gsm-file-transfer-credential";
const HKDF_SALT = "gsm-secret-box-v1";

let cachedKey: Buffer | null = null;
let warnedAboutDevKey = false;

/** Derive the 32-byte AES key from the panel's secret material. */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const dedicated = (process.env.GSM_FILE_TRANSFER_SECRET ?? "").trim();
  const jwt = (process.env.JWT_SECRET ?? "").trim();
  const material = dedicated.length >= 16 ? dedicated : jwt.length >= 32 ? jwt : null;

  if (material) {
    cachedKey = Buffer.from(hkdfSync("sha256", material, HKDF_SALT, HKDF_INFO, 32));
    return cachedKey;
  }

  if (!warnedAboutDevKey) {
    warnedAboutDevKey = true;
    console.warn(
      "[secret-box] no GSM_FILE_TRANSFER_SECRET or JWT_SECRET — using a per-process key. " +
        "Stored transfer passwords will not survive a restart in this environment."
    );
  }
  cachedKey = randomBytes(32);
  return cachedKey;
}

/** True when a durable key exists (production always has one via JWT_SECRET). */
export function secretBoxDurable(): boolean {
  const dedicated = (process.env.GSM_FILE_TRANSFER_SECRET ?? "").trim();
  const jwt = (process.env.JWT_SECRET ?? "").trim();
  return dedicated.length >= 16 || jwt.length >= 32;
}

/** Encrypt a secret → `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Decrypt a stored secret.
 *
 * Returns null for anything unreadable — a rotated panel secret, a truncated
 * row, a payload from a future version. Callers must treat null as "ask the
 * user to rotate", never as "the password is empty".
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (typeof payload !== "string") return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Constant-time comparison of a presented secret against the stored one.
 *
 * Both sides are hashed first so the comparison is over fixed-length buffers
 * regardless of input length — `timingSafeEqual` throws on a length mismatch,
 * which would itself leak the stored password's length.
 */
export function secretsMatch(presented: string, stored: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(stored, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * Generate a transfer password: 24 characters of base58.
 *
 * Base58 avoids the `0/O` and `1/l/I` pairs that get mistyped when somebody
 * reads a password off the panel and types it into WinSCP. 24 characters is
 * ~140 bits — far beyond brute-force reach for an internet-exposed port.
 */
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const TRANSFER_PASSWORD_LENGTH = 24;

export function generateTransferPassword(): string {
  // Rejection sampling keeps the distribution uniform: 256 is not a multiple
  // of 58, so the tail values are simply skipped rather than folded in.
  const out: string[] = [];
  while (out.length < TRANSFER_PASSWORD_LENGTH) {
    for (const byte of randomBytes(TRANSFER_PASSWORD_LENGTH)) {
      if (byte >= 232) continue;
      out.push(BASE58[byte % BASE58.length]);
      if (out.length === TRANSFER_PASSWORD_LENGTH) break;
    }
  }
  return out.join("");
}

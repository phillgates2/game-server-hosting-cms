import { createHash } from "node:crypto";

/**
 * Pure helpers for API key handling.
 *
 * Kept separate from api-key-auth.ts because that module imports the database
 * client at load time; parsing and hashing need neither a connection nor any
 * environment configuration.
 */

/** Hash an API key for storage/lookup. Must match the key generator. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Pull a `gsm_`-prefixed key out of the Authorization header. */
export function getApiKeyFromHeaders(headers: Headers): string | null {
  const header = headers.get("authorization");
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  const token = match[1];
  // Only treat it as an API key if it looks like one; a Bearer JWT is handled
  // by the session path instead.
  return token.startsWith("gsm_") ? token : null;
}

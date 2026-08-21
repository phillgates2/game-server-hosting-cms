import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getApiKeyFromHeaders, hashApiKey } from "./api-key";

export { getApiKeyFromHeaders, hashApiKey };

/**
 * Authenticate a request that carries an API key.
 *
 * The API Keys panel tells users to send `Authorization: Bearer gsm_...`, and
 * keys were generated, hashed and stored - but nothing on the server ever read
 * that header, so every documented integration silently failed with a 401.
 * This closes that loop.
 *
 * Keys are stored as a SHA-256 hash. That is appropriate here (unlike user
 * passwords, which use bcrypt): an API key is 32 bytes of CSPRNG output, so it
 * has no dictionary to attack and does not need a slow KDF - and the lookup is
 * on the hot path for every API request.
 */

/** Constant-time comparison of two hex digests of equal length. */
function digestsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

export interface ApiKeyIdentity {
  userId: number;
  role: string;
  /** Per-key permission overrides, when the key was created with them. */
  permissions: Record<string, boolean> | null;
  keyId: number;
}

/**
 * Resolve an API key to its owning user.
 *
 * Returns null when the header is absent, the key is unknown, it has expired,
 * or the owning account is not active. `lastUsedAt` is updated as a side
 * effect so the panel can show which keys are live.
 */
export async function authenticateApiKey(headers: Headers): Promise<ApiKeyIdentity | null> {
  const raw = getApiKeyFromHeaders(headers);
  if (!raw) return null;

  const prefix = raw.slice(0, 11);
  const digest = hashApiKey(raw);

  // Narrow by the indexed prefix, then compare the full digest in constant
  // time. The prefix is not a secret - it is displayed in the UI.
  const candidates = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      keyHash: apiKeys.keyHash,
      permissions: apiKeys.permissions,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix))
    .limit(20);

  const now = Date.now();
  for (const candidate of candidates) {
    if (!digestsMatch(candidate.keyHash, digest)) continue;
    if (candidate.expiresAt && candidate.expiresAt.getTime() < now) return null;

    const [owner] = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, candidate.userId))
      .limit(1);

    // A suspended or banned owner must not keep working keys.
    if (!owner || owner.status !== "active") return null;

    // Best effort: never fail a request because the timestamp write failed.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, candidate.id))
      .catch(() => {});

    return {
      userId: owner.id,
      role: owner.role,
      permissions: (candidate.permissions as Record<string, boolean> | null) ?? null,
      keyId: candidate.id,
    };
  }

  return null;
}

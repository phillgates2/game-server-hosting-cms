/**
 * Tracked sessions: every cookie login gets a row keyed by the SHA-256 of
 * the token (the raw token never touches the table). getCurrentUser checks
 * the row on every authenticated request, so revocation is instant.
 *
 * Availability rule: session tracking is defense-in-depth. If the database
 * is unreachable the check fails OPEN (the JWT itself is still verified) —
 * the panel must not go down because an auxiliary table is slow. Revocation
 * obviously needs the db to work to matter.
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { authSessions } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export const SESSION_LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

const lastSeenWrites = new Map<string, number>();

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function ensureSessionsTable(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id SERIAL PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) NOT NULL,
      ip_address VARCHAR(45),
      user_agent VARCHAR(256),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      last_seen_at TIMESTAMP DEFAULT NOW() NOT NULL,
      revoked_at TIMESTAMP
    )
  `);
}

/** Record a fresh login. Duplicate tokens are ignored silently. */
export async function registerSession(
  token: string,
  info: { userId: number; ip: string | null; userAgent: string | null }
): Promise<void> {
  try {
    await ensureSessionsTable();
    await db
      .insert(authSessions)
      .values({
        tokenHash: hashSessionToken(token),
        userId: info.userId,
        ipAddress: info.ip?.slice(0, 45) ?? null,
        userAgent: info.userAgent?.slice(0, 256) ?? null,
      })
      .onConflictDoNothing();
  } catch {
    /* tracking must never break a login */
  }
}

export interface SessionCheck {
  ok: boolean;
  userId?: number;
}

/**
 * Verify a cookie token against the session table. Unknown-but-valid JWTs
 * (issued before tracking existed) are registered on first sight so upgrades
 * log nobody out.
 */
export async function checkSession(token: string): Promise<SessionCheck> {
  try {
    await ensureSessionsTable();
    const hash = hashSessionToken(token);
    const [row] = await db
      .select({ id: authSessions.id, userId: authSessions.userId, revokedAt: authSessions.revokedAt })
      .from(authSessions)
      .where(eq(authSessions.tokenHash, hash))
      .limit(1);

    if (!row) {
      // Legacy session: adopt it instead of logging the user out.
      return { ok: true, userId: undefined };
    }
    if (row.revokedAt !== null) return { ok: false };

    const now = Date.now();
    const last = lastSeenWrites.get(hash) ?? 0;
    if (now - last >= SESSION_LAST_SEEN_WRITE_INTERVAL_MS) {
      lastSeenWrites.set(hash, now);
      await db
        .update(authSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(authSessions.id, row.id));
    }
    return { ok: true, userId: row.userId };
  } catch {
    return { ok: true }; // fail open: tracking is defense-in-depth
  }
}

/** Revoke by token (logout). */
export async function revokeSessionByToken(token: string): Promise<void> {
  try {
    await ensureSessionsTable();
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.tokenHash, hashSessionToken(token)), isNull(authSessions.revokedAt)));
  } catch {
    /* best-effort */
  }
}

export interface SessionRow {
  id: number;
  userId: number;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  current: boolean;
}

/** Active sessions for a user, newest first. */
export async function listSessions(userId: number, currentToken: string | null): Promise<SessionRow[]> {
  await ensureSessionsTable();
  const rows = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .orderBy(desc(authSessions.createdAt))
    .limit(50);
  const currentHash = currentToken ? hashSessionToken(currentToken) : null;
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    current: currentHash !== null && r.tokenHash === currentHash,
  }));
}

/** Revoke one session row, enforcing ownership unless admin. */
export async function revokeSessionById(id: number, requesterId: number, isAdmin: boolean): Promise<boolean> {
  await ensureSessionsTable();
  const [row] = await db
    .select({ id: authSessions.id, userId: authSessions.userId, revokedAt: authSessions.revokedAt })
    .from(authSessions)
    .where(eq(authSessions.id, id))
    .limit(1);
  if (!row || row.revokedAt !== null) return false;
  if (!isAdmin && row.userId !== requesterId) return false;
  await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, id));
  return true;
}

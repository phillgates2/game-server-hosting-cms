import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

/**
 * Resolve the JWT signing secret.
 *
 * Falling back to a hardcoded constant means any deployment that forgets to set
 * JWT_SECRET signs tokens with a value that is public in the source tree —
 * anyone can then mint an admin session. Production therefore refuses to start
 * without a real secret.
 *
 * Development falls back to a per-process random secret: sessions do not
 * survive a restart, which is the safe way to fail.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;

  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      fromEnv
        ? "JWT_SECRET must be at least 32 characters."
        : "JWT_SECRET is required in production. Generate one with: openssl rand -hex 32"
    );
  }

  if (fromEnv) {
    console.warn("[auth] JWT_SECRET is shorter than 32 characters — using it anyway in development.");
    return fromEnv;
  }

  console.warn("[auth] JWT_SECRET is not set — using a random development secret. Sessions reset on restart.");
  return randomBytes(32).toString("hex");
}

const JWT_SECRET = resolveJwtSecret();

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(payload: { userId: number; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
  } catch {
    return null;
  }
}

export function getTokenFromHeaders(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.match(/gsm_token=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Identify the caller, from either a session cookie or an API key.
 *
 * The session cookie is checked first because it is the common case and costs
 * nothing. Failing that, an `Authorization: Bearer gsm_...` header is resolved
 * against the api_keys table - the panel has always told users to send that
 * header, but nothing read it until now.
 */
export async function getCurrentUser(
  headers: Headers
): Promise<{ userId: number; role: string } | null> {
  const { setAuthContext } = await import("./request-context");

  const token = getTokenFromHeaders(headers);
  if (token) {
    const session = verifyToken(token);
    if (session) {
      // A cookie session carries no key scope. Setting it explicitly (rather
      // than leaving the store untouched) prevents a scope from a previous
      // request ever bleeding into this one.
      setAuthContext({ keyPermissions: null, keyId: null });
      return session;
    }
  }

  // Imported lazily: the API-key path touches the database, and pulling that
  // in at module load would drag the db client into every consumer of auth.ts.
  const { authenticateApiKey } = await import("./api-key-auth");
  const viaKey = await authenticateApiKey(headers);
  if (!viaKey) {
    setAuthContext({ keyPermissions: null, keyId: null });
    return null;
  }
  setAuthContext({ keyPermissions: viaKey.permissions, keyId: viaKey.keyId });
  return { userId: viaKey.userId, role: viaKey.role };
}

// Cookie options — secure only when behind HTTPS (detected via x-forwarded-proto)
export function getCookieOptions(headers?: Headers) {
  // Check if request is coming through HTTPS (via reverse proxy or direct)
  const proto = headers?.get("x-forwarded-proto");
  const isHttps = proto === "https";

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
}

// ── Login throttling ─────────────────────────────────────────────────────────
//
// Without this, an attacker gets unlimited password and TOTP guesses. The
// counter is per-process, which is enough for the single-node deployments this
// panel targets; a multi-instance setup should move it to the database.

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

function pruneLoginAttempts(now: number) {
  for (const [key, entry] of loginAttempts) {
    if (now - entry.firstAttempt > LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
}

/** Seconds the caller must wait, or 0 when another attempt is allowed. */
export function loginRetryAfter(key: string): number {
  const now = Date.now();
  pruneLoginAttempts(now);

  const entry = loginAttempts.get(key);
  if (!entry || entry.count < MAX_LOGIN_ATTEMPTS) return 0;

  const elapsed = now - entry.firstAttempt;
  if (elapsed > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return 0;
  }
  return Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000);
}

export function recordFailedLogin(key: string) {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || now - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
    return;
  }
  entry.count += 1;
}

export function clearFailedLogins(key: string) {
  loginAttempts.delete(key);
}

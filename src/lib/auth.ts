import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "gsm-panel-secret-change-me-in-production";

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

export async function getCurrentUser(headers: Headers) {
  const token = getTokenFromHeaders(headers);
  if (!token) return null;
  return verifyToken(token);
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

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  hashPassword,
  createToken,
  getCookieOptions,
  loginRetryAfter,
  recordFailedLogin,
} from "@/lib/auth";
import { apiError } from "@/lib/api-error";
import { eq, or } from "drizzle-orm";

// Mirrors the column widths in src/db/schema.ts. Without these the database
// raises a length error and the route answers 500 for what is really a 400.
const MAX_USERNAME = 64;
const MAX_EMAIL = 255;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200; // bcrypt only reads the first 72 bytes; cap the work anyway.

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,64}$/;
// Deliberately permissive: full RFC 5322 validation is not worth the
// false negatives, we only reject the obviously malformed.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  try {
    // Registration creates rows and runs bcrypt, so it needs the same
    // brute-force/abuse protection as login.
    const ip = clientIp(req);
    const throttleKey = `register:${ip}`;
    const retryAfter = loginRetryAfter(throttleKey);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: `Too many registration attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { username, email, password } = (body ?? {}) as Record<string, unknown>;

    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const uname = username.trim();
    const mail = email.trim().toLowerCase();

    if (!USERNAME_RE.test(uname)) {
      return NextResponse.json(
        { error: "Username must be 3-64 characters and may contain letters, numbers, dot, dash and underscore only" },
        { status: 400 }
      );
    }
    if (mail.length > MAX_EMAIL || !EMAIL_RE.test(mail)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD} characters` },
        { status: 400 }
      );
    }
    if (password.length > MAX_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be at most ${MAX_PASSWORD} characters` },
        { status: 400 }
      );
    }
    if (uname.length > MAX_USERNAME) {
      return NextResponse.json({ error: "Username is too long" }, { status: 400 });
    }

    // One query instead of two round-trips.
    const existing = await db
      .select({ id: users.id, username: users.username, email: users.email })
      .from(users)
      .where(or(eq(users.username, uname), eq(users.email, mail)))
      .limit(1);

    if (existing.length > 0) {
      recordFailedLogin(throttleKey);
      const clash = existing[0].username === uname ? "Username" : "Email";
      return NextResponse.json({ error: `${clash} already exists` }, { status: 409 });
    }

    // First account to exist becomes the administrator.
    const anyUser = await db.select({ id: users.id }).from(users).limit(1);
    const role = anyUser.length === 0 ? "admin" : "user";

    const passwordHash = await hashPassword(password);

    let created;
    try {
      [created] = await db
        .insert(users)
        .values({ username: uname, email: mail, passwordHash, role })
        .returning({ id: users.id, role: users.role, username: users.username });
    } catch (e: unknown) {
      // Unique violation: another request registered the same name between the
      // check above and this insert.
      const code = (e as { code?: string })?.code;
      if (code === "23505") {
        return NextResponse.json({ error: "Username or email already exists" }, { status: 409 });
      }
      throw e;
    }

    const token = createToken({ userId: created.id, role: created.role });

    const res = NextResponse.json({
      ok: true,
      user: { id: created.id, username: created.username, role: created.role },
    });
    res.cookies.set("gsm_token", token, getCookieOptions(req.headers));
    return res;
  } catch (e: unknown) {
    return apiError(e, "Registration failed", 500);
  }
}

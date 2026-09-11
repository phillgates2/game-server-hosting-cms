import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, passwordResets } from "@/db/schema";
import { eq, or, sql, and, isNull } from "drizzle-orm";
import { loginRetryAfter, recordFailedLogin } from "@/lib/auth";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email";
import { generateResetToken, resetExpiry } from "@/lib/password-reset";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_OK = {
  ok: true,
  message: "If an account matches that username or email, a reset link has been sent.",
};

async function ensurePasswordResetsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// POST /api/auth/forgot-password — email a one-time reset link
export async function POST(req: NextRequest) {
  try {
    // Password probing is credential guessing by another name: same
    // per-address throttle as login and registration.
    const ip = clientIp(req);
    const throttleKey = `reset:${ip}`;
    const retryAfter = loginRetryAfter(throttleKey);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: `Too many reset requests. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    if (!isEmailConfigured()) {
      // Honest failure beats a fake "email sent": without SMTP there is no
      // link to send, and the operator needs to know why users are stuck.
      return NextResponse.json(
        { error: "Email is not configured on this panel. Contact an administrator to reset your password." },
        { status: 503 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { identifier } = (body ?? {}) as Record<string, unknown>;
    if (typeof identifier !== "string" || identifier.trim().length === 0 || identifier.trim().length > 255) {
      // Deliberately the same shape as the success answer below: a malformed
      // request must not reveal that no account matched either.
      recordFailedLogin(throttleKey);
      return NextResponse.json(GENERIC_OK);
    }

    const needle = identifier.trim();
    const needleLower = needle.toLowerCase();

    const matches = await db
      .select({ id: users.id, username: users.username, email: users.email, status: users.status })
      .from(users)
      .where(or(eq(users.username, needle), sql`LOWER(${users.email}) = ${needleLower}`))
      .limit(1);

    if (matches.length === 0 || matches[0].status !== "active") {
      // Same answer as success — the response must not reveal which
      // usernames and emails exist on this panel.
      recordFailedLogin(throttleKey);
      return NextResponse.json(GENERIC_OK);
    }

    const user = matches[0];
    await ensurePasswordResetsTable();

    // One live link per account: retire any unspent link before minting a
    // new one, so an old email sitting in an inbox cannot race the new one.
    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(and(isNull(passwordResets.usedAt), eq(passwordResets.userId, user.id)));

    const { token, tokenHash } = generateResetToken();
    await db
      .insert(passwordResets)
      .values({ userId: user.id, tokenHash, expiresAt: resetExpiry() });

    const link = `${req.nextUrl.origin}/?reset=${token}`;
    await sendPasswordResetEmail(user.email, user.username, link);

    return NextResponse.json(GENERIC_OK);
  } catch (e: unknown) {
    return apiError(e, "Could not process the reset request", 500);
  }
}

import { clientIpForRecord } from "@/lib/ip-allowlist";
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
import { eq, or, sql } from "drizzle-orm";

/**
 * Upgrades from before age verification exist have no date_of_birth column.
 * Added lazily here (the same pattern the profile route uses for
 * theme_config) rather than requiring a manual migration step.
 */
async function ensureAgeVerificationColumns() {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS age_verified_at TIMESTAMP`);
}

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
  // Stage 46: shared trust-aware extraction — forwarded headers are honoured
  // only behind GSM_TRUST_PROXY, and via the proxy-appended LAST hop.
  return clientIpForRecord(req.headers);
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

    // Self-registration can be turned off from the Settings panel, so a panel
    // can be locked down to admin-created accounts only.
    const { getAuthPolicy } = await import("@/lib/auth-policy");
    const policy = await getAuthPolicy();
    if (!policy.registrationEnabled) {
      return NextResponse.json(
        { error: "Registration is disabled. Contact an administrator for an account." },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { username, email, password, dateOfBirth } = (body ?? {}) as Record<string, unknown>;

    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    // ── Age verification ────────────────────────────────────────────────────
    // Australian law (Online Safety Amendment (Social Media Minimum Age)
    // Act 2024) bars people under 16 from holding accounts on platforms
    // with community features. When the gate is on, a valid date of birth
    // proving the minimum age is mandatory; it is stored on the account so
    // the declaration can be audited.
    const { checkMinimumAge } = await import("@/lib/age-verification");
    let verifiedDob: string | null = null;
    if (policy.ageVerificationEnabled) {
      const check = checkMinimumAge(dateOfBirth, policy.minimumAccountAge);
      if (!check.ok) {
        if (check.reason === "under-age") recordFailedLogin(throttleKey);
        return NextResponse.json(
          { error: check.error || "Age verification failed" },
          { status: check.reason === "under-age" ? 403 : 400 }
        );
      }
      // Store the exact ISO date the client submitted.
      verifiedDob = typeof dateOfBirth === "string" ? dateOfBirth.trim() : null;
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

    await ensureAgeVerificationColumns();

    let created;
    try {
      [created] = await db
        .insert(users)
        .values({
          username: uname,
          email: mail,
          passwordHash,
          role,
          // 0 in the settings panel means unlimited, which the column
          // represents as NULL.
          maxServers: policy.defaultMaxServers > 0 ? policy.defaultMaxServers : null,
          dateOfBirth: verifiedDob,
          ageVerifiedAt: verifiedDob ? new Date() : null,
        })
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

    // Best-effort welcome email. SMTP may not be configured and a mail
    // hiccup must never fail a signup that already succeeded.
    const { sendWelcomeEmail } = await import("@/lib/email");
    void sendWelcomeEmail(mail, uname).catch(() => {});

    const token = createToken({ userId: created.id, role: created.role });

    const res = NextResponse.json({
      ok: true,
      user: { id: created.id, username: created.username, role: created.role },
    });
    res.cookies.set("gsm_token", token, getCookieOptions(req.headers));
    const { trackIssuedSession } = await import("@/lib/auth");
    await trackIssuedSession(token, req.headers);
    return res;
  } catch (e: unknown) {
    return apiError(e, "Registration failed", 500);
  }
}

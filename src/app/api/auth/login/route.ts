import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  verifyPassword,
  createToken,
  getCookieOptions,
  loginRetryAfter,
  recordFailedLogin,
  clearFailedLogins,
} from "@/lib/auth";
import { getUserPermissions } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { eq, sql } from "drizzle-orm";
import * as OTPAuth from "otpauth";

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  // License lockout: a panel whose license was explicitly rejected (or whose
  // grace window ran out) refuses NEW logins. Existing data is untouched and
  // the recovery path is GSM_LICENSE_MODE=master on a box you own.
  try {
    const { currentLicenseState } = await import("@/lib/license-heartbeat");
    const license = await currentLicenseState();
    if (license.state === "locked") {
      return NextResponse.json(
        { error: `This panel's license is invalid${license.code ? ` (${license.code})` : ""} — logins are blocked. Renew the key with your provider.${license.message ? ` ${license.message}` : ""}` },
        { status: 402 }
      );
    }
  } catch {
    /* licensing checks must never brick authentication */
  }

  try {
    const body = await req.json();
    const username = (body.username || "").trim();
    const password = body.password || "";

    // Stage 42: the CD-key panel gate is gone — login is username+password
    // (plus 2FA/session/IP gates). The only remaining key is the install-time
    // master key.
    const twoFactorCode = body.twoFactorCode ? String(body.twoFactorCode).trim() : "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const ip = clientIp(req);
    const throttleKey = `${ip}:${username.toLowerCase()}`;

    const retryAfter = loginRetryAfter(throttleKey);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      recordFailedLogin(throttleKey);
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (user.status === "suspended") {
      return NextResponse.json({ error: "Account suspended. Contact an administrator." }, { status: 403 });
    }
    if (user.status === "banned") {
      return NextResponse.json({ error: "Account banned." }, { status: 403 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordFailedLogin(throttleKey);
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Second factor. Previously the panel stored a TOTP secret and let users
    // "enable" 2FA, but login never checked it — a password alone was enough.
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      if (!twoFactorCode) {
        // Not a failed attempt: the client simply has to prompt for the code.
        return NextResponse.json(
          { twoFactorRequired: true, error: "Two-factor code required" },
          { status: 401 }
        );
      }

      const totp = new OTPAuth.TOTP({
        secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret),
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });

      if (totp.validate({ token: twoFactorCode, window: 1 }) === null) {
        // Not a TOTP — try a single-use recovery code. The consumed code is
        // deleted immediately; a spent code can never open the account again.
        const { isLikelyRecoveryCode, consumeRecoveryCode } = await import("@/lib/recovery-codes");
        let recovered = false;
        if (isLikelyRecoveryCode(twoFactorCode)) {
          const stored = user.twoFactorRecovery
            ? (JSON.parse(user.twoFactorRecovery) as string[])
            : [];
          const result = consumeRecoveryCode(stored, twoFactorCode);
          if (result.match) {
            await db
              .update(users)
              .set({ twoFactorRecovery: JSON.stringify(result.remaining), updatedAt: new Date() })
              .where(eq(users.id, user.id));
            recovered = true;
          }
        }
        if (!recovered) {
          recordFailedLogin(throttleKey);
          return NextResponse.json(
            { twoFactorRequired: true, error: "Invalid two-factor code" },
            { status: 401 }
          );
        }
      }
    }

    clearFailedLogins(throttleKey);

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        lastLoginIp: ip,
        loginCount: sql`COALESCE(login_count, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const token = createToken({ userId: user.id, role: user.role });
    const permissions = await getUserPermissions(user.id);

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
      permissions,
    });
    res.cookies.set("gsm_token", token, getCookieOptions(req.headers));
    const { trackIssuedSession } = await import("@/lib/auth");
    await trackIssuedSession(token, req.headers);
    return res;
  } catch (e: unknown) {
    return apiError(e, "Login failed");
  }
}

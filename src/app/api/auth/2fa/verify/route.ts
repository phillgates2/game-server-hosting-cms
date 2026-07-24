import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";

// POST /api/auth/2fa/verify — Verify TOTP code and enable 2FA
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { code, action } = await req.json(); // action: "enable" | "disable"

    const [user] = await db
      .select({ twoFactorSecret: users.twoFactorSecret, twoFactorEnabled: users.twoFactorEnabled })
      .from(users).where(eq(users.id, auth.userId)).limit(1);

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (action === "enable") {
      if (!user.twoFactorSecret) return NextResponse.json({ error: "Run setup first" }, { status: 400 });

      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret), algorithm: "SHA1", digits: 6, period: 30 });
      const delta = totp.validate({ token: String(code), window: 1 });

      if (delta === null) return NextResponse.json({ error: "Invalid code. Try again." }, { status: 400 });

      await db.update(users).set({ twoFactorEnabled: true, updatedAt: new Date() }).where(eq(users.id, auth.userId));
      return NextResponse.json({ ok: true, message: "Two-factor authentication enabled" });
    }

    if (action === "disable") {
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        await db.update(users).set({ twoFactorEnabled: false, twoFactorSecret: null, updatedAt: new Date() }).where(eq(users.id, auth.userId));
        return NextResponse.json({ ok: true, message: "2FA disabled" });
      }

      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.twoFactorSecret), algorithm: "SHA1", digits: 6, period: 30 });
      const delta = totp.validate({ token: String(code), window: 1 });

      if (delta === null) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

      await db.update(users).set({ twoFactorEnabled: false, twoFactorSecret: null, updatedAt: new Date() }).where(eq(users.id, auth.userId));
      return NextResponse.json({ ok: true, message: "Two-factor authentication disabled" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

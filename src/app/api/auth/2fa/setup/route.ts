import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

// POST /api/auth/2fa/setup — Generate TOTP secret and QR code
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [user] = await db.select({ username: users.username, twoFactorEnabled: users.twoFactorEnabled }).from(users).where(eq(users.id, auth.userId)).limit(1);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const totp = new OTPAuth.TOTP({ issuer: "GameServer Manager", label: user.username, algorithm: "SHA1", digits: 6, period: 30 });
    const secret = totp.secret.base32;
    const uri = totp.toString();

    // Store secret temporarily (not enabled until verified)
    await db.update(users).set({ twoFactorSecret: secret, updatedAt: new Date() }).where(eq(users.id, auth.userId));

    const qrDataUrl = await QRCode.toDataURL(uri);

    return NextResponse.json({ secret, qrCode: qrDataUrl, uri });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

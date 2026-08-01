import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

// Generate a random 24-character hex activation key
function generateKey(): string {
  const chars = "ABCDEF0123456789";
  let key = "GSM-";
  for (let i = 0; i < 4; i++) {
    if (i > 0) key += "-";
    for (let j = 0; j < 8; j++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return key; // e.g. GSM-4A2F1B0C-9D3E5F7A-1C8B0D4E-6F2A9C3B
}

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("x-admin-key");
    if (!auth) {
      return NextResponse.json({ error: "Admin key required" }, { status: 401 });
    }

    // The admin key is the JWT_SECRET — verify it matches
    const jwtSecret = process.env.JWT_SECRET || "gsm-panel-secret-change-me-in-production";
    if (auth !== jwtSecret) {
      return NextResponse.json({ error: "Invalid admin key" }, { status: 403 });
    }

    // Generate a new activation key
    const activationKey = generateKey();

    // Save it to settings
    const existing = await db.select().from(settings).where(eq(settings.key, "panel_activation_key")).limit(1);
    if (existing.length === 0) {
      await db.insert(settings).values({
        key: "panel_activation_key",
        value: activationKey,
      });
    } else {
      await db.update(settings).set({ value: activationKey, updatedAt: new Date() }).where(eq(settings.key, "panel_activation_key"));
    }

    return NextResponse.json({ ok: true, activationKey });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { activationKey } = body;

    if (!activationKey) {
      return NextResponse.json({ error: "Activation key required" }, { status: 400 });
    }

    // Look up the stored activation key
    const [setting] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "panel_activation_key"))
      .limit(1);

    if (!setting || !setting.value) {
      return NextResponse.json({ error: "Activation not configured on this panel" }, { status: 403 });
    }

    if (activationKey.trim().toUpperCase() === setting.value.toUpperCase()) {
      // Mark as activated
      await db.update(settings).set({
        key: "panel_activated",
        value: "true",
        updatedAt: new Date(),
      }).where(eq(settings.key, "panel_activated"));

      return NextResponse.json({ ok: true, message: "Panel unlocked successfully!" });
    }

    return NextResponse.json({ error: "Invalid activation key" }, { status: 401 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const [keySetting, activatedSetting] = await Promise.all([
      db.select().from(settings).where(eq(settings.key, "panel_activation_key")).limit(1),
      db.select().from(settings).where(eq(settings.key, "panel_activated")).limit(1),
    ]);

    const hasKey = keySetting.length > 0 && !!keySetting[0]?.value;
    const isActivated = activatedSetting.length > 0 && activatedSetting[0]?.value === "true";

    return NextResponse.json({
      requiresActivation: hasKey && !isActivated,
      isActivated,
      hasKey,
    });
  } catch {
    // If DB isn't ready yet, assume no activation needed
    return NextResponse.json({ requiresActivation: false, isActivated: true, hasKey: false });
  }
}

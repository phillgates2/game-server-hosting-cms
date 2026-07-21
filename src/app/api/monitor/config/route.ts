import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_MONITOR_CONFIG } from "@/lib/monitor";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const row = await db.select().from(siteSettings).where(eq(siteSettings.key, "monitor_config")).limit(1);
    let config = { ...DEFAULT_MONITOR_CONFIG };
    if (row.length > 0) {
      config = { ...config, ...JSON.parse(row[0].value) };
    }
    return NextResponse.json({ config });
  } catch {
    return NextResponse.json({ config: DEFAULT_MONITOR_CONFIG });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const config = {
      autoCleanEnabled: Boolean(body.autoCleanEnabled ?? DEFAULT_MONITOR_CONFIG.autoCleanEnabled),
      buffCacheThresholdPercent: Math.max(10, Math.min(99, Number(body.buffCacheThresholdPercent ?? DEFAULT_MONITOR_CONFIG.buffCacheThresholdPercent))),
      ramUsedThresholdPercent: Math.max(10, Math.min(99, Number(body.ramUsedThresholdPercent ?? DEFAULT_MONITOR_CONFIG.ramUsedThresholdPercent))),
      checkIntervalSeconds: Math.max(10, Math.min(3600, Number(body.checkIntervalSeconds ?? DEFAULT_MONITOR_CONFIG.checkIntervalSeconds))),
      clearLevel: ([1, 2, 3].includes(body.clearLevel) ? body.clearLevel : DEFAULT_MONITOR_CONFIG.clearLevel),
      keepHistoryHours: Math.max(1, Math.min(168, Number(body.keepHistoryHours ?? DEFAULT_MONITOR_CONFIG.keepHistoryHours))),
    };

    const existing = await db.select().from(siteSettings).where(eq(siteSettings.key, "monitor_config")).limit(1);

    if (existing.length > 0) {
      await db.update(siteSettings).set({
        value: JSON.stringify(config),
        updatedAt: new Date(),
      }).where(eq(siteSettings.key, "monitor_config"));
    } else {
      await db.insert(siteSettings).values({
        key: "monitor_config",
        value: JSON.stringify(config),
      });
    }

    return NextResponse.json({ config, success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save config";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

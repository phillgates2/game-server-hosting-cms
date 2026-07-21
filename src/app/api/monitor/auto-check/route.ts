import { NextResponse } from "next/server";
import {
  getMemoryInfo,
  shouldClearCache,
  clearBufferCache,
  DEFAULT_MONITOR_CONFIG,
} from "@/lib/monitor";
import { db } from "@/db";
import { siteSettings, monitorSnapshots, monitorClearEvents } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Automated RAM monitor check — can be called by cron or the UI watchdog timer.
 * Reads thresholds from DB, checks memory, and auto-clears if needed.
 * No auth required so cron can call it; protected by an optional secret.
 */
export async function GET(request: Request) {
  // Optional secret check for external cron
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const envSecret = process.env.MONITOR_SECRET;
  if (envSecret && secret !== envSecret) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
  }

  try {
    // Load config
    let config = { ...DEFAULT_MONITOR_CONFIG };
    try {
      const row = await db.select().from(siteSettings).where(eq(siteSettings.key, "monitor_config")).limit(1);
      if (row.length > 0) {
        config = { ...config, ...JSON.parse(row[0].value) };
      }
    } catch {
      // use defaults
    }

    const mem = getMemoryInfo();
    const check = shouldClearCache(config);

    // Save snapshot
    try {
      await db.insert(monitorSnapshots).values({
        totalRam: mem.totalMb,
        usedRam: mem.usedMb,
        freeRam: mem.freeMb,
        availableRam: mem.availableMb,
        buffersRam: mem.buffersMb,
        cachedRam: mem.cachedMb,
        swapTotal: mem.swapTotalMb,
        swapUsed: mem.swapUsedMb,
        cpuUsage: 0,
        autoClearTriggered: check.shouldClear && config.autoCleanEnabled,
      });
    } catch {
      // non-fatal
    }

    if (check.shouldClear && config.autoCleanEnabled) {
      const level = config.clearLevel as 1 | 2 | 3;
      const result = clearBufferCache(level);

      // Log event
      try {
        await db.insert(monitorClearEvents).values({
          trigger: "auto",
          ramBeforeMb: result.before.usedMb,
          buffersBeforeMb: result.before.buffersMb,
          cachedBeforeMb: result.before.cachedMb,
          ramAfterMb: result.after.usedMb,
          buffersAfterMb: result.after.buffersMb,
          cachedAfterMb: result.after.cachedMb,
          freedMb: result.freedMb,
          clearLevel: level,
          status: result.success ? "success" : "error",
          errorLog: result.error || null,
        });
      } catch {
        // non-fatal
      }

      return NextResponse.json({
        action: "cleared",
        reason: check.reason,
        result,
        memory: mem,
        config,
      });
    }

    return NextResponse.json({
      action: "none",
      reason: check.reason,
      memory: {
        totalMb: mem.totalMb,
        usedMb: mem.usedMb,
        freeMb: mem.freeMb,
        buffCacheMb: mem.buffCacheMb,
        usedPercent: mem.usedPercent,
        realUsedPercent: mem.realUsedPercent,
        buffCachePercent: mem.buffCachePercent,
      },
      config,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Auto-check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSystemSnapshot, getMemoryStatus, shouldClearCache, DEFAULT_MONITOR_CONFIG } from "@/lib/monitor";
import { db } from "@/db";
import { monitorSnapshots, siteSettings } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const snapshot = getSystemSnapshot();
    const memStatus = getMemoryStatus(snapshot.memory);

    // Load config from DB
    let config = { ...DEFAULT_MONITOR_CONFIG };
    try {
      const configRow = await db.select().from(siteSettings).where(eq(siteSettings.key, "monitor_config")).limit(1);
      if (configRow.length > 0) {
        config = { ...config, ...JSON.parse(configRow[0].value) };
      }
    } catch {
      // use defaults
    }

    const thresholdCheck = shouldClearCache(config);

    // Save snapshot to DB for history
    try {
      await db.insert(monitorSnapshots).values({
        totalRam: snapshot.memory.totalMb,
        usedRam: snapshot.memory.usedMb,
        freeRam: snapshot.memory.freeMb,
        availableRam: snapshot.memory.availableMb,
        buffersRam: snapshot.memory.buffersMb,
        cachedRam: snapshot.memory.cachedMb,
        swapTotal: snapshot.memory.swapTotalMb,
        swapUsed: snapshot.memory.swapUsedMb,
        cpuUsage: snapshot.cpu.usagePercent,
        loadAvg1: snapshot.cpu.loadAvg1,
        loadAvg5: snapshot.cpu.loadAvg5,
        loadAvg15: snapshot.cpu.loadAvg15,
        diskTotal: snapshot.disk.totalGb,
        diskUsed: snapshot.disk.usedGb,
        autoClearTriggered: false,
      });
    } catch {
      // non-fatal; table may not exist yet
    }

    // Get last 60 snapshots for history chart
    let history: Array<{
      usedRam: number;
      buffersRam: number;
      cachedRam: number;
      cpuUsage: number;
      createdAt: Date;
    }> = [];
    try {
      history = await db.select({
        usedRam: monitorSnapshots.usedRam,
        buffersRam: monitorSnapshots.buffersRam,
        cachedRam: monitorSnapshots.cachedRam,
        cpuUsage: monitorSnapshots.cpuUsage,
        createdAt: monitorSnapshots.createdAt,
      }).from(monitorSnapshots).orderBy(desc(monitorSnapshots.createdAt)).limit(60);
      history.reverse();
    } catch {
      // table may not exist
    }

    return NextResponse.json({
      snapshot,
      memStatus,
      thresholdCheck,
      config,
      history,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Monitor error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

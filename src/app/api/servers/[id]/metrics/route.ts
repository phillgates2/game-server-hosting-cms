import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, serverMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, eq, gte } from "drizzle-orm";
import { clampRangeHours, downsampleSeries } from "@/lib/metrics-history";
import { estimateDirBytes } from "@/lib/backup";
import { statfs } from "node:fs";
import { promisify } from "node:util";

const statfsAsync = promisify(statfs);

/** Directory sizes are expensive to walk; cache them briefly per server. */
const dirSizeCache = new Map<number, { mb: number; at: number }>();
const DIR_SIZE_CACHE_MS = 5 * 60_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safety cap on raw rows fetched before downsampling. A busy server sampled
 * every ~15s produces ~5,760 rows a day, so this comfortably covers the
 * maximum two-week window without being unbounded.
 */
const MAX_RAW_ROWS = 20_000;

// GET /api/servers/[id]/metrics?hours=N — CPU/RAM history for the chart
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view.metrics"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const serverId = Number(id);
  if (!Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  try {
    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId, name: gameServers.name, installPath: gameServers.installPath })
      .from(gameServers)
      .where(eq(gameServers.id, serverId))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const hours = clampRangeHours(req.nextUrl.searchParams.get("hours"));
    const since = new Date(Date.now() - hours * 3_600_000);

    const rows = await db
      .select({
        recordedAt: serverMetrics.recordedAt,
        cpuPercent: serverMetrics.cpuPercent,
        ramUsedMb: serverMetrics.ramUsedMb,
      })
      .from(serverMetrics)
      .where(and(eq(serverMetrics.serverId, serverId), gte(serverMetrics.recordedAt, since)))
      .orderBy(serverMetrics.recordedAt)
      .limit(MAX_RAW_ROWS);

    // The query returns oldest-first; the chart wants exactly that order.
    const cpu = downsampleSeries(
      rows
        .filter((r) => r.cpuPercent !== null)
        .map((r) => ({ t: r.recordedAt.getTime(), v: Math.round((r.cpuPercent as number) * 100) / 100 }))
    );
    const ram = downsampleSeries(
      rows
        .filter((r) => r.ramUsedMb !== null)
        .map((r) => ({ t: r.recordedAt.getTime(), v: Math.round((r.ramUsedMb as number) * 100) / 100 }))
    );

    // Disk context: the server folder size (walked at most every five
    // minutes) and the filesystem it lives on. Both help answer "is this
    // server the one eating the disk?" right next to the CPU/RAM charts.
    let dirMb: number | null = null;
    try {
      const cached = dirSizeCache.get(serverId);
      if (cached && Date.now() - cached.at < DIR_SIZE_CACHE_MS) {
        dirMb = cached.mb;
      } else {
        const bytes = await estimateDirBytes(server.installPath, Number.MAX_SAFE_INTEGER);
        dirMb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
        dirSizeCache.set(serverId, { mb: dirMb, at: Date.now() });
      }
    } catch {
      dirMb = null;
    }
    let disk: { usedMb: number; totalMb: number } | null = null;
    try {
      const st = await statfsAsync(server.installPath);
      const totalMb = Math.round((st.blocks * st.bsize) / (1024 * 1024));
      const freeMb = Math.round((st.bavail * st.bsize) / (1024 * 1024));
      disk = { usedMb: Math.max(0, totalMb - freeMb), totalMb };
    } catch {
      disk = null;
    }

    const { recentServerEvents } = await import("@/lib/server-events");
    const events = await recentServerEvents(serverId, 8);

    if (req.nextUrl.searchParams.get("format") === "csv") {
      const { seriesToCsv } = await import("@/lib/csv-export");
      const csv = seriesToCsv([
        { name: "cpu_percent", points: cpu },
        { name: "ram_percent", points: ram },
      ]);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="server-${serverId}-metrics-${hours}h.csv"`,
        },
      });
    }

    return NextResponse.json({ serverId, hours, samples: rows.length, cpu, ram, dirMb, disk, events });
  } catch {
    return NextResponse.json({ error: "Could not load metrics" }, { status: 500 });
  }
}

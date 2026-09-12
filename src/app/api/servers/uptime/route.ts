import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, serverUptimeHistory } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, gte } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureUptimeTable } from "@/lib/uptime-tracker";
import { clampUptimeHours, summarizeUptime, uptimeGrade } from "@/lib/uptime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FLEET_ROWS = 200_000;
const MAX_SERVERS_REPORTED = 100;

// GET /api/servers/uptime?hours=N — fleet stability summary, worst first.
// Ownership rule matches GET /api/servers: non-admins see only their own.
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const hours = clampUptimeHours(req.nextUrl.searchParams.get("hours"));

  try {
    await ensureUptimeTable();

    const servers = await db
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        name: gameServers.name,
        gameIcon: gameDefinitions.iconEmoji,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .limit(1_000);
    const visible = servers.filter((s) => auth.role === "admin" || s.userId === auth.userId);
    if (visible.length === 0) return NextResponse.json({ hours, servers: [] });

    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await db
      .select({
        serverId: serverUptimeHistory.serverId,
        online: serverUptimeHistory.online,
        checkedAt: serverUptimeHistory.checkedAt,
      })
      .from(serverUptimeHistory)
      .where(gte(serverUptimeHistory.checkedAt, since))
      .limit(MAX_FLEET_ROWS);

    const byServer = new Map<number, Array<{ online: boolean; checkedAt: number }>>();
    for (const r of rows) {
      const list = byServer.get(r.serverId) ?? [];
      list.push({ online: r.online, checkedAt: r.checkedAt.getTime() });
      byServer.set(r.serverId, list);
    }

    const now = Date.now();
    const summary = visible
      .map((s) => {
        const sum = summarizeUptime(byServer.get(s.id) ?? [], hours * 3_600_000, now);
        return {
          serverId: s.id,
          name: s.name,
          gameIcon: s.gameIcon,
          ...sum,
          grade: uptimeGrade(sum.percent),
        };
      })
      // Servers with data first, worst percent first; unchecked last.
      .sort((a, b) => {
        if (a.percent === null && b.percent === null) return a.serverId - b.serverId;
        if (a.percent === null) return 1;
        if (b.percent === null) return -1;
        return a.percent - b.percent;
      })
      .slice(0, MAX_SERVERS_REPORTED);

    return NextResponse.json({ hours, servers: summary });
  } catch (e: unknown) {
    return apiError(e, "Could not load fleet uptime", 500);
  }
}

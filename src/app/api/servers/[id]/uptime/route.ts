import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, serverUptimeHistory } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, eq, gte } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureUptimeTable } from "@/lib/uptime-tracker";
import { clampUptimeHours, summarizeUptime, uptimeGrade } from "@/lib/uptime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/[id]/uptime?hours=N — stability % over the window
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }
  const hours = clampUptimeHours(req.nextUrl.searchParams.get("hours"));

  try {
    await ensureUptimeTable();

    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId, name: gameServers.name })
      .from(gameServers)
      .where(eq(gameServers.id, idNum))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const since = new Date(Date.now() - hours * 3_600_000);
    const rows = await db
      .select({ online: serverUptimeHistory.online, checkedAt: serverUptimeHistory.checkedAt })
      .from(serverUptimeHistory)
      .where(and(eq(serverUptimeHistory.serverId, idNum), gte(serverUptimeHistory.checkedAt, since)))
      .limit(10_000);

    const summary = summarizeUptime(
      rows.map((r) => ({ online: r.online, checkedAt: r.checkedAt.getTime() })),
      hours * 3_600_000,
      Date.now()
    );

    return NextResponse.json({
      serverId: idNum,
      hours,
      ...summary,
      grade: uptimeGrade(summary.percent),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load uptime", 500);
  }
}

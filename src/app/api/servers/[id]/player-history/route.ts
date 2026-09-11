import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, playerSamples } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, eq, gte } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { buildHeatmap, describePeak } from "@/lib/player-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SAMPLES = 20_000;

// GET /api/servers/[id]/player-history — peak-hours heatmap from probe samples
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  try {
    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId })
      .from(gameServers)
      .where(eq(gameServers.id, idNum))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const since = new Date(Date.now() - 14 * 86_400_000);
    const rows = await db
      .select({ players: playerSamples.players, recordedAt: playerSamples.recordedAt })
      .from(playerSamples)
      .where(and(eq(playerSamples.serverId, idNum), gte(playerSamples.recordedAt, since)))
      .orderBy(playerSamples.recordedAt)
      .limit(MAX_SAMPLES);

    const heatmap = buildHeatmap(rows.map((r) => ({ ts: r.recordedAt.getTime(), players: r.players })));
    return NextResponse.json({
      samples: heatmap.totalSamples,
      cells: heatmap.cells,
      peak: heatmap.peak,
      peakLabel: describePeak(heatmap.peak),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load player history", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, serverIdleState } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  ensureIdleTable,
  idleDurationMs,
  describeIdleDuration,
  IDLE_DEFAULT_THRESHOLD_HOURS,
} from "@/lib/idle-detection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/idle — running servers with an ongoing zero-player streak
// at or past the threshold. Ownership matches GET /api/servers.
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const hoursParam = Number(req.nextUrl.searchParams.get("hours"));
  const thresholdHours =
    Number.isFinite(hoursParam) && hoursParam >= 1 && hoursParam <= 72
      ? hoursParam
      : IDLE_DEFAULT_THRESHOLD_HOURS;
  const thresholdMs = thresholdHours * 3_600_000;

  try {
    await ensureIdleTable();
    const now = Date.now();

    const rows = await db
      .select({
        serverId: gameServers.id,
        userId: gameServers.userId,
        name: gameServers.name,
        gameIcon: gameDefinitions.iconEmoji,
        zeroPlayersSince: serverIdleState.zeroPlayersSince,
      })
      .from(serverIdleState)
      .innerJoin(gameServers, eq(serverIdleState.serverId, gameServers.id))
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .limit(1_000);

    const idle = rows
      .filter((r) => auth.role === "admin" || r.userId === auth.userId)
      .map((r) => {
        const dur = idleDurationMs(r.zeroPlayersSince, now);
        return { ...r, dur };
      })
      .filter((r) => r.dur !== null && r.dur >= thresholdMs)
      .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
      .slice(0, 100)
      .map((r) => ({
        serverId: r.serverId,
        name: r.name,
        gameIcon: r.gameIcon,
        zeroPlayersSince: r.zeroPlayersSince?.toISOString() ?? null,
        idleForMs: r.dur,
        idleFor: describeIdleDuration(r.dur ?? 0),
      }));

    return NextResponse.json({ thresholdHours, idle });
  } catch (e: unknown) {
    return apiError(e, "Could not load idle servers", 500);
  }
}

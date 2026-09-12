import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playerSamples, gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, gte, inArray, and, or } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  aggregateLeaderboard,
  rankLeaderboard,
  clampLeaderboardDays,
  LEADERBOARD_TOP_N,
  type LeaderboardSort,
} from "@/lib/player-leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never aggregate more samples than this in one request. */
const MAX_SAMPLES = 50_000;

// GET /api/leaderboard?days=7&sortBy=peak — busiest servers in the fleet
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const days = clampLeaderboardDays(url.searchParams.get("days"));
    const sortBy: LeaderboardSort = url.searchParams.get("sortBy") === "average" ? "average" : "peak";
    const since = new Date(Date.now() - days * 24 * 3_600_000);

    const rows = await db
      .select({
        serverId: playerSamples.serverId,
        players: playerSamples.players,
        recordedAt: playerSamples.recordedAt,
      })
      .from(playerSamples)
      .where(gte(playerSamples.recordedAt, since))
      .limit(MAX_SAMPLES);

    const stats = aggregateLeaderboard(
      rows.map((r) => ({ serverId: r.serverId, players: r.players, recordedAtMs: new Date(r.recordedAt).getTime() }))
    );
    const ranked = rankLeaderboard(stats, sortBy, LEADERBOARD_TOP_N);
    if (ranked.length === 0) {
      return NextResponse.json({ days, sortBy, leaderboard: [] });
    }

    // Resolve names + visibility in one pass: admins see everything,
    // everyone else only their own and shared servers.
    const ids = ranked.map((r) => r.serverId);
    const servers = await db
      .select({ id: gameServers.id, name: gameServers.name, userId: gameServers.userId })
      .from(gameServers)
      .where(inArray(gameServers.id, ids));
    const nameById = new Map(servers.map((s) => [s.id, s.name]));

    let visibleIds = new Set<number>(servers.map((s) => s.id));
    if (auth.role !== "admin") {
      const { sharedServerIdsFor } = await import("@/lib/server-collab");
      const shared = new Set(await sharedServerIdsFor(auth.userId));
      visibleIds = new Set(
        servers.filter((s) => s.userId === auth.userId || shared.has(s.id)).map((s) => s.id)
      );
    }

    const leaderboard = ranked
      .filter((r) => visibleIds.has(r.serverId))
      .map((r, i) => ({
        rank: i + 1,
        serverId: r.serverId,
        name: nameById.get(r.serverId) ?? `server #${r.serverId}`,
        peakPlayers: r.peakPlayers,
        avgPlayers: r.avgPlayers,
        sampleCount: r.sampleCount,
      }));

    return NextResponse.json({ days, sortBy, leaderboard });
  } catch (e: unknown) {
    return apiError(e, "Leaderboard failed", 500);
  }
}

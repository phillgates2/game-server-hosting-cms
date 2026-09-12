import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, playerSamples } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { sql, inArray } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { assessServerForCleanup, CLEANUP_SAMPLE_WINDOW_DAYS } from "@/lib/cleanup-advisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cleanup — advisory list of abandoned-looking servers.
// Purely informational: the panel never auto-deletes on this signal.
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const rows = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        userId: gameServers.userId,
        status: gameServers.status,
        lastStopped: gameServers.lastStopped,
        expiresAt: gameServers.expiresAt,
      })
      .from(gameServers)
      .orderBy(gameServers.lastStopped);

    // Visibility: admins see the whole fleet, others their own + shared.
    let visible = rows;
    if (auth.role !== "admin") {
      const { sharedServerIdsFor } = await import("@/lib/server-collab");
      const shared = new Set(await sharedServerIdsFor(auth.userId));
      visible = rows.filter((r) => r.userId === auth.userId || shared.has(r.id));
    }
    if (visible.length === 0) return NextResponse.json({ candidates: [] });

    // Newest player sample per server inside the advisor window.
    const ids = visible.map((r) => r.id);
    let lastSampleById = new Map<number, number>();
    try {
      const windowStart = new Date(Date.now() - CLEANUP_SAMPLE_WINDOW_DAYS * 86_400_000);
      const sampleRows = await db
        .select({
          serverId: playerSamples.serverId,
          latest: sql<string>`max(recorded_at)`,
        })
        .from(playerSamples)
        .where(inArray(playerSamples.serverId, ids))
        .groupBy(playerSamples.serverId);
      lastSampleById = new Map(
        sampleRows
          .map((r) => [r.serverId, new Date(r.latest).getTime()] as [number, number])
          .filter(([, t]) => Number.isFinite(t) && t >= windowStart.getTime())
      );
    } catch { /* no samples table yet */ }

    const nowMs = Date.now();
    const candidates = visible
      .map((r) => ({
        id: r.id,
        name: r.name,
        assessment: assessServerForCleanup(
          {
            status: r.status,
            lastStoppedMs: r.lastStopped ? new Date(r.lastStopped).getTime() : null,
            lastSampleMs: lastSampleById.get(r.id) ?? null,
            isEphemeral: r.expiresAt !== null,
          },
          nowMs
        ),
      }))
      .filter((r) => r.assessment.level !== "healthy")
      .sort((a, b) => (a.assessment.level === "candidate" ? -1 : 1) - (b.assessment.level === "candidate" ? -1 : 1));

    return NextResponse.json({ candidates });
  } catch (e: unknown) {
    return apiError(e, "Cleanup advice failed", 500);
  }
}

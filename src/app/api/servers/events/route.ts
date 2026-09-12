import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { serverEvents, gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, desc, eq, gte } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { clampFeedHours, FEED_MAX_EVENTS } from "@/lib/event-feed";
import { ensureServerEventsTable } from "@/lib/server-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/events?hours=N — fleet-wide crash/restart feed.
// Follows the same ownership rule as GET /api/servers: non-admins only see
// events for their own servers.
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const hours = clampFeedHours(req.nextUrl.searchParams.get("hours"));
  const since = new Date(Date.now() - hours * 3_600_000);

  try {
    await ensureServerEventsTable();

    const rows = await db
      .select({
        id: serverEvents.id,
        kind: serverEvents.kind,
        detail: serverEvents.detail,
        createdAt: serverEvents.createdAt,
        serverId: serverEvents.serverId,
        serverName: gameServers.name,
        gameName: gameDefinitions.name,
        gameIcon: gameDefinitions.iconEmoji,
      })
      .from(serverEvents)
      .innerJoin(gameServers, eq(serverEvents.serverId, gameServers.id))
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(
        and(
          gte(serverEvents.createdAt, since),
          auth.role !== "admin" ? eq(gameServers.userId, auth.userId) : undefined
        )
      )
      .orderBy(desc(serverEvents.createdAt))
      .limit(FEED_MAX_EVENTS);

    return NextResponse.json({
      hours,
      events: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load fleet events", 500);
  }
}

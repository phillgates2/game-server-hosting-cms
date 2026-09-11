import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-server cooldown so a refresh button cannot become a probe storm. */
const ROSTER_COOLDOWN_MS = 30_000;
const lastProbes = new Map<number, number>();

// GET /api/servers/[id]/roster — live player names (local nodes, v1)
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
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        ipv4: gameServers.ipv4,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        gameSlug: gameDefinitions.slug,
        nodeIsLocal: nodes.isLocal,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, idNum))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (server.nodeIsLocal === false) {
      return NextResponse.json({ error: "Rosters are available for servers on local nodes (agent support pending)." }, { status: 400 });
    }

    const last = lastProbes.get(idNum) ?? 0;
    if (Date.now() - last < ROSTER_COOLDOWN_MS) {
      return NextResponse.json({ error: "Roster refreshed too recently — try again in a few seconds." }, { status: 429 });
    }
    lastProbes.set(idNum, Date.now());

    const { probePlayers, probeSpecFor } = await import("@/lib/players");
    const slug = server.gameSlug ?? "";
    if (probeSpecFor(slug).kind === "none") {
      return NextResponse.json({ error: "This game has no query protocol the panel can ask for a roster." }, { status: 400 });
    }
    const probe = await probePlayers({
      gameSlug: slug,
      host: server.ipv4 ?? "127.0.0.1",
      port: server.port,
      queryPort: server.queryPort,
      attempts: 1,
    });
    if (!probe.ok) {
      return NextResponse.json({ players: null, names: [], map: null, reachable: false });
    }
    return NextResponse.json({
      players: probe.players ?? null,
      names: probe.names ?? [],
      maxPlayers: probe.maxPlayers ?? null,
      map: probe.map ?? null,
      reachable: true,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not probe the roster", 500);
  }
}

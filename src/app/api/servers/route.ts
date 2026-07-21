import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, games, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = user.role === "admin";
  const condition = isAdmin ? undefined : eq(gameServers.userId, user.userId);

  const servers = condition
    ? await db.select().from(gameServers).where(condition)
    : await db.select().from(gameServers);

  // Enrich with game data
  const allGames = await db.select().from(games);
  const allNodes = await db.select().from(nodes);

  const enriched = servers.map(s => ({
    ...s,
    game: allGames.find(g => g.id === s.gameId),
    node: allNodes.find(n => n.id === s.nodeId),
  }));

  return NextResponse.json({ servers: enriched });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { name, gameId, nodeId, slots } = await request.json();

    // Get game info
    const gameList = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (gameList.length === 0) {
      return NextResponse.json({ error: "Invalid game" }, { status: 400 });
    }
    const game = gameList[0];

    // Get node info
    const actualNodeId = nodeId || 1;
    const nodeList = await db.select().from(nodes).where(eq(nodes.id, actualNodeId)).limit(1);
    if (nodeList.length === 0) {
      return NextResponse.json({ error: "Invalid node" }, { status: 400 });
    }

    // Generate port
    const port = game.defaultPort + Math.floor(Math.random() * 1000);

    const result = await db.insert(gameServers).values({
      name: name || `${game.name} Server`,
      userId: user.userId,
      gameId: game.id,
      nodeId: actualNodeId,
      port,
      slots: slots || 16,
      status: "installing",
      installStatus: "installing",
      configData: game.configTemplate,
    }).returning();

    return NextResponse.json({ server: result[0] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create server";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

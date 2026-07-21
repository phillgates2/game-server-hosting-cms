import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, games } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { getInstallSteps } from "@/lib/game-installer";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const serverId = parseInt(id, 10);

  const servers = await db.select().from(gameServers).where(eq(gameServers.id, serverId)).limit(1);
  if (servers.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const server = servers[0];
  if (server.userId !== user.userId && user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const gameList = await db.select().from(games).where(eq(games.id, server.gameId)).limit(1);
  const game = gameList[0];

  const steps = getInstallSteps(game?.slug || "cs2");

  // Simulate installation: mark as installed
  await db.update(gameServers).set({
    installStatus: "installed",
    status: "stopped",
    installLog: `[${new Date().toISOString()}] Installation started for ${game?.name || "Unknown Game"}\n` +
      steps.map(s => `[OK] Step ${s.step}: ${s.name}`).join("\n") +
      `\n[${new Date().toISOString()}] Installation complete!`,
  }).where(eq(gameServers.id, serverId));

  return NextResponse.json({
    success: true,
    steps: steps.map(s => ({ ...s, status: "completed" as const, progress: 100 })),
  });
}

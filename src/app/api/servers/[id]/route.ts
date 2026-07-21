import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, games, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function GET(
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
  const nodeList = await db.select().from(nodes).where(eq(nodes.id, server.nodeId)).limit(1);

  return NextResponse.json({
    server: { ...server, game: gameList[0], node: nodeList[0] },
  });
}

export async function PATCH(
  request: NextRequest,
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

  const body = await request.json();
  const updates: Partial<{
    name: string;
    status: string;
    installStatus: string;
    installLog: string;
    configData: unknown;
  }> = {};

  if (body.name) updates.name = body.name;
  if (body.status) updates.status = body.status;
  if (body.installStatus) updates.installStatus = body.installStatus;
  if (body.installLog) updates.installLog = body.installLog;
  if (body.configData) updates.configData = body.configData;

  const result = await db.update(gameServers).set(updates).where(eq(gameServers.id, serverId)).returning();
  return NextResponse.json({ server: result[0] });
}

export async function DELETE(
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

  await db.delete(gameServers).where(eq(gameServers.id, serverId));
  return NextResponse.json({ success: true });
}

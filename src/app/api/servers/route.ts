import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { homedir } from "os";
import { basename, join } from "path";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const query = db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ipv4: gameServers.ipv4,
        ipv6: gameServers.ipv6,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        status: gameServers.status,
        autoRestart: gameServers.autoRestart,
        discordWebhook: gameServers.discordWebhook,
        nodeId: gameServers.nodeId,
        createdAt: gameServers.createdAt,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
        gameIcon: gameDefinitions.iconEmoji,
        nodeName: nodes.name,
        nodeHostname: nodes.hostname,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .$dynamic();

    if (auth.role !== "admin") {
      query.where(eq(gameServers.userId, auth.userId));
    }

    const servers = await query;
    return NextResponse.json({ servers });
  } catch (e) {
    console.error("GET /api/servers error:", e);
    return NextResponse.json({ servers: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, gameId, nodeId, port, ipv4, ipv6, installPath, discordWebhook } = body;

    if (!name || !gameId || !port || !installPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let finalInstallPath = installPath;

    // If this is a local node and the panel is not running as root, avoid /opt by default.
    if (nodeId) {
      const [node] = await db
        .select({ isLocal: nodes.isLocal, gameServerPath: nodes.gameServerPath })
        .from(nodes)
        .where(eq(nodes.id, Number(nodeId)))
        .limit(1);

      const isRootUser = process.getuid?.() === 0;
      if (node?.isLocal && !isRootUser && finalInstallPath.startsWith("/opt/gameservers")) {
        finalInstallPath = join(homedir() || "/home", "gameservers", basename(finalInstallPath));
      }
    }

    const [server] = await db
      .insert(gameServers)
      .values({
        name,
        gameId: Number(gameId),
        nodeId: nodeId ? Number(nodeId) : null,
        port: Number(port),
        queryPort: body.queryPort ? Number(body.queryPort) : Number(port) + 1,
        ipv4: ipv4 || "0.0.0.0",
        ipv6: ipv6 || null,
        installPath: finalInstallPath,
        userId: auth.userId,
        status: "stopped", 
        config: body.config || {},
        variables: body.variables || {},
        discordWebhook: discordWebhook || null,
        discordNotifyStart: body.discordNotifyStart ?? true,
        discordNotifyStop: body.discordNotifyStop ?? true,
        discordNotifyRestart: body.discordNotifyRestart ?? true,
        discordNotifyCrash: body.discordNotifyCrash ?? true,
      })
      .returning();

    return NextResponse.json({ server }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

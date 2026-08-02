import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { homedir } from "os";
import { basename, join } from "path";
import { mkdir } from "fs/promises";
import { buildUniqueServerPath } from "@/lib/server-path";

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
        pid: gameServers.pid,
        lastStarted: gameServers.lastStarted,
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
    const { name, gameId, nodeId, port, ipv4, ipv6, installPath: _installPath, discordWebhook } = body;

    if (!name || !gameId || !port || !nodeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [game] = await db
      .select({ slug: gameDefinitions.slug })
      .from(gameDefinitions)
      .where(eq(gameDefinitions.id, Number(gameId)))
      .limit(1);
    if (!game) {
      return NextResponse.json({ error: "Selected game not found" }, { status: 404 });
    }

    const [node] = await db
      .select({ isLocal: nodes.isLocal, gameServerPath: nodes.gameServerPath })
      .from(nodes)
      .where(eq(nodes.id, Number(nodeId)))
      .limit(1);
    if (!node) {
      return NextResponse.json({ error: "Selected node not found" }, { status: 404 });
    }

    // Base path comes from the node. Local non-root installs should avoid /opt.
    let basePath = node.gameServerPath || "/home/gameservers";
    const isRootUser = process.getuid?.() === 0;
    if (node.isLocal && !isRootUser && basePath.startsWith("/opt/gameservers")) {
      basePath = join(homedir() || "/home", "gameservers");
    }

    // Every new server gets its own unique folder, even if a previous server used the same path name.
    const existing = await db.select({ installPath: gameServers.installPath }).from(gameServers);
    const reservedPaths = existing.map((s) => s.installPath);
    const finalInstallPath = await buildUniqueServerPath(basePath, game.slug, name, reservedPaths);

    // Pre-create the directory for local nodes so the folder exists immediately.
    if (node.isLocal) {
      await mkdir(finalInstallPath, { recursive: true }).catch(() => {});
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

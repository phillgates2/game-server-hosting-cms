import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { sendDiscordWebhook } from "@/lib/discord";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [server] = await db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      ipv4: gameServers.ipv4,
      ipv6: gameServers.ipv6,
      port: gameServers.port,
      status: gameServers.status,
      pid: gameServers.pid,
      config: gameServers.config,
      installPath: gameServers.installPath,
      autoRestart: gameServers.autoRestart,
      discordWebhook: gameServers.discordWebhook,
      discordNotifyStart: gameServers.discordNotifyStart,
      discordNotifyStop: gameServers.discordNotifyStop,
      discordNotifyRestart: gameServers.discordNotifyRestart,
      discordNotifyCrash: gameServers.discordNotifyCrash,
      createdAt: gameServers.createdAt,
      gameName: gameDefinitions.name,
      gameSlug: gameDefinitions.slug,
      gameIcon: gameDefinitions.iconEmoji,
      installScript: gameDefinitions.installScript,
      startCommand: gameDefinitions.startCommand,
      defaultConfig: gameDefinitions.defaultConfig,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(eq(gameServers.id, Number(id)))
    .limit(1);

  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ server });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Get current server state for webhook notifications
  const [currentServer] = await db
    .select({
      name: gameServers.name,
      status: gameServers.status,
      ipv4: gameServers.ipv4,
      ipv6: gameServers.ipv6,
      port: gameServers.port,
      discordWebhook: gameServers.discordWebhook,
      discordNotifyStart: gameServers.discordNotifyStart,
      discordNotifyStop: gameServers.discordNotifyStop,
      discordNotifyRestart: gameServers.discordNotifyRestart,
      gameName: gameDefinitions.name,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(eq(gameServers.id, Number(id)))
    .limit(1);

  const [updated] = await db
    .update(gameServers)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(gameServers.id, Number(id)))
    .returning();

  // Send Discord webhook if status changed
  if (currentServer?.discordWebhook && body.status && body.status !== currentServer.status) {
    const webhookUrl = body.discordWebhook || currentServer.discordWebhook;
    
    if (body.status === "running" && currentServer.discordNotifyStart) {
      await sendDiscordWebhook(webhookUrl, {
        serverName: currentServer.name,
        gameName: currentServer.gameName || "Unknown",
        ipv4: currentServer.ipv4,
        ipv6: currentServer.ipv6,
        port: currentServer.port,
        event: "server_started",
        message: `**${currentServer.name}** is now online and accepting connections!`,
      });
    } else if (body.status === "stopped" && currentServer.discordNotifyStop) {
      await sendDiscordWebhook(webhookUrl, {
        serverName: currentServer.name,
        gameName: currentServer.gameName || "Unknown",
        ipv4: currentServer.ipv4,
        ipv6: currentServer.ipv6,
        port: currentServer.port,
        event: "server_stopped",
        message: `**${currentServer.name}** has been stopped.`,
      });
    } else if (body.status === "restarting" && currentServer.discordNotifyRestart) {
      await sendDiscordWebhook(webhookUrl, {
        serverName: currentServer.name,
        gameName: currentServer.gameName || "Unknown",
        ipv4: currentServer.ipv4,
        ipv6: currentServer.ipv6,
        port: currentServer.port,
        event: "server_restarted",
        message: `**${currentServer.name}** is restarting...`,
      });
    }
  }

  return NextResponse.json({ server: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Get server info for webhook notification
  const [server] = await db
    .select({
      name: gameServers.name,
      discordWebhook: gameServers.discordWebhook,
      port: gameServers.port,
      gameName: gameDefinitions.name,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(eq(gameServers.id, Number(id)))
    .limit(1);

  await db.delete(gameServers).where(eq(gameServers.id, Number(id)));

  // Send Discord webhook notification
  if (server?.discordWebhook) {
    await sendDiscordWebhook(server.discordWebhook, {
      serverName: server.name,
      gameName: server.gameName || "Unknown",
      port: server.port,
      event: "server_deleted",
      message: `**${server.name}** has been deleted.`,
    });
  }

  return NextResponse.json({ ok: true });
}

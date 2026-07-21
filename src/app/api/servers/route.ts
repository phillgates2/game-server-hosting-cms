import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { notifyServerCreated } from "@/lib/discord";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const query = db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      ipv4: gameServers.ipv4,
      ipv6: gameServers.ipv6,
      port: gameServers.port,
      status: gameServers.status,
      autoRestart: gameServers.autoRestart,
      discordWebhook: gameServers.discordWebhook,
      createdAt: gameServers.createdAt,
      gameName: gameDefinitions.name,
      gameSlug: gameDefinitions.slug,
      gameIcon: gameDefinitions.iconEmoji,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .$dynamic();

  if (auth.role !== "admin") {
    query.where(eq(gameServers.userId, auth.userId));
  }

  const servers = await query;
  return NextResponse.json({ servers });
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, gameId, port, ipv4, ipv6, installPath, discordWebhook } = body;

    if (!name || !gameId || !port || !installPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get game info for the webhook
    const [game] = await db
      .select({
        name: gameDefinitions.name,
        iconEmoji: gameDefinitions.iconEmoji,
      })
      .from(gameDefinitions)
      .where(eq(gameDefinitions.id, Number(gameId)))
      .limit(1);

    const [server] = await db
      .insert(gameServers)
      .values({
        name,
        gameId: Number(gameId),
        port: Number(port),
        ipv4: ipv4 || "0.0.0.0",
        ipv6: ipv6 || null,
        installPath,
        userId: auth.userId,
        status: "stopped",
        config: body.config || {},
        discordWebhook: discordWebhook || null,
        discordNotifyStart: body.discordNotifyStart ?? true,
        discordNotifyStop: body.discordNotifyStop ?? true,
        discordNotifyRestart: body.discordNotifyRestart ?? true,
        discordNotifyCrash: body.discordNotifyCrash ?? true,
      })
      .returning();

    // Send Discord webhook notification if configured
    if (discordWebhook && game) {
      await notifyServerCreated(
        discordWebhook,
        name,
        game.name,
        game.iconEmoji || "🎮",
        ipv4 || "0.0.0.0",
        ipv6,
        Number(port)
      );
    }

    return NextResponse.json({ server }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

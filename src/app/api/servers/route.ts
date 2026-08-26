import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { allowServerPorts } from "@/lib/firewall";
import { eq, sql } from "drizzle-orm";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { apiError } from "@/lib/api-error";
import { validatePorts, parsePort, withinServerQuota } from "@/lib/server-lifecycle";
import { createLogger } from "@/lib/logger";

const log = createLogger("servers");

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
        autoStart: gameServers.autoStart,
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
    log.exception("failed to list servers", e);
    return NextResponse.json({ servers: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, gameId, nodeId, port, ipv4, ipv6, installPath: _installPath, discordWebhook } = body;

    if (!name || !gameId || !port || !nodeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Enforce the per-user server quota. It is stored on the user, editable by
    // an admin with users.limits and displayed in the UI as "3/5", but nothing
    // ever checked it, so it was advisory only. Admins are exempt.
    if (auth.role !== "admin") {
      const [owner] = await db
        .select({ maxServers: users.maxServers })
        .from(users)
        .where(eq(users.id, auth.userId))
        .limit(1);
      const [{ count: ownedCount } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(gameServers)
        .where(eq(gameServers.userId, auth.userId));
      if (!withinServerQuota(ownedCount, owner?.maxServers)) {
        return NextResponse.json(
          { error: `Server limit reached (${ownedCount}/${owner?.maxServers}). Contact an administrator to raise it.` },
          { status: 403 }
        );
      }
    }

    const [game] = await db
      .select({ slug: gameDefinitions.slug, name: gameDefinitions.name, iconEmoji: gameDefinitions.iconEmoji })
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
      basePath = join(/* turbopackIgnore: true */ homedir() || "/home", "gameservers");
    }

    // Every new server gets its own unique folder, even if a previous server used the same path name.
    const existing = await db.select({ installPath: gameServers.installPath }).from(gameServers);
    const reservedPaths = existing.map((s) => s.installPath);
    const { buildUniqueServerPath } = await import("@/lib/server-path");
    const finalInstallPath = await buildUniqueServerPath(basePath, game.slug, name, reservedPaths);

    // Pre-create the directory for local nodes so the folder exists immediately.
    if (node.isLocal) {
      await mkdir(finalInstallPath, { recursive: true }).catch(() => {});
    }

    // Validate ports before they reach the database and the ufw command line.
    // Number() alone let NaN, negatives, decimals and >65535 straight through.
    const nodeServers = await db
      .select({ port: gameServers.port, queryPort: gameServers.queryPort, rconPort: gameServers.rconPort })
      .from(gameServers)
      .where(eq(gameServers.nodeId, Number(nodeId)));
    const takenPorts = nodeServers.flatMap((s) =>
      [s.port, s.queryPort, s.rconPort].filter((n): n is number => typeof n === "number")
    );

    const derivedQueryPort = body.queryPort ?? (parsePort(port) !== null ? Number(port) + 1 : undefined);
    const portCheck = validatePorts(
      { port, queryPort: derivedQueryPort, rconPort: body.rconPort },
      takenPorts
    );
    if (portCheck.error !== null || portCheck.ports === null) {
      return NextResponse.json({ error: portCheck.error }, { status: 400 });
    }
    const serverPort = portCheck.ports.port;
    const serverQueryPort = portCheck.ports.queryPort ?? serverPort + 1;
    const serverRconPort = portCheck.ports.rconPort;

    // Re-check the quota atomically. The check above produces a good error
    // message but races: several concurrent requests each read the same count,
    // each decide there is room, and each insert. Five parallel requests
    // reproducibly exceeded a limit of 2. Counting inside the writing
    // statement closes the window.
    if (auth.role !== "admin") {
      const guard = await db.execute(sql`
        SELECT 1 WHERE (
          (SELECT COALESCE(max_servers, 0) FROM users WHERE id = ${auth.userId}) <= 0
          OR (SELECT count(*) FROM game_servers WHERE user_id = ${auth.userId})
             < (SELECT COALESCE(max_servers, 0) FROM users WHERE id = ${auth.userId})
        )
      `);
      if (guard.rows.length === 0) {
        return NextResponse.json(
          { error: "Server limit reached. Contact an administrator to raise it." },
          { status: 403 }
        );
      }
    }

    const [server] = await db
      .insert(gameServers)
      .values({
        name,
        gameId: Number(gameId),
        nodeId: nodeId ? Number(nodeId) : null,
        port: serverPort,
        queryPort: serverQueryPort,
        rconPort: serverRconPort,
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

    // Open firewall ports for the new server (best-effort, non-blocking)
    allowServerPorts(server.id, name, {
      port: serverPort,
      queryPort: serverQueryPort,
      rconPort: serverRconPort,
    }).catch((e) => console.warn("[firewall] Failed to open ports:", e));

    // ── Provision a Discord channel for this server ──────────────────────────
    // Only when a bot is configured and auto-channel is on, and only when the
    // server does not already carry its own webhook. Failure is reported to the
    // caller but never fails the creation: the server exists and is usable.
    let discord: { channel?: string; error?: string } | undefined;
    if (!discordWebhook) {
      try {
        const { getDiscordSettings } = await import("@/lib/discord-settings");
        const cfg = await getDiscordSettings();

        if (cfg.autoChannel && cfg.botToken && cfg.guildId) {
          const { provisionServerChannel } = await import("@/lib/discord");
          const result = await provisionServerChannel(
            { token: cfg.botToken, guildId: cfg.guildId, categoryId: cfg.categoryId || null },
            name,
            { prefix: cfg.channelPrefix }
          );

          if (result.ok && result.webhookUrl) {
            // Store the generated webhook so every later notification uses the
            // ordinary webhook path and costs no further bot API calls.
            await db
              .update(gameServers)
              .set({ discordWebhook: result.webhookUrl, discordChannelId: result.channelId })
              .where(eq(gameServers.id, server.id));
            server.discordWebhook = result.webhookUrl;
            server.discordChannelId = result.channelId ?? null;
            discord = { channel: result.channelName };

            const { notifyServerCreated } = await import("@/lib/discord");
            const { maxPlayersFrom } = await import("@/lib/players");
            await notifyServerCreated(
              result.webhookUrl,
              name,
              game?.name || "Unknown",
              game?.iconEmoji || "🎮",
              ipv4 || null,
              ipv6 || null,
              serverPort,
              {
                serverStatus: "offline",
                playerCount: 0,
                maxPlayers: maxPlayersFrom(body.variables, body.config),
              }
            ).catch(() => {});
          } else {
            discord = { error: result.error };
            console.warn(`[discord] channel provisioning failed for "${name}": ${result.error}`);
          }
        }
      } catch (e: unknown) {
        // Never let Discord break server creation.
        discord = { error: e instanceof Error ? e.message : "Discord provisioning failed" };
        console.warn("[discord] provisioning threw:", discord.error);
      }
    }

    return NextResponse.json({ server, discord }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}

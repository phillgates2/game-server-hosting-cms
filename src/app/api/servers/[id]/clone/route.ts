import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { inheritedWebhook, shouldProvisionForClone, validatePorts, withinServerQuota, nextFreePort } from "@/lib/server-lifecycle";

// POST /api/servers/[id]/clone — Clone a server with all settings
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.clone"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [source] = await db
      .select()
      .from(gameServers)
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!source) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && source.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const newName = body.name || `${source.name} (Clone)`;

    // Clone is a create: it must respect the same quota, or a user at their
    // limit could simply clone past it.
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

    // installPath is deliberately NOT taken from the body: the process route
    // executes a script under it, so it is server-owned, exactly as it is on
    // the update path.
    const newPath = `${source.installPath}-clone`;

    // Validate the clone's ports against everything else on the same node.
    const siblings = source.nodeId
      ? await db
          .select({ port: gameServers.port, queryPort: gameServers.queryPort, rconPort: gameServers.rconPort })
          .from(gameServers)
          .where(eq(gameServers.nodeId, source.nodeId))
      : [];
    const takenPorts = siblings.flatMap((s) =>
      [s.port, s.queryPort, s.rconPort].filter((n): n is number => typeof n === "number")
    );

    // An explicit port is honoured (and validated); otherwise search for a
    // free block rather than blindly taking source.port + 1, which is usually
    // the source's own query port.
    const span = source.rconPort ? 3 : 2;
    const requestedPort =
      body.port ?? nextFreePort(source.port + 1, takenPorts, span) ?? source.port + 1;
    const portCheck = validatePorts(
      {
        port: requestedPort,
        queryPort: Number(requestedPort) + 1,
        rconPort: source.rconPort ? Number(requestedPort) + 2 : null,
      },
      takenPorts
    );
    if (portCheck.error !== null || portCheck.ports === null) {
      return NextResponse.json({ error: portCheck.error }, { status: 400 });
    }
    const newPort = portCheck.ports.port;

    const [clone] = await db.insert(gameServers).values({
      userId: auth.userId,
      nodeId: source.nodeId,
      gameId: source.gameId,
      name: newName,
      ipv4: source.ipv4,
      ipv6: source.ipv6,
      port: newPort,
      queryPort: portCheck.ports.queryPort,
      rconPort: portCheck.ports.rconPort,
      installPath: newPath,
      status: "stopped",
      config: source.config,
      variables: source.variables,
      autoRestart: source.autoRestart,
      autoStart: false,
      maxRamMb: source.maxRamMb,
      maxCpuPercent: source.maxCpuPercent,
      // Deliberately NOT copying discordWebhook when the source's channel was
      // provisioned by the panel: the clone would post into a channel it does
      // not own, and deleting the source would destroy that channel while the
      // clone kept pointing at it. A hand-entered webhook is safe to share.
      discordWebhook: inheritedWebhook(source),
      discordNotifyStart: source.discordNotifyStart,
      discordNotifyStop: source.discordNotifyStop,
      discordNotifyRestart: source.discordNotifyRestart,
      discordNotifyCrash: source.discordNotifyCrash,
    }).returning();

    // Give the clone its own channel, mirroring what happens on create.
    let discord: { channel?: string; error?: string } | undefined;
    if (!clone.discordWebhook) {
      try {
        const { getDiscordSettings } = await import("@/lib/discord-settings");
        const cfg = await getDiscordSettings();
        if (shouldProvisionForClone(clone.discordWebhook, cfg)) {
          const { provisionServerChannel } = await import("@/lib/discord");
          const result = await provisionServerChannel(
            { token: cfg.botToken, guildId: cfg.guildId, categoryId: cfg.categoryId || null },
            newName,
            { prefix: cfg.channelPrefix }
          );
          if (result.ok && result.webhookUrl) {
            await db.update(gameServers)
              .set({ discordWebhook: result.webhookUrl, discordChannelId: result.channelId })
              .where(eq(gameServers.id, clone.id));
            clone.discordWebhook = result.webhookUrl;
            clone.discordChannelId = result.channelId ?? null;
            discord = { channel: result.channelName };
          } else {
            discord = { error: result.error };
          }
        }
      } catch (e: unknown) {
        // Never fail a clone because Discord is unavailable.
        discord = { error: e instanceof Error ? e.message : "Discord provisioning failed" };
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Cloned "${source.name}" as "${newName}". Run Install Files on the clone to set up game files.`,
      server: clone,
      discord,
    }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Clone failed", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, gameServers, gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { eq } from "drizzle-orm";
import { getDiscordSettings } from "@/lib/discord-settings";
import {
  refreshServerBoard,
  clampInterval,
  type ServerForBoard,
} from "@/lib/status-board";

/** Admin only: the board controls what is posted into a guild's channels. */
async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return null;
  return (await hasPermission(auth.userId, "panel.settings")) ? auth : null;
}

async function listBoards() {
  const rows = await db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      ipv4: gameServers.ipv4,
      ipv6: gameServers.ipv6,
      port: gameServers.port,
      queryPort: gameServers.queryPort,
      variables: gameServers.variables,
      config: gameServers.config,
      status: gameServers.status,
      discordWebhook: gameServers.discordWebhook,
      discordStatusEnabled: gameServers.discordStatusEnabled,
      discordStatusMessageId: gameServers.discordStatusMessageId,
      discordStatusUpdatedAt: gameServers.discordStatusUpdatedAt,
      discordStatusError: gameServers.discordStatusError,
      gameName: gameDefinitions.name,
      gameSlug: gameDefinitions.slug,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .orderBy(gameServers.name);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    gameName: r.gameName || "Unknown",
    status: r.status,
    hasWebhook: Boolean(r.discordWebhook),
    enabled: Boolean(r.discordStatusEnabled),
    messageId: r.discordStatusMessageId,
    updatedAt: r.discordStatusUpdatedAt,
    error: r.discordStatusError,
  }));
}

/**
 * GET /api/settings/discord/boards
 *
 * Every server with its board state plus the refresh interval, so the panel
 * can render the status board section in one round trip.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
  try {
    const { statusIntervalMinutes } = await getDiscordSettings();
    return NextResponse.json({ intervalMinutes: statusIntervalMinutes, servers: await listBoards() });
  } catch (e: unknown) {
    return apiError(e, "Could not read status board state", 500);
  }
}

/**
 * POST /api/settings/discord/boards
 *
 * Body: { serverId, action: "enable" | "disable" | "refresh" }
 *   enable   posts the board message and turns on the auto-update loop
 *   disable  stops updates (the message is left where it is)
 *   refresh  probes and updates right now
 * Body: { action: "interval", minutes } sets the refresh interval.
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const action = typeof body.action === "string" ? body.action : "";

    // ── Interval (panel-wide) ────────────────────────────────────────────────
    if (action === "interval") {
      const minutes = clampInterval(body.minutes);
      const key = "discord_status_interval_minutes";
      const value = String(minutes);
      const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (existing) {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value });
      }
      return NextResponse.json({ ok: true, intervalMinutes: minutes });
    }

    const serverId = Number(body.serverId);
    if (!Number.isInteger(serverId) || serverId <= 0) {
      return NextResponse.json({ error: "serverId is required" }, { status: 400 });
    }
    if (action !== "enable" && action !== "disable" && action !== "refresh") {
      return NextResponse.json({ error: "action must be enable, disable, refresh or interval" }, { status: 400 });
    }

    const [server] = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ipv4: gameServers.ipv4,
        ipv6: gameServers.ipv6,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        variables: gameServers.variables,
        config: gameServers.config,
        status: gameServers.status,
        discordWebhook: gameServers.discordWebhook,
        discordStatusEnabled: gameServers.discordStatusEnabled,
        discordStatusMessageId: gameServers.discordStatusMessageId,
        discordStatusUpdatedAt: gameServers.discordStatusUpdatedAt,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, serverId))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

    if (action === "disable") {
      await db
        .update(gameServers)
        .set({ discordStatusEnabled: false, discordStatusError: null, updatedAt: new Date() })
        .where(eq(gameServers.id, serverId));
      return NextResponse.json({ ok: true, servers: await listBoards() });
    }

    if (action === "enable") {
      if (!server.discordWebhook) {
        return NextResponse.json(
          { error: "This server has no Discord webhook — run ‘Create missing channels’ (a bot token + server ID are required) or set a webhook on the server" },
          { status: 400 }
        );
      }
      // Post the first board message now so the operator sees it immediately;
      // the background loop takes over afterwards.
      const result = await refreshServerBoard(server as ServerForBoard);
      await db
        .update(gameServers)
        .set({
          discordStatusEnabled: true,
          discordStatusMessageId: result.messageId ?? null,
          discordStatusUpdatedAt: result.ok ? new Date() : null,
          discordStatusError: result.error ?? null,
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, serverId));
      return NextResponse.json({ ok: result.ok, error: result.error ?? undefined, servers: await listBoards() });
    }

    // refresh — only meaningful when the board is on; refresh anyway so the
    // button can repair a board that stopped updating.
    const result = await refreshServerBoard(server as ServerForBoard);
    await db
      .update(gameServers)
      .set({
        discordStatusMessageId: result.messageId ?? server.discordStatusMessageId,
        discordStatusUpdatedAt: result.ok ? new Date() : server.discordStatusUpdatedAt ?? null,
        discordStatusError: result.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(gameServers.id, serverId));
    return NextResponse.json({ ok: result.ok, error: result.error ?? undefined, servers: await listBoards() });
  } catch (e: unknown) {
    return apiError(e, "Status board update failed", 500);
  }
}

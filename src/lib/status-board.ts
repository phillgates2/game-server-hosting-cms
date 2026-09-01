/**
 * Live Discord status boards.
 *
 * One message per server, pinned-like in its own channel, that answers the
 * two questions operators care about (is it up, who is on it) and keeps
 * itself current: a background loop re-probes each enabled server at a
 * configurable interval and edits the board message in place. Webhooks can
 * edit their own messages, so this needs no bot gateway — just the webhook
 * every server already has.
 *
 * Everything is best-effort: a failing probe shows the server as offline (or
 * unknown when the process is up but the query port is firewalled), a deleted
 * board message is re-posted, and a deleted channel disables the board with
 * an operator-readable error.
 *
 * Pure embed helpers live in status-board-embed.ts so tests can drive the
 * layout without a database; everything here is the transport + the loop.
 */

import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidWebhookUrl, statusChannelName } from "@/lib/discord";
import { createLogger } from "@/lib/logger";
import type { PlayerProbe } from "@/lib/players";
import {
  clampInterval,
  messageEndpoint,
  buildStatusBoardPayload,
  type BoardView,
  type ServerForBoard,
} from "./status-board-embed";

export {
  clampInterval,
  messageEndpoint,
  stripColorCodes,
  buildStatusBoardEmbed,
  buildStatusBoardPayload,
  MAX_LISTED_PLAYERS,
  MAX_EMBED_FIELD_LENGTH,
  STATUS_DEFAULT_INTERVAL_MINUTES,
  STATUS_MIN_INTERVAL_MINUTES,
  STATUS_MAX_INTERVAL_MINUTES,
} from "./status-board-embed";
export type { BoardView, BoardEmbed, BoardMessagePayload, ServerForBoard } from "./status-board-embed";

const log = createLogger("status-board");

const TICK_MS = 60_000;
const MAX_BOARDS_PER_TICK = 5;
// ── Webhook transport (webhook-token auth; no bot gateway needed) ────────────

async function webhookRequest(
  url: string,
  init: RequestInit
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; gone?: boolean; error: string; status?: number }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // 404 on PATCH = message deleted; on POST = webhook deleted (channel gone).
      return {
        ok: false,
        gone: res.status === 404,
        status: res.status,
        error: res.status === 429
          ? `Rate limited (retry-after: ${res.headers.get("retry-after") ?? "?"}s)`
          : text.slice(0, 200) || `HTTP ${res.status}`,
      };
    }
    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

async function postBoardMessage(
  webhookUrl: string,
  view: BoardView
): Promise<{ ok: boolean; messageId?: string; error?: string; status?: number }> {
  const res = await webhookRequest(webhookUrl, {
    method: "POST",
    body: JSON.stringify(buildStatusBoardPayload(view)),
  });
  if (!res.ok) return { ok: false, error: res.error, status: res.status };
  const id = String(res.data.id ?? "");
  return id ? { ok: true, messageId: id } : { ok: false, error: "Discord did not return a message id" };
}

async function editBoardMessage(
  webhookUrl: string,
  messageId: string,
  view: BoardView
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const endpoint = messageEndpoint(webhookUrl, messageId);
  if (!endpoint) return { ok: false, error: "Stored message id is invalid" };
  const res = await webhookRequest(endpoint, {
    method: "PATCH",
    body: JSON.stringify(buildStatusBoardPayload(view)),
  });
  if (!res.ok) return { ok: false, gone: res.gone, error: res.error };
  return { ok: true };
}

// ── Refresh (used by both the loop and the panel button) ─────────────────────



/** Probe + build the view for one server. Never throws. */
export async function boardViewFor(server: Omit<ServerForBoard, "discordStatusEnabled" | "discordStatusMessageId">): Promise<BoardView> {
  const { probePlayers } = await import("@/lib/players");
  const probe: PlayerProbe = await probePlayers({
    gameSlug: server.gameSlug ?? "",
    host: server.ipv4 ?? "127.0.0.1",
    port: server.port,
    queryPort: server.queryPort,
    attempts: 1,
  });

  const online = server.status === "running";
  return {
    serverName: server.name,
    gameName: server.gameName || "Unknown",
    address: server.ipv4 ? `\`${server.ipv4}:${server.port}\`` : server.ipv6 ? `\`[${server.ipv6}]:${server.port}\`` : `Port \`${server.port}\``,
    online,
    map: probe.map,
    players: probe.players,
    maxPlayers: probe.maxPlayers,
    names: probe.names,
    pings: probe.pings,
    hostname: probe.hostname,
    probeFailed: !probe.ok && online,
  };
}

/**
 * Refresh one server's board: edit the stored message, re-post when it was
 * deleted, disable when the webhook itself is gone. Returns board state.
 */
export async function refreshServerBoard(server: ServerForBoard): Promise<{
  ok: boolean;
  messageId?: string | null;
  error?: string | null;
  view?: BoardView;
}> {
  if (!server.discordWebhook || !isValidWebhookUrl(server.discordWebhook)) {
    return { ok: false, error: "No Discord webhook on this server — run ‘Create missing channels’ first" };
  }
  const view = await boardViewFor(server);

  if (server.discordStatusMessageId) {
    const edit = await editBoardMessage(server.discordWebhook, server.discordStatusMessageId, view);
    if (edit.ok) return { ok: true, messageId: server.discordStatusMessageId, view };
    if (!edit.gone) return { ok: false, messageId: server.discordStatusMessageId, error: edit.error, view };
    // Message deleted in Discord — fall through and re-post.
  }

  const post = await postBoardMessage(server.discordWebhook, view);
  return post.ok ? { ok: true, messageId: post.messageId, view } : { ok: false, error: post.error, view };
}

/** Last channel name we set per server, so a tick only PATCHes on change. */
const lastChannelName = new Map<number, string>();

/**
 * Keep a server's Discord channel name current (WolfET style). Best-effort:
 * a permission problem must never disable the board or break the tick.
 */
async function updateChannelName(
  server: { id: number; name: string; discordChannelId: string | null; gameSlug: string | null; gameName: string | null },
  view: BoardView
): Promise<void> {
  if (!server.discordChannelId) return;
  try {
    const label = server.gameSlug === "wolfenstein-et"
      ? "ET"
      : (server.gameName ?? "server").split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "server";
    const name = statusChannelName(view, label);
    if (lastChannelName.get(server.id) === name) return;

    const { getBotConfig } = await import("@/lib/discord-settings");
    const cfg = await getBotConfig();
    if (!cfg) return;

    const { renameChannel } = await import("@/lib/discord");
    const res = await renameChannel(cfg, server.discordChannelId, name);
    if (res.ok) lastChannelName.set(server.id, name);
    else log.warn(`channel rename for "${server.name}" failed`, { error: res.error });
  } catch (e: unknown) {
    log.warn(`channel rename for "${server.name}" threw`, { error: e instanceof Error ? e.message : String(e) });
  }
}

// ── Background loop ──────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | null = null;
let ticking = false;

/** Start the periodic updater; idempotent. Returns a stop handle. */
export function startStatusBoardUpdater(): () => void {
  if (timer) return () => stopStatusBoardUpdater();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  void tick();
  return () => stopStatusBoardUpdater();
}

export function stopStatusBoardUpdater(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** One pass: refresh boards whose interval has elapsed. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { getDiscordSettings } = await import("@/lib/discord-settings");
    const intervalMs = clampInterval((await getDiscordSettings()).statusIntervalMinutes) * 60_000;

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
        discordChannelId: gameServers.discordChannelId,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.discordStatusEnabled, true))
      .limit(200);

    const cutoff = new Date(Date.now() - intervalMs);
    const due = rows.filter((r) => !r.discordStatusUpdatedAt || r.discordStatusUpdatedAt < cutoff).slice(0, MAX_BOARDS_PER_TICK);

    for (const server of due) {
      try {
        const result = await refreshServerBoard(server);
        await db
          .update(gameServers)
          .set({
            discordStatusMessageId: result.messageId ?? server.discordStatusMessageId,
            discordStatusUpdatedAt: result.ok ? new Date() : server.discordStatusUpdatedAt,
            discordStatusError: result.error ?? null,
          })
          .where(eq(gameServers.id, server.id));

        // Share the freshest probe with the chat bot's !etwho / !etallofoz.
        if (result.view) {
          const { setCachedView } = await import("./status-cache");
          setCachedView(server.id, result.view);
        }

        if (!result.ok) {
          log.warn(`status board for "${server.name}" failed`, { error: result.error });
          // A dead webhook will never come back on its own.
          if (/webhook|channel|invalid/i.test(result.error ?? "")) {
            await db
              .update(gameServers)
              .set({ discordStatusEnabled: false, discordStatusError: result.error ?? null })
              .where(eq(gameServers.id, server.id));
          }
        }

        // WolfET-style: keep the channel name itself current, not just the
        // board message. Best-effort and rate-light — only when the name
        // actually changes, and failures never disable the board.
        if (server.discordChannelId && result.view) {
          await updateChannelName(server, result.view);
        }
      } catch (e: unknown) {
        log.warn(`status board for "${server.name}" threw`, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e: unknown) {
    log.warn("status board tick skipped", { error: e instanceof Error ? e.message : String(e) });
  } finally {
    ticking = false;
  }
}

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
 * The same loop also keeps each server's *channel name* current — the
 * WolfET-style `🟢 et: (5) - et_beach` / `🔴 et: Server Offline` heading. That
 * part is deliberately independent of the board toggle and of the board
 * message: it needs the bot token (a webhook cannot rename a channel), not a
 * webhook, and operators who never pressed "Post board" still expect the
 * channel they were given to say whether their server is up.
 *
 * Pure embed helpers live in status-board-embed.ts so tests can drive the
 * layout without a database; everything here is the transport + the loop.
 */

import { db } from "@/db";
import { gameServers, gameDefinitions } from "@/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { isValidWebhookUrl, statusChannelName, statusChannelLabel } from "@/lib/discord";
import { createLogger } from "@/lib/logger";
import type { PlayerProbe } from "@/lib/players";
import { getCachedView } from "./status-cache";
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
export { statusChannelName, statusChannelLabel, truncateChannelName } from "@/lib/discord";

const log = createLogger("status-board");

const TICK_MS = 60_000;
const MAX_BOARDS_PER_TICK = 5;
// Channel renames per tick, fleet-wide. A rename costs a game query (for the
// count and map) plus a Discord call, and each is capped by its own timeout, so
// a large fleet converges over several ticks instead of stalling one tick.
const MAX_HEADING_SYNCS_PER_TICK = 10;
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
  // Discord webhook POSTs default to wait=false, which answers 204 with NO
  // body — so without ?wait=true there is no message id to remember, and the
  // board can never update itself again. wait=true returns the full message.
  const postUrl = `${webhookUrl.replace(/\/+$/, "")}?wait=true`;
  const res = await webhookRequest(postUrl, {
    method: "POST",
    body: JSON.stringify(buildStatusBoardPayload(view)),
  });
  if (!res.ok) return { ok: false, error: res.error, status: res.status };
  const id = String(res.data.id ?? "");
  if (!id) {
    return {
      ok: false,
      error:
        "Discord did not return a message id (a webhook proxy or the channel's webhook may be blocking ?wait=true) — check the webhook URL",
    };
  }
  return { ok: true, messageId: id };
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



/** The columns a live view needs — boards and channel headings share these. */
export interface ServerForProbe {
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  port: number;
  queryPort: number | null;
  status: string;
  gameName: string | null;
  gameSlug: string | null;
}

/** Probe + build the view for one server. Never throws. */
export async function boardViewFor(server: ServerForProbe): Promise<BoardView> {
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
  // Annotate verified players with their Discord role color name. Optional:
  // without a gateway connection the map stays empty and nothing changes.
  try {
    if (view.online && view.names && view.names.length > 0) {
      const { rosterRoleColors } = await import("./discord-bot");
      view.roleColors = await rosterRoleColors(view.names);
    }
  } catch {
    // never let annotation break a board refresh
  }

  if (server.discordStatusMessageId) {
    const edit = await editBoardMessage(server.discordWebhook, server.discordStatusMessageId, view);
    if (edit.ok) return { ok: true, messageId: server.discordStatusMessageId, view };
    if (!edit.gone) return { ok: false, messageId: server.discordStatusMessageId, error: edit.error, view };
    // Message deleted in Discord — fall through and re-post.
  }

  const post = await postBoardMessage(server.discordWebhook, view);
  return post.ok ? { ok: true, messageId: post.messageId, view } : { ok: false, error: post.error, view };
}

// ── Channel heading (the 🟢/🔴 in the channel name) ──────────────────────────
//
// The heading is deliberately NOT a side effect of the board message: an
// operator who never pressed "Post board" (or who stopped the board) still
// expects the channel to say whether the server is up, exactly like the
// community bot does. Proving a server is up needs no webhook and no message —
// only the bot token that renamed the channel in the first place.
//
// Discord allows two renames per ten minutes per channel, so the policy is:
// an up/down change is applied at once; a changed player count or map waits
// for the cool-down. Anything else turns into a 429 that leaves the heading
// stale, which is the bug this whole section exists to avoid.

/** Discord's rename budget: two per channel per ten minutes. */
export const CHANNEL_RENAME_COOLDOWN_MS = 10 * 60_000;
/**
 * How long to leave a heading alone after Discord refused the rename. A
 * permission problem or a deleted channel will not fix itself in a minute, and
 * retrying every tick is how a fleet gets rate-limited into silence.
 */
export const CHANNEL_RENAME_RETRY_MS = 10 * 60_000;

/** One server's heading, as the loop and the panel see it. */
export interface ChannelHeadingState {
  /** The name the panel last applied (or found already correct). */
  name?: string;
  /** The up/down state that name carries. */
  online?: boolean;
  /** When the name was last known to be current. */
  renamedAt?: number;
  /** No further attempt before this — Discord's retry-after, or our backoff. */
  blockedUntil?: number;
  /** Last failure, surfaced in the panel so a silent 403 is diagnosable. */
  error?: string | null;
}

/** In-process heading state, keyed by server id (single-process by design). */
const headings = new Map<number, ChannelHeadingState>();

function headingState(serverId: number): ChannelHeadingState {
  const existing = headings.get(serverId);
  if (existing) return existing;
  const fresh: ChannelHeadingState = {};
  headings.set(serverId, fresh);
  return fresh;
}

/** What the panel knows about a server's heading right now. */
export function channelHeadingState(serverId: number): ChannelHeadingState {
  return { ...(headings.get(serverId) ?? {}) };
}

/** Test hook: forget everything remembered about headings. */
export function resetChannelHeadingState(): void {
  headings.clear();
}

export type HeadingDue = "status" | "refresh" | null;

/**
 * Whether a channel heading needs a rename.
 *
 * Pure so the policy is unit-tested rather than discovered against Discord:
 *  - `"status"` — the server went up or down (or we have never seen it): send
 *    the rename now, the cool-down does not apply. This is the one the
 *    operator is watching for.
 *  - `"refresh"` — the up/down is unchanged, but the count/map in the name may
 *    have drifted and the cool-down has passed.
 *  - `null` — leave it; nothing changed, or Discord asked us to back off.
 */
export function headingDue(
  state: Pick<ChannelHeadingState, "online" | "renamedAt" | "blockedUntil">,
  online: boolean,
  now: number,
  cooldownMs: number = CHANNEL_RENAME_COOLDOWN_MS
): HeadingDue {
  if (state.blockedUntil && now < state.blockedUntil) return null;
  if (state.online === undefined || state.online !== online) return "status";
  if (state.renamedAt === undefined || now - state.renamedAt >= cooldownMs) return "refresh";
  return null;
}

export interface ChannelHeadingResult {
  ok: boolean;
  /** The name the channel heading carries (or would carry). */
  name?: string;
  /** True when a rename was actually sent and accepted by Discord. */
  renamed?: boolean;
  /** Set when the panel chose not to call Discord. */
  skipped?: "no-channel" | "no-bot" | "unchanged" | "cooldown" | "backoff" | "probe-failed";
  error?: string;
}

/** The columns a heading needs. */
export interface ServerForHeading {
  id: number;
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  port: number;
  queryPort: number | null;
  variables: unknown;
  config: unknown;
  status: string;
  gameName: string | null;
  gameSlug: string | null;
  discordChannelId: string | null;
}

/** A down server's heading needs no probe — there is nothing to query. */
function offlineHeadingView(server: ServerForHeading): BoardView {
  return {
    serverName: server.name,
    gameName: server.gameName || "Unknown",
    address: server.ipv4
      ? `\`${server.ipv4}:${server.port}\``
      : server.ipv6
        ? `\`[${server.ipv6}]:${server.port}\``
        : `Port \`${server.port}\``,
    online: false,
  };
}

/**
 * Keep a server's Discord channel name current (WolfET style).
 *
 * Best-effort by design: a missing bot token, a permission problem or a
 * deleted channel is reported to the panel and never thrown at the caller, so
 * a heading can never break a board refresh, a start/stop or the tick.
 */
export async function syncChannelHeading(
  server: ServerForHeading,
  opts: { force?: boolean; view?: BoardView; now?: number } = {}
): Promise<ChannelHeadingResult> {
  if (!server.discordChannelId) return { ok: true, skipped: "no-channel" };

  const state = headingState(server.id);
  // `opts.now` is a clock seam for the tests (the cool-down is ten minutes
  // long); production callers never pass it.
  const now = opts.now ?? Date.now();
  const online = server.status === "running";

  // A backoff (Discord's retry-after, or our own after a refusal) always wins:
  // hammering a channel Discord has told us to leave alone only makes it worse.
  if (state.blockedUntil && now < state.blockedUntil) return { ok: true, skipped: "backoff" };
  const due = opts.force ? "status" : headingDue(state, online, now);
  if (!due) return { ok: true, skipped: "cooldown" };

  try {
    const { getBotConfig } = await import("@/lib/discord-settings");
    const cfg = await getBotConfig();
    if (!cfg) {
      // Webhooks cannot rename a channel; without a bot the panel can only say so.
      state.error = null;
      return { ok: true, skipped: "no-bot" };
    }

    // A down server needs no query. An up one reuses the freshest view the
    // board loop or a chat command already paid for, and only probes itself
    // when there is nothing cached.
    const view = opts.view
      ?? (online ? (getCachedView(server.id) ?? (await boardViewFor(server))) : offlineHeadingView(server));

    // A query port that did not answer is not a status change. When the dot
    // on screen is already the right one, keep the count and map the operator
    // has rather than downgrading a good heading to "(?) - unknown-map" — and
    // spending one of the channel's two renames on it. The next refresh picks
    // the real figures up. A dot that is missing or wrong is still written,
    // because "is it up?" is what the heading is for; the players are shown as
    // unknown rather than invented.
    const dotUnchanged = state.name !== undefined && state.online === online;
    if (dotUnchanged && online && view.players === undefined) {
      state.renamedAt = now;
      return { ok: true, skipped: "probe-failed", name: state.name };
    }

    const name = statusChannelName(view, statusChannelLabel(server.gameSlug, server.gameName));

    if (state.name === name) {
      // Already right (a previous rename survived, or someone set it by hand):
      // treat it as current so the next drift check waits for the cool-down.
      state.online = online;
      state.renamedAt = now;
      state.error = null;
      return { ok: true, skipped: "unchanged", name };
    }

    const { renameChannel } = await import("@/lib/discord");
    const res = await renameChannel(cfg, server.discordChannelId, name);
    if (res.ok) {
      state.name = res.name;
      state.online = online;
      state.renamedAt = now;
      state.blockedUntil = undefined;
      state.error = null;
      return { ok: true, renamed: true, name: res.name };
    }

    state.blockedUntil = now + (res.retryAfterMs ?? CHANNEL_RENAME_RETRY_MS);
    state.error = res.error ?? "Discord refused the rename";
    log.warn(`channel heading for "${server.name}" failed`, { error: state.error });
    return { ok: false, error: state.error, name };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    state.blockedUntil = now + CHANNEL_RENAME_RETRY_MS;
    state.error = message;
    log.warn(`channel heading for "${server.name}" threw`, { error: message });
    return { ok: false, error: message };
  }
}

/**
 * Bring one server's heading up to date by id — the hook lifecycle code calls
 * the moment a server starts, stops or crashes, so the channel name is right
 * when the operator looks at it rather than on the next tick.
 *
 * Never throws: it runs in the middle of process control.
 */
export async function refreshChannelHeading(serverId: number, opts: { force?: boolean } = {}): Promise<void> {
  try {
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
        discordChannelId: gameServers.discordChannelId,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, serverId))
      .limit(1);

    if (!server) return;
    await syncChannelHeading(server, { force: opts.force ?? true });
  } catch (e: unknown) {
    log.warn("channel heading refresh skipped", { error: e instanceof Error ? e.message : String(e) });
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

/**
 * One pass over every server the panel owns a channel for, renaming the ones
 * whose heading is out of date.
 *
 * Deliberately independent of the boards: this is what makes a channel say
 * "🟢 …" or "🔴 …" for an operator who never enabled a board, and it keeps
 * saying it after the board is stopped. Up/down changes are handled first so a
 * large fleet's budget is spent on the transitions people watch, not on
 * player-count churn.
 */
async function syncChannelHeadings(): Promise<void> {
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
      discordChannelId: gameServers.discordChannelId,
      gameName: gameDefinitions.name,
      gameSlug: gameDefinitions.slug,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .where(isNotNull(gameServers.discordChannelId))
    .orderBy(gameServers.id)
    .limit(500);

  if (rows.length === 0) return;

  const now = Date.now();
  const wanted = rows
    .map((server) => ({ server, due: headingDue(headingState(server.id), server.status === "running", now) }))
    .filter((r) => r.due !== null)
    // Status changes first: a server that just went up or down is the thing
    // the heading exists for.
    .sort((a, b) => (a.due === b.due ? 0 : a.due === "status" ? -1 : 1));

  for (const { server } of wanted.slice(0, MAX_HEADING_SYNCS_PER_TICK)) {
    await syncChannelHeading(server);
  }
}

/** One pass: refresh boards whose interval has elapsed, then the headings. */
export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const { getBotConfig, getDiscordSettings } = await import("@/lib/discord-settings");
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

        // WolfET-style: keep the channel name itself current too. The board
        // probe already answered "who is on it", so hand the heading that view
        // rather than paying for a second query. Best-effort like the rest.
        if (server.discordChannelId && result.view) {
          await syncChannelHeading(server, { view: result.view });
        }
      } catch (e: unknown) {
        log.warn(`status board for "${server.name}" threw`, { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ── Channel headings, board or no board ──────────────────────────────────
    // An operator who never enabled a board still expects the channel to say
    // whether their server is up: that is the whole point of the heading, and
    // it needs no webhook (a webhook cannot rename a channel — only the bot
    // can). Skipped entirely when no bot token is configured.
    if (await getBotConfig()) {
      try {
        await syncChannelHeadings();
      } catch (e: unknown) {
        log.warn("channel heading pass skipped", { error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e: unknown) {
    log.warn("status board tick skipped", { error: e instanceof Error ? e.message : String(e) });
  } finally {
    ticking = false;
  }
}

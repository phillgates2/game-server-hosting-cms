// Discord Webhook Integration for Game Server Notifications

export type WebhookEvent = 
  | "server_created"
  | "server_started"
  | "server_stopped"
  | "server_restarted"
  | "server_crashed"
  | "server_deleted"
  | "server_updated"
  | "server_installed"
  | "server_backup"
  | "server_cloned"
  | "user_login"
  | "user_registered"
  | "player_joined"
  | "player_left";

interface WebhookPayload {
  serverName: string;
  gameName: string;
  gameIcon?: string;
  ipv4?: string | null;
  ipv6?: string | null;
  port: number;
  event: WebhookEvent;
  message?: string;
  playerCount?: number;
  maxPlayers?: number;
  extra?: Record<string, string | number>;
}

const EVENT_COLORS: Record<WebhookEvent, number> = {
  server_created: 0x22c55e,   // Green
  server_started: 0x3b82f6,   // Blue
  server_stopped: 0xf59e0b,   // Amber
  server_restarted: 0xa855f7, // Purple
  server_crashed: 0xef4444,   // Red
  server_deleted: 0x64748b,   // Gray
  server_updated: 0x06b6d4,   // Cyan
  server_installed: 0x06b6d4, // Cyan
  server_backup: 0x8b5cf6,   // Violet
  server_cloned: 0x14b8a6,   // Teal
  user_login: 0x6366f1,      // Indigo
  user_registered: 0x22d3ee, // Sky
  player_joined: 0x10b981,    // Emerald
  player_left: 0xf97316,      // Orange
};

const EVENT_TITLES: Record<WebhookEvent, string> = {
  server_created: "🆕 Server Created",
  server_started: "▶️ Server Started",
  server_stopped: "⏹️ Server Stopped",
  server_restarted: "🔄 Server Restarted",
  server_crashed: "💥 Server Crashed",
  server_deleted: "🗑️ Server Deleted",
  server_updated: "📝 Server Updated",
  server_installed: "📥 Files Installed",
  server_backup: "💾 Backup Created",
  server_cloned: "📑 Server Cloned",
  user_login: "🔑 User Login",
  user_registered: "📝 User Registered",
  player_joined: "👋 Player Joined",
  player_left: "👋 Player Left",
};

/**
 * Discord accepts webhooks on two hostnames, and both are handed out by the
 * client depending on age and platform. Rejecting the legacy one silently
 * breaks perfectly valid webhooks.
 */
const WEBHOOK_URL_RE =
  /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** True when the string is a usable Discord webhook endpoint. */
export function isValidWebhookUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && WEBHOOK_URL_RE.test(url.trim());
}

/**
 * Pick the webhook to use for a server.
 *
 * A per-server webhook wins; otherwise fall back to DISCORD_WEBHOOK_URL, which
 * .env.example and the README have always documented as the panel-wide default
 * but which nothing actually read.
 */
export function resolveWebhookUrl(serverWebhook?: string | null): string | null {
  const perServer = serverWebhook?.trim() || "";
  if (isValidWebhookUrl(perServer)) return perServer;

  // A malformed per-server value should not silence notifications entirely -
  // fall through to the panel-wide webhook rather than returning nothing.
  const global = process.env.DISCORD_WEBHOOK_URL?.trim() || "";
  return isValidWebhookUrl(global) ? global : null;
}

export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  if (!isValidWebhookUrl(webhookUrl)) {
    return { success: false, error: "Invalid Discord webhook URL" };
  }

  const connectionString = payload.ipv4 
    ? `\`${payload.ipv4}:${payload.port}\``
    : payload.ipv6 
      ? `\`[${payload.ipv6}]:${payload.port}\``
      : `Port \`${payload.port}\``;

  const fields = [
    { name: "🎮 Game", value: payload.gameName, inline: true },
    { name: "🌐 Connection", value: connectionString, inline: true },
  ];

  if (payload.playerCount !== undefined) {
    fields.push({
      name: "👥 Players",
      value: `${payload.playerCount}${payload.maxPlayers ? `/${payload.maxPlayers}` : ""}`,
      inline: true,
    });
  }

  if (payload.extra) {
    for (const [key, value] of Object.entries(payload.extra)) {
      fields.push({ name: key, value: String(value), inline: true });
    }
  }

  const embed = {
    title: EVENT_TITLES[payload.event],
    description: payload.message || `**${payload.serverName}**`,
    color: EVENT_COLORS[payload.event],
    fields,
    thumbnail: {
      url: getGameThumbnail(payload.gameName),
    },
    footer: {
      text: "GameServer Manager",
    },
    timestamp: new Date().toISOString(),
  };

  const discordPayload = {
    username: "GameServer Manager",
    embeds: [embed],
  };

  try {
    // Discord occasionally stalls; without a deadline this keeps a panel
    // request open for the platform's default socket timeout.
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 429 carries a retry-after; surfacing it makes rate limiting diagnosable.
      const detail = res.status === 429 ? `rate limited (retry-after: ${res.headers.get("retry-after") ?? "?"}s)` : text.slice(0, 300);
      const error = `Discord API error: ${res.status} - ${detail}`;
      console.error(`[discord] ${payload.event} for "${payload.serverName}": ${error}`);
      return { success: false, error };
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[discord] ${payload.event} for "${payload.serverName}" failed: ${msg}`);
    return { success: false, error: msg };
  }
}

function getGameThumbnail(gameName: string): string {
  // Return game-specific thumbnails or a default
  const thumbnails: Record<string, string> = {
    "Minecraft": "https://i.imgur.com/QlZLJ0j.png",
    "Counter-Strike 2": "https://i.imgur.com/c7RCqBM.png",
    "Rust": "https://i.imgur.com/1SYuXGd.png",
    "ARK: Survival Evolved": "https://i.imgur.com/VuOH9Xz.png",
    "Valheim": "https://i.imgur.com/FEEbvXj.png",
    "7 Days to Die": "https://i.imgur.com/B8b8Y5K.png",
    "Garry's Mod": "https://i.imgur.com/qM4E8Yp.png",
    "Team Fortress 2": "https://i.imgur.com/QY4O9Rw.png",
  };
  return thumbnails[gameName] || "https://i.imgur.com/AfFp7pu.png";
}

// Queue for rate limiting Discord webhooks
const webhookQueue: Array<{ url: string; payload: WebhookPayload }> = [];
let isProcessingQueue = false;

export function queueDiscordWebhook(webhookUrl: string, payload: WebhookPayload) {
  webhookQueue.push({ url: webhookUrl, payload });
  processQueue();
}

async function processQueue() {
  if (isProcessingQueue || webhookQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (webhookQueue.length > 0) {
    const item = webhookQueue.shift();
    if (item) {
      await sendDiscordWebhook(item.url, item.payload);
      // Discord rate limit: ~30 requests per minute per webhook
      await new Promise((resolve) => setTimeout(resolve, 2100));
    }
  }
  
  isProcessingQueue = false;
}

// Helper to send common notifications
export async function notifyServerCreated(
  webhookUrl: string,
  serverName: string,
  gameName: string,
  gameIcon: string,
  ipv4: string | null,
  ipv6: string | null,
  port: number
) {
  return sendDiscordWebhook(webhookUrl, {
    serverName,
    gameName,
    gameIcon,
    ipv4,
    ipv6,
    port,
    event: "server_created",
    message: `**${serverName}** has been created and is ready to install!`,
  });
}

export async function notifyServerStarted(
  webhookUrl: string,
  serverName: string,
  gameName: string,
  ipv4: string | null,
  ipv6: string | null,
  port: number
) {
  return sendDiscordWebhook(webhookUrl, {
    serverName,
    gameName,
    ipv4,
    ipv6,
    port,
    event: "server_started",
    message: `**${serverName}** is now online and accepting connections!`,
  });
}

export async function notifyServerStopped(
  webhookUrl: string,
  serverName: string,
  gameName: string,
  port: number
) {
  return sendDiscordWebhook(webhookUrl, {
    serverName,
    gameName,
    port,
    event: "server_stopped",
    message: `**${serverName}** has been stopped.`,
  });
}

export async function notifyServerCrashed(
  webhookUrl: string,
  serverName: string,
  gameName: string,
  port: number,
  exitCode?: number
) {
  return sendDiscordWebhook(webhookUrl, {
    serverName,
    gameName,
    port,
    event: "server_crashed",
    message: `⚠️ **${serverName}** has crashed unexpectedly!`,
    extra: exitCode !== undefined ? { "Exit Code": exitCode } : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bot API — channel provisioning
//
//  A webhook URL can only POST messages into one already-existing channel. It
//  cannot create channels: that is POST /guilds/{id}/channels, which requires a
//  Bot token with MANAGE_CHANNELS. So "a channel per server" needs a bot
//  configured in addition to (or instead of) a plain webhook.
//
//  The flow per server is therefore:
//    1. create the channel in the configured category
//    2. create a webhook inside that channel
//    3. store that webhook on the server row, so every later notification uses
//       the ordinary webhook path and costs no bot calls
// ─────────────────────────────────────────────────────────────────────────────

const DISCORD_API = "https://discord.com/api/v10";

export interface BotConfig {
  token: string;
  guildId: string;
  /** Optional category (channel type 4) to nest new channels under. */
  categoryId?: string | null;
}

/** True when a bot token and guild id are both configured. */
export function isBotConfigured(cfg: Partial<BotConfig> | null | undefined): cfg is BotConfig {
  return Boolean(cfg?.token?.trim() && cfg?.guildId?.trim());
}

/**
 * Discord channel names are lowercased and stripped of most punctuation by the
 * API anyway; normalising up front means the stored name matches what people
 * actually see, and avoids a confusing rename on Discord's side.
 */
export function toChannelName(serverName: string, prefix = ""): string {
  const base = `${prefix}${serverName}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  // Discord allows 1-100 characters; fall back rather than send an empty name.
  return (base || "game-server").slice(0, 100);
}

async function discordApi(
  cfg: BotConfig,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${cfg.token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(10_000),
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // Map the failures an operator will actually hit onto actionable text,
      // rather than surfacing a bare numeric code.
      let error: string;
      switch (res.status) {
        case 401: error = "Invalid bot token"; break;
        case 403: error = "Bot lacks permission — it needs Manage Channels and Manage Webhooks in that server"; break;
        case 404: error = "Guild or category not found — check the server (guild) ID and that the bot has been invited"; break;
        case 429: error = `Rate limited by Discord (retry-after: ${res.headers.get("retry-after") ?? "?"}s)`; break;
        default:  error = `Discord API ${res.status}: ${text.slice(0, 200)}`;
      }
      console.error(`[discord] ${init.method || "GET"} ${path} failed: ${error}`);
      return { ok: false, error };
    }

    return { ok: true, data: text ? JSON.parse(text) : {} };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[discord] ${init.method || "GET"} ${path} threw: ${msg}`);
    return { ok: false, error: msg };
  }
}

/** Verify the bot token and guild, returning the guild name on success. */
export async function verifyBot(cfg: BotConfig): Promise<{ ok: boolean; guildName?: string; error?: string }> {
  const res = await discordApi(cfg, `/guilds/${encodeURIComponent(cfg.guildId)}`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, guildName: String(res.data.name ?? "") };
}

export interface ProvisionResult {
  ok: boolean;
  channelId?: string;
  channelName?: string;
  webhookUrl?: string;
  error?: string;
}

/**
 * Create a text channel for a server and a webhook inside it.
 *
 * Returns the webhook URL so the caller can store it on the server row; all
 * later notifications then go through the normal webhook path.
 */
export async function provisionServerChannel(
  cfg: BotConfig,
  serverName: string,
  opts: { prefix?: string; topic?: string } = {}
): Promise<ProvisionResult> {
  const name = toChannelName(serverName, opts.prefix ?? "");

  const channel = await discordApi(cfg, `/guilds/${encodeURIComponent(cfg.guildId)}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: 0, // GUILD_TEXT
      topic: opts.topic ?? `Status notifications for ${serverName} — GameServer Manager`,
      ...(cfg.categoryId ? { parent_id: cfg.categoryId } : {}),
    }),
  });
  if (!channel.ok) return { ok: false, error: channel.error };

  const channelId = String(channel.data.id ?? "");
  if (!channelId) return { ok: false, error: "Discord did not return a channel id" };

  const webhook = await discordApi(cfg, `/channels/${channelId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ name: "GameServer Manager" }),
  });
  if (!webhook.ok) {
    // The channel exists but is unusable without a webhook. Say so precisely
    // rather than reporting a generic failure.
    return {
      ok: false,
      channelId,
      channelName: name,
      error: `Channel #${name} was created but the webhook could not be: ${webhook.error}`,
    };
  }

  const token = String(webhook.data.token ?? "");
  const id = String(webhook.data.id ?? "");
  if (!id || !token) return { ok: false, error: "Discord did not return webhook credentials" };

  return {
    ok: true,
    channelId,
    channelName: name,
    webhookUrl: `https://discord.com/api/webhooks/${id}/${token}`,
  };
}

/** Delete a channel the panel created, used when its server is deleted. */
export async function deleteChannel(cfg: BotConfig, channelId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await discordApi(cfg, `/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Whether a channel the panel recorded still exists in Discord.
 *
 * Someone deleting a channel by hand leaves the panel holding a stale id and
 * a webhook that silently 404s on every send — webhook delivery deliberately
 * never throws, so nothing surfaces the breakage. The backfill uses this to
 * detect and repair that case.
 *
 * A 404 is a definite "gone". Any other failure (bad token, rate limit,
 * network) is reported as `unknown` so the caller can skip the server rather
 * than destroy a channel that is probably fine.
 */
export async function channelExists(
  cfg: BotConfig,
  channelId: string
): Promise<{ exists: boolean; unknown?: boolean; error?: string }> {
  const res = await discordApi(cfg, `/channels/${encodeURIComponent(channelId)}`);
  if (res.ok) return { exists: true };
  // discordApi maps 404 to this message for both guilds and channels.
  if (/not found/i.test(res.error)) return { exists: false };
  return { exists: false, unknown: true, error: res.error };
}

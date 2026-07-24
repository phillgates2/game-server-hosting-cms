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

export async function sendDiscordWebhook(
  webhookUrl: string,
  payload: WebhookPayload
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
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
      icon_url: "https://cdn.discordapp.com/emojis/1234567890.png",
    },
    timestamp: new Date().toISOString(),
  };

  const discordPayload = {
    username: "GameServer Manager",
    avatar_url: "https://i.imgur.com/4M34hi2.png",
    embeds: [embed],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Discord API error: ${res.status} - ${text}` };
    }

    return { success: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
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

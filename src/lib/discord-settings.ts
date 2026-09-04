import { db } from "@/db";
import { settings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { BotConfig } from "@/lib/discord";
import { DEFAULT_MASTER_URLS } from "./et-extra-servers";

/**
 * Panel-wide Discord configuration.
 *
 * Stored in the `settings` table rather than .env so it can be changed from
 * the UI without a redeploy. The bot token is a credential: it is deliberately
 * excluded from /api/site-settings' PUBLIC_KEYS, and the admin endpoint reports
 * only whether one is set, never its value.
 */

export const DISCORD_KEYS = [
  "discord_panel_webhook",
  "discord_bot_token",
  "discord_guild_id",
  "discord_category_id",
  "discord_auto_channel",
  "discord_channel_prefix",
  "discord_status_interval_minutes",
  "et_extra_servers",
  "et_master_urls",
] as const;

export interface DiscordSettings {
  /** Panel-wide webhook: fallback for servers with none of their own. */
  panelWebhook: string;
  botToken: string;
  guildId: string;
  categoryId: string;
  /** Create a channel automatically whenever a server is created. */
  autoChannel: boolean;
  /** Prefix applied to generated channel names, e.g. "gs-". */
  channelPrefix: string;
  /** How often live status boards refresh (minutes, clamped 1-60). */
  statusIntervalMinutes: number;
  /**
   * Extra ET servers for `!etallofoz` that are not installed in the panel —
   * one `host:port[:queryPort]` per line, '#' comments allowed.
   */
  extraServers: string;
  /**
   * ET master servers for `!etallofoz` discovery — `host[:port]` entries,
   * comma or space separated (default port 27950). Empty = no discovery.
   */
  masterUrls: string;
}

const DEFAULTS: DiscordSettings = {
  panelWebhook: "",
  botToken: "",
  guildId: "",
  categoryId: "",
  autoChannel: false,
  channelPrefix: "",
  statusIntervalMinutes: 3,
  extraServers: "",
  masterUrls: DEFAULT_MASTER_URLS,
};

/**
 * Read the Discord settings.
 *
 * Environment variables act as the base layer so an operator can bake config
 * into .env, with anything set in the database taking precedence.
 */
export async function getDiscordSettings(): Promise<DiscordSettings> {
  const result: DiscordSettings = {
    ...DEFAULTS,
    panelWebhook: process.env.DISCORD_WEBHOOK_URL?.trim() || "",
    botToken: process.env.DISCORD_BOT_TOKEN?.trim() || "",
    guildId: process.env.DISCORD_GUILD_ID?.trim() || "",
    extraServers: process.env.GSM_ET_EXTRA_SERVERS?.trim() || "",
    masterUrls: process.env.GSM_ET_MASTER_URLS?.trim() || "",
  };

  try {
    const rows = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, DISCORD_KEYS as unknown as string[]));

    for (const row of rows) {
      const value = (row.value ?? "").trim();
      if (!value) continue;
      switch (row.key) {
        case "discord_panel_webhook": result.panelWebhook = value; break;
        case "discord_bot_token":     result.botToken = value; break;
        case "discord_guild_id":      result.guildId = value; break;
        case "discord_category_id":   result.categoryId = value; break;
        case "discord_auto_channel":  result.autoChannel = value === "true"; break;
        case "discord_channel_prefix": result.channelPrefix = value; break;
        case "discord_status_interval_minutes": {
          const n = Number(value);
          if (Number.isFinite(n)) {
            result.statusIntervalMinutes = Math.min(60, Math.max(1, Math.round(n)));
          }
          break;
        }
        case "et_extra_servers": result.extraServers = value; break;
        case "et_master_urls":   result.masterUrls = value; break;
      }
    }
  } catch {
    // A settings read failure must not break server creation; fall back to env.
  }

  return result;
}

/** Bot credentials in the shape the Discord helpers expect, or null. */
export async function getBotConfig(): Promise<BotConfig | null> {
  const s = await getDiscordSettings();
  if (!s.botToken || !s.guildId) return null;
  return { token: s.botToken, guildId: s.guildId, categoryId: s.categoryId || null };
}

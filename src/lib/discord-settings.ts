import { db } from "@/db";
import { settings } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { BotConfig } from "@/lib/discord";

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
}

const DEFAULTS: DiscordSettings = {
  panelWebhook: "",
  botToken: "",
  guildId: "",
  categoryId: "",
  autoChannel: false,
  channelPrefix: "",
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

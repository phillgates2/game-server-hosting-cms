import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { eq } from "drizzle-orm";
import { getDiscordSettings, DISCORD_KEYS } from "@/lib/discord-settings";
import { isValidWebhookUrl, verifyBot, sendDiscordWebhook } from "@/lib/discord";

async function requireAdmin(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return null;
  return (await hasPermission(auth.userId, "panel.settings")) ? auth : null;
}

/**
 * GET /api/settings/discord
 *
 * Reports the configuration WITHOUT returning the bot token. A token grants
 * control of the guild, so it is write-only from the UI's perspective: the
 * client only learns whether one is set.
 */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const s = await getDiscordSettings();
    return NextResponse.json({
      panelWebhook: s.panelWebhook,
      panelWebhookValid: isValidWebhookUrl(s.panelWebhook),
      hasBotToken: Boolean(s.botToken),
      guildId: s.guildId,
      categoryId: s.categoryId,
      autoChannel: s.autoChannel,
      channelPrefix: s.channelPrefix,
      extraServers: s.extraServers,
      masterUrls: s.masterUrls,
      botReady: Boolean(s.botToken && s.guildId),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not read Discord settings", 500);
  }
}

/**
 * POST /api/settings/discord
 *
 * Body: { panelWebhook?, botToken?, guildId?, categoryId?, autoChannel?,
 *         channelPrefix?, action? }
 *
 * action "test" posts a sample message to the panel webhook.
 * action "verify" checks the bot token against the guild.
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

  const action = typeof body.action === "string" ? body.action : "save";

  try {
    // ── Test the panel webhook ───────────────────────────────────────────────
    if (action === "test") {
      const current = await getDiscordSettings();
      const url = typeof body.panelWebhook === "string" && body.panelWebhook.trim()
        ? body.panelWebhook.trim()
        : current.panelWebhook;

      if (!isValidWebhookUrl(url)) {
        return NextResponse.json({ error: "No valid panel webhook configured" }, { status: 400 });
      }

      const res = await sendDiscordWebhook(url, {
        serverName: "GameServer Manager",
        gameName: "Panel",
        port: 0,
        event: "server_updated",
        message: "✅ Panel webhook is working. Notifications will be delivered here.",
        serverStatus: "online",
        playerCount: 3,
        maxPlayers: 16,
      });
      return res.success
        ? NextResponse.json({ ok: true, message: "Test message sent" })
        : NextResponse.json({ error: res.error || "Send failed" }, { status: 502 });
    }

    // ── Verify the bot credentials ───────────────────────────────────────────
    if (action === "verify") {
      const current = await getDiscordSettings();
      const token = typeof body.botToken === "string" && body.botToken.trim()
        ? body.botToken.trim()
        : current.botToken;
      const guildId = typeof body.guildId === "string" && body.guildId.trim()
        ? body.guildId.trim()
        : current.guildId;

      if (!token || !guildId) {
        return NextResponse.json({ error: "Bot token and server (guild) ID are both required" }, { status: 400 });
      }

      const res = await verifyBot({ token, guildId, categoryId: null });
      return res.ok
        ? NextResponse.json({ ok: true, guildName: res.guildName })
        : NextResponse.json({ error: res.error || "Verification failed" }, { status: 400 });
    }

    // ── Save ─────────────────────────────────────────────────────────────────
    const updates: Array<{ key: string; value: string }> = [];

    if (typeof body.panelWebhook === "string") {
      const v = body.panelWebhook.trim();
      // Reject early: a bad URL saved silently looks like a working config.
      if (v && !isValidWebhookUrl(v)) {
        return NextResponse.json(
          { error: "That is not a valid Discord webhook URL" },
          { status: 400 }
        );
      }
      updates.push({ key: "discord_panel_webhook", value: v });
    }

    // An empty string clears the stored token; undefined leaves it untouched,
    // so the UI can save other fields without resending the secret.
    if (typeof body.botToken === "string") {
      updates.push({ key: "discord_bot_token", value: body.botToken.trim() });
    }

    for (const [field, key] of [
      ["guildId", "discord_guild_id"],
      ["categoryId", "discord_category_id"],
      ["channelPrefix", "discord_channel_prefix"],
      ["extraServers", "et_extra_servers"],
      ["masterUrls", "et_master_urls"],
    ] as const) {
      if (typeof body[field] === "string") {
        const v = (body[field] as string).trim();
        if ((field === "guildId" || field === "categoryId") && v && !/^\d{5,25}$/.test(v)) {
          return NextResponse.json(
            { error: `${field === "guildId" ? "Server (guild) ID" : "Category ID"} must be a numeric Discord ID` },
            { status: 400 }
          );
        }
        updates.push({ key, value: v });
      }
    }

    if (typeof body.autoChannel === "boolean") {
      updates.push({ key: "discord_auto_channel", value: body.autoChannel ? "true" : "false" });
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    for (const { key, value } of updates) {
      if (!DISCORD_KEYS.includes(key as (typeof DISCORD_KEYS)[number])) continue;
      const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (existing) {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value });
      }
    }

    return NextResponse.json({ ok: true, updated: updates.length });
  } catch (e: unknown) {
    return apiError(e, "Could not save Discord settings", 500);
  }
}

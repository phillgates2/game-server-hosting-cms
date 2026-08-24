import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { getDiscordSettings } from "@/lib/discord-settings";
import { provisionServerChannel, channelExists } from "@/lib/discord";
import {
  planForServer,
  summarise,
  type BackfillOutcome,
} from "@/lib/discord-backfill";

/**
 * POST /api/settings/discord/backfill
 *
 * Give every existing server a Discord channel. Auto-provisioning only runs at
 * create time, so servers that predate the bot configuration never got one;
 * this fills those gaps and repairs channels deleted by hand in Discord.
 *
 * Pass `{ dryRun: true }` to see what would happen without touching anything.
 */
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;

    const cfg = await getDiscordSettings();
    if (!cfg.botToken || !cfg.guildId) {
      return NextResponse.json(
        {
          error:
            "A bot token and server (guild) ID are required. A webhook alone cannot create channels.",
        },
        { status: 400 }
      );
    }
    const bot = {
      token: cfg.botToken,
      guildId: cfg.guildId,
      categoryId: cfg.categoryId || null,
    };

    const servers = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        discordWebhook: gameServers.discordWebhook,
        discordChannelId: gameServers.discordChannelId,
      })
      .from(gameServers)
      .orderBy(gameServers.id);

    const results: BackfillOutcome[] = [];

    for (const server of servers) {
      const plan = planForServer(server);

      if (plan.kind === "skip") {
        results.push({
          serverId: server.id,
          serverName: server.name,
          status: "skipped",
          detail: plan.reason,
        });
        continue;
      }

      // A recorded channel might have been deleted in Discord, which leaves
      // the stored webhook silently 404ing on every send.
      let needsChannel = plan.kind === "create";
      if (plan.kind === "verify" && server.discordChannelId) {
        const check = await channelExists(bot, server.discordChannelId);
        if (check.unknown) {
          // Could not tell — do not risk creating a duplicate.
          results.push({
            serverId: server.id,
            serverName: server.name,
            status: "skipped",
            detail: `Could not verify the existing channel: ${check.error}`,
          });
          continue;
        }
        if (check.exists) {
          results.push({
            serverId: server.id,
            serverName: server.name,
            status: "ok",
            detail: "Channel already exists",
          });
          continue;
        }
        needsChannel = true;
      }

      if (!needsChannel) continue;

      const wasMissing = plan.kind === "verify";

      if (dryRun) {
        results.push({
          serverId: server.id,
          serverName: server.name,
          status: wasMissing ? "recreated" : "created",
          detail: wasMissing
            ? "Would re-create the deleted channel"
            : "Would create a channel",
        });
        continue;
      }

      const result = await provisionServerChannel(bot, server.name, {
        prefix: cfg.channelPrefix,
      });

      if (result.ok && result.webhookUrl) {
        await db
          .update(gameServers)
          .set({
            discordWebhook: result.webhookUrl,
            discordChannelId: result.channelId,
            updatedAt: new Date(),
          })
          .where(eq(gameServers.id, server.id));
        results.push({
          serverId: server.id,
          serverName: server.name,
          status: wasMissing ? "recreated" : "created",
          channelName: result.channelName,
        });
      } else {
        results.push({
          serverId: server.id,
          serverName: server.name,
          status: "failed",
          detail: result.error,
        });
      }
    }

    const summary = summarise(results);
    return NextResponse.json({ ok: true, dryRun, ...summary });
  } catch (e: unknown) {
    return apiError(e, "Backfill failed", 500);
  }
}

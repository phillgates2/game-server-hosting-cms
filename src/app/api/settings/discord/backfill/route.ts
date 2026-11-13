import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { getDiscordSettings } from "@/lib/discord-settings";
import {
  provisionServerChannel,
  provisionWebhookInChannel,
  channelExists,
  webhookExists,
  type BotConfig,
} from "@/lib/discord";
import {
  planForServer,
  repairForGoneWebhook,
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
 * It also checks stored webhooks, including hand-entered ones. A webhook only
 * lives as long as its channel: delete the channel in Discord and every later
 * notification answers `10015 Unknown Webhook`, forever, without a trace in the
 * panel. Where the panel knows the channel, a deleted webhook is re-created in
 * place; where it does not, the server is reported with the message that tells
 * the operator to paste a new URL.
 *
 * Pass `{ dryRun: true }` to see what would happen without touching anything.
 */
/**
 * Verify one stored webhook and, when Discord says it is gone, repair it.
 *
 * Three places need this — a hand-entered webhook with no channel on record, a
 * panel channel whose webhook was deleted, and the ordinary verify pass — and
 * they must agree, because the difference between "re-create the webhook" and
 * "tell the operator" is whether the panel knows the channel.
 *
 * The distinction the whole file turns on: `unknown` (a 429, a proxy, a dead
 * network) is never treated as gone. Replacing a working webhook on one bad
 * minute sends a server's notifications somewhere its owner never chose.
 */
async function verifyAndRepairWebhook(
  bot: BotConfig,
  server: { id: number; name: string; discordWebhook: string | null; discordChannelId: string | null },
  opts: { dryRun: boolean }
): Promise<BackfillOutcome | null> {
  if (!server.discordWebhook) return null;

  const check = await webhookExists(server.discordWebhook);
  if (check.exists) return null;
  if (check.unknown) {
    return {
      serverId: server.id,
      serverName: server.name,
      status: "ok",
      detail: `Could not verify the stored webhook: ${check.error}`,
    };
  }

  // Definitively gone (10015). A panel-managed channel can be repaired in
  // place; otherwise only the operator can supply a new URL.
  const repair = repairForGoneWebhook(server);
  if (repair.kind === "report") {
    return {
      serverId: server.id,
      serverName: server.name,
      status: "failed",
      detail: repair.reason,
    };
  }

  if (opts.dryRun) {
    return {
      serverId: server.id,
      serverName: server.name,
      status: "repaired",
      detail: "Would re-create the deleted webhook in its channel",
    };
  }

  const recreated = await provisionWebhookInChannel(bot, server.discordChannelId!);
  if (!recreated.ok) {
    return {
      serverId: server.id,
      serverName: server.name,
      status: "failed",
      detail: `The webhook is gone and could not be re-created: ${recreated.error}`,
    };
  }
  await db
    .update(gameServers)
    .set({ discordWebhook: recreated.webhookUrl, updatedAt: new Date() })
    .where(eq(gameServers.id, server.id));
  return {
    serverId: server.id,
    serverName: server.name,
    status: "repaired",
    detail: "The webhook had been deleted in Discord — a new one was created in the same channel",
  };
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "panel.settings", auth.keyScope))) {
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

      // ── A webhook the panel did not provision ────────────────────────────
      // Never replaced on the strength of its URL alone, but worth checking:
      // if Discord says it is gone, the server has been mute and nobody knows.
      if (plan.kind === "verify-webhook") {
        results.push(
          (await verifyAndRepairWebhook(bot, server, { dryRun })) ?? {
            serverId: server.id,
            serverName: server.name,
            status: "ok",
            detail: "The stored webhook still exists",
          }
        );
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
          // The channel survived — but the webhook inside it may not have. This
          // is the other half of `10015`: deleting the webhook (or having a
          // different one created and the old one revoked) leaves a live
          // channel whose stored URL is dead. Verify, and repair in place.
          const repaired = await verifyAndRepairWebhook(bot, server, { dryRun });
          results.push(
            repaired ?? {
              serverId: server.id,
              serverName: server.name,
              status: "ok",
              detail: "Channel already exists",
            }
          );
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

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes, serverMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { apiError } from "@/lib/api-error";
import { hasCrashed, shouldAutoRestart } from "@/lib/server-lifecycle";
import { createLogger } from "@/lib/logger";

const log = createLogger("metrics");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServerForPlayerProbe = {
  gameSlug: string | null;
  ipv4: string | null;
  port: number;
  queryPort: number | null;
  variables: unknown;
  config: unknown;
};

/**
 * Best-effort live player figures for a Discord notification.
 *
 * Bounded by the probe's short timeouts so it can never hold up process
 * control for long, and honest about failures: no count just means the game
 * has no reachable query port, which must never break the notification.
 */
async function probeServerPlayers(server: ServerForPlayerProbe, attempts: number) {
  const { probePlayers, maxPlayersFrom } = await import("@/lib/players");
  const probe = await probePlayers({
    gameSlug: server.gameSlug ?? "",
    host: server.ipv4 ?? "127.0.0.1",
    port: server.port,
    queryPort: server.queryPort,
    attempts,
  });
  return {
    playerCount: probe.players,
    maxPlayers: probe.maxPlayers ?? maxPlayersFrom(server.variables, server.config),
  };
}

// POST /api/servers/[id]/process — Start or stop the actual game server process
/**
 * Servers currently being auto-restarted.
 *
 * Two browser tabs both polling status would each observe the crash and each
 * spawn a replacement process, leaving an orphan holding the port. This guard
 * keeps one recovery in flight per server.
 *
 * Per-process, like the login throttle: correct for the single-node default,
 * and a multi-node deployment would need this in the database.
 */
const autoRestarting = new Set<number>();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        name: gameServers.name,
        installPath: gameServers.installPath,
        ipv4: gameServers.ipv4,
        ipv6: gameServers.ipv6,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        status: gameServers.status,
        pid: gameServers.pid,
        variables: gameServers.variables,
        config: gameServers.config,
        discordWebhook: gameServers.discordWebhook,
        discordNotifyStart: gameServers.discordNotifyStart,
        discordNotifyStop: gameServers.discordNotifyStop,
        discordNotifyRestart: gameServers.discordNotifyRestart,
        discordNotifyCrash: gameServers.discordNotifyCrash,
        autoRestart: gameServers.autoRestart,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
        nodeIsLocal: nodes.isLocal,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!server.nodeIsLocal) {
      return NextResponse.json({ error: "Process control is only available on local nodes" }, { status: 400 });
    }

    const body = await req.json();
    const action = body.action as string; // "start" | "stop" | "restart" | "status"

    if (action === "status") {
      if (!(await hasPermission(auth.userId, "servers.view"))) {
        return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      }
    } else if (action === "restart") {
      const canRestart = (await hasPermission(auth.userId, "servers.restart")) || (await hasPermission(auth.userId, "servers.start_stop"));
      if (!canRestart) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    } else {
      if (!(await hasPermission(auth.userId, "servers.start_stop"))) {
        return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      }
    }

    // ─── STATUS ───
    if (action === "status") {
      const { isProcessAlive } = await import("@/lib/process-control");
      const alive = server.pid ? isProcessAlive(server.pid) : false;

      // A server the panel believed was running but whose process is gone did
      // not stop cleanly - nobody asked it to. That is a crash, and it is the
      // event an operator most wants to hear about. It previously recorded a
      // plain "stopped" and sent no notification at all.
      const crashed = hasCrashed({ status: server.status, alive });

      // Record a per-server resource sample. server_metrics has existed from
      // the start and been pruned by the retention job, but nothing ever wrote
      // to it, so per-server history was permanently empty and monitoring
      // could only ever show host-wide figures.
      //
      // Sampling rides on the existing 15s status poll rather than adding a
      // timer, and is best-effort: a failure here must never affect the poll.
      if (alive && server.pid) {
        try {
          const { sampleProcess, cpuPercentFor, shouldStoreSample } = await import("@/lib/process-metrics");
          // Throttled independently of the poll: several open dashboards must
          // not multiply the write rate.
          const sample = shouldStoreSample(server.id) ? await sampleProcess(server.pid) : null;
          if (sample) {
            await db.insert(serverMetrics).values({
              serverId: server.id,
              cpuPercent: cpuPercentFor(server.pid, sample),
              ramUsedMb: Math.round(sample.ramMb * 100) / 100,
            });
          }
        } catch (e: unknown) {
          log.warn("could not record a metric sample", {
            server: server.name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      if (alive !== (server.status === "running")) {
        if (!alive && server.pid) {
          const { forgetProcess, forgetSampleThrottle } = await import("@/lib/process-metrics");
          forgetProcess(server.pid);
          forgetSampleThrottle(server.id);
        }
        await db.update(gameServers).set({
          status: crashed ? "crashed" : alive ? "running" : "stopped",
          pid: alive ? server.pid : null,
          lastStopped: alive ? undefined : new Date(),
          updatedAt: new Date(),
        }).where(eq(gameServers.id, server.id));
      }

      // The per-event toggles were stored and cloned but never consulted, so
      // switching one off had no effect at all.
      if (crashed && server.discordNotifyCrash !== false) {
        const { resolveWebhookUrl, notifyServerCrashed } = await import("@/lib/discord");
        const hook = resolveWebhookUrl(server.discordWebhook);
        if (hook) {
          // Never let a webhook failure change the response the poller sees.
          // The process is gone, so there is no player count to probe — the
          // notification carries the red dot and an honest unknown count.
          await notifyServerCrashed(
            hook,
            server.name,
            server.gameName || "Unknown",
            server.port,
            undefined,
            { serverStatus: "offline" }
          ).catch(() => {});
        }
      }

      // Auto-restart. The panel has always shown an "Auto-restart on" badge and
      // the column was copied when cloning, but nothing ever acted on it, so a
      // crashed server stayed down regardless of the setting.
      let restarted = false;
      if (shouldAutoRestart({ status: server.status, alive, autoRestart: server.autoRestart }, autoRestarting.has(server.id))) {
        autoRestarting.add(server.id);
        try {
          const { startDetachedScript } = await import("@/lib/process-control");
          const startScript = join(/* turbopackIgnore: true */ String(server.installPath), "gsm-start.sh");
          const { pid, alive: back } = await startDetachedScript(startScript);

          await db.update(gameServers).set({
            status: back ? "running" : "crashed",
            pid: back ? pid : null,
            lastStarted: back ? new Date() : undefined,
            updatedAt: new Date(),
          }).where(eq(gameServers.id, server.id));

          restarted = back;
          console.log(`[auto-restart] "${server.name}" ${back ? `recovered (pid ${pid})` : "failed to restart"}`);

          if (back && server.discordNotifyRestart !== false) {
            const { resolveWebhookUrl, sendDiscordWebhook } = await import("@/lib/discord");
            const hook = resolveWebhookUrl(server.discordWebhook);
            if (hook) {
              const players = await probeServerPlayers(server, 2);
              await sendDiscordWebhook(hook, {
                serverName: server.name,
                gameName: server.gameName || "Unknown",
                ipv4: server.ipv4,
                ipv6: server.ipv6,
                port: server.port,
                event: "server_restarted",
                message: `🔁 **${server.name}** crashed and was restarted automatically.`,
                serverStatus: back ? "online" : "offline",
                ...players,
              }).catch(() => {});
            }
          }
        } catch (e: unknown) {
          // A failed recovery must not break the status poll.
          console.error(`[auto-restart] "${server.name}" threw:`, e instanceof Error ? e.message : e);
        } finally {
          autoRestarting.delete(server.id);
        }
      }

      return NextResponse.json({
        alive: alive || restarted,
        pid: server.pid,
        status: restarted ? "running" : crashed ? "crashed" : alive ? "running" : "stopped",
        autoRestarted: restarted || undefined,
      });
    }

    // ─── STOP ───
    if (action === "stop") {
      // Read the count before killing: it is the last chance to know how many
      // people were on the server, and it answers "how many did this kick?".
      const stopHook = server.discordNotifyStop === false
        ? null
        : await import("@/lib/discord").then((m) => m.resolveWebhookUrl(server.discordWebhook));
      const players = stopHook ? await probeServerPlayers(server, 1) : null;

      const { isProcessAlive, killProcess } = await import("@/lib/process-control");
      if (server.pid && isProcessAlive(server.pid)) {
        await killProcess(server.pid);
        // Give the process a moment to fully exit and release resources
        await new Promise((r) => setTimeout(r, 500));
      }
      // Final check — update DB only after the process is confirmed dead
      await db.update(gameServers).set({
        status: "stopped",
        pid: null,
        lastStopped: new Date(),
        updatedAt: new Date(),
      }).where(eq(gameServers.id, server.id));

      if (stopHook) {
        const { sendDiscordWebhook } = await import("@/lib/discord");
        await sendDiscordWebhook(stopHook, {
          serverName: server.name, gameName: server.gameName || "Unknown",
          ipv4: server.ipv4, ipv6: server.ipv6, port: server.port,
          event: "server_stopped", message: `**${server.name}** has been stopped.`,
          serverStatus: "offline",
          ...(players ?? {}),
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true, status: "stopped" });
    }

    // ─── START / RESTART ───
    if (action === "start" || action === "restart") {
      const { isProcessAlive, killProcess, startDetachedScript } = await import("@/lib/process-control");
      // Kill existing process if restarting
      if (server.pid && isProcessAlive(server.pid)) {
        await killProcess(server.pid);
        // Give the process a moment to fully exit and release resources
        await new Promise((r) => setTimeout(r, 500));
      }

      const installPath = String(server.installPath);
      const startScript = join(/* turbopackIgnore: true */ installPath, "gsm-start.sh");
      const { pid, alive } = await startDetachedScript(startScript);

      await db.update(gameServers).set({
        status: alive ? "running" : "stopped",
        pid: alive ? pid : null,
        lastStarted: new Date(),
        updatedAt: new Date(),
      }).where(eq(gameServers.id, server.id));

      const wantsNotify = action === "restart"
        ? server.discordNotifyRestart !== false
        : server.discordNotifyStart !== false;
      const startHook = alive && wantsNotify
        ? await import("@/lib/discord").then((m) => m.resolveWebhookUrl(server.discordWebhook))
        : null;
      if (startHook) {
        const { sendDiscordWebhook } = await import("@/lib/discord");
        // Two passes: a freshly spawned game may still be binding its query
        // socket, and the second attempt usually catches it.
        const players = await probeServerPlayers(server, 2);
        await sendDiscordWebhook(startHook, {
          serverName: server.name, gameName: server.gameName || "Unknown",
          ipv4: server.ipv4, ipv6: server.ipv6, port: server.port,
          event: action === "restart" ? "server_restarted" : "server_started",
          message: `**${server.name}** is now ${action === "restart" ? "restarting" : "online"}!`,
          serverStatus: alive ? "online" : "offline",
          ...players,
        }).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        status: alive ? "running" : "crashed",
        pid,
        alive,
      });
    }

    return NextResponse.json({ error: "Invalid action. Use: start, stop, restart, status" }, { status: 400 });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}

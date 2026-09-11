import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes, users, serverMetrics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { join } from "node:path";
import { apiError } from "@/lib/api-error";
import { hasCrashed, shouldAutoRestart, isCrashLooping, windowedCrashes, CRASH_LOOP_MAX, CRASH_LOOP_WINDOW_MS } from "@/lib/server-lifecycle";
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
// Recent crash timestamps per server, feeding the crash-loop breaker. Pure
// in-process state like autoRestarting: single-process deployment by design.
const crashHistory = new Map<number, number[]>();
// Consecutive over-limit samples per server, feeding the resource watchdog.
const limitStrikes = new Map<number, number>();
// Last-seen player rosters, feeding the join/leave notifications. Cleared
// whenever a server stops so the next run re-baselines silently.
const lastRoster = new Map<number, string[]>();

/** Upgrades predate the players toggle; add the column lazily on use. */
async function ensureNotifyPlayersColumn() {
  await db.execute(sql`ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS discord_notify_players BOOLEAN DEFAULT TRUE`);
}

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
        discordNotifyPlayers: gameServers.discordNotifyPlayers,
        autoRestart: gameServers.autoRestart,
        maxRamMb: gameServers.maxRamMb,
        maxCpuPercent: gameServers.maxCpuPercent,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
        nodeIsLocal: nodes.isLocal,
        nodeApiUrl: nodes.apiUrl,
        nodeApiKey: nodes.apiKey,
        ownerEmail: users.email,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .leftJoin(users, eq(gameServers.userId, users.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

    let collabRole: import("@/lib/server-collab").CollaboratorRole | null = null;
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      const { getCollaboratorRole } = await import("@/lib/server-collab");
      collabRole = await getCollaboratorRole(server.id, auth.userId);
      if (!collabRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const action = body.action as string; // "start" | "stop" | "restart" | "status"

    // Viewers may watch but never touch the power switch.
    if (collabRole === "viewer" && action !== "status") {
      return NextResponse.json({ error: "Viewers can't control this server" }, { status: 403 });
    }

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

    if (!server.nodeIsLocal) {
      // Remote node: the gsm-agent on that machine does the actual work; the
      // panel stays the source of truth for the stored status. Permission
      // checks above apply exactly as they do for local servers.
      return handleRemoteAction(req, server, action);
    }

    // ─── STATUS ───
    if (action === "status") {
      await ensureNotifyPlayersColumn();
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
            const cpuPercent = cpuPercentFor(server.pid, sample);
            await db.insert(serverMetrics).values({
              serverId: server.id,
              cpuPercent,
              ramUsedMb: Math.round(sample.ramMb * 100) / 100,
            });

            // Resource-limit watchdog: the limits were stored and editable but
            // never enforced. Strike on every over-limit sample; four in a row
            // (≈4 minutes of sustained samples) stops the server.
            const { checkResourceLimits, strikeDecision, LIMIT_STRIKES_ENFORCE } = await import("@/lib/process-metrics");
            const violations = checkResourceLimits(
              { ramMb: sample.ramMb, cpuPercent },
              { maxRamMb: server.maxRamMb, maxCpuPercent: server.maxCpuPercent }
            );
            const decision = strikeDecision(limitStrikes.get(server.id) ?? 0, violations.length > 0);
            limitStrikes.set(server.id, decision.strikes);
            if (violations.length > 0 && (decision.warn || decision.enforce)) {
              const reason = violations.join("; ");
              const { resolveWebhookUrl, sendDiscordWebhook } = await import("@/lib/discord");
              const hook = resolveWebhookUrl(server.discordWebhook);
              if (decision.enforce) {
                const { killProcess } = await import("@/lib/process-control");
                killProcess(server.pid);
                limitStrikes.delete(server.id);
                lastRoster.delete(server.id);
                const { recordServerEvent } = await import("@/lib/server-events");
                void recordServerEvent(server.id, "watchdog-stop", violations.join("; "));
                await db.update(gameServers).set({ status: "stopped", pid: null, lastStopped: new Date(), updatedAt: new Date() }).where(eq(gameServers.id, server.id));
                console.log(`[resource-watchdog] stopped "${server.name}" after ${LIMIT_STRIKES_ENFORCE} over-limit samples: ${reason}`);
                if (hook) {
                  await sendDiscordWebhook(hook, {
                    serverName: server.name,
                    gameName: server.gameName || "Unknown",
                    ipv4: server.ipv4,
                    ipv6: server.ipv6,
                    port: server.port,
                    event: "resource_limit",
                    message: `⛔ **${server.name}** was stopped by the resource-limit watchdog: ${reason}.`,
                    serverStatus: "offline",
                  }).catch(() => {});
                }
              } else if (hook) {
                console.log(`[resource-watchdog] "${server.name}" over its limits (${reason}) — strike ${decision.strikes}`);
                await sendDiscordWebhook(hook, {
                  serverName: server.name,
                  gameName: server.gameName || "Unknown",
                  ipv4: server.ipv4,
                  ipv6: server.ipv6,
                  port: server.port,
                  event: "resource_limit",
                  message: `⚠️ **${server.name}** is over its resource limits: ${reason}. It will be stopped if this continues.`,
                  serverStatus: "online",
                }).catch(() => {});
              }
            }
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
          limitStrikes.delete(server.id);
          lastRoster.delete(server.id);
        }
        await db.update(gameServers).set({
          status: crashed ? "crashed" : alive ? "running" : "stopped",
          pid: alive ? server.pid : null,
          lastStopped: alive ? undefined : new Date(),
          updatedAt: new Date(),
        }).where(eq(gameServers.id, server.id));
      }

      // Wake the owner by email too — Discord is where the community watches,
      // email is where the operator gets woken up. Best-effort like the rest.
      if (crashed && server.ownerEmail) {
        const { sendServerCrashEmail } = await import("@/lib/email");
        void sendServerCrashEmail(server.ownerEmail, server.name, server.gameName || "Unknown").catch(() => {});
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

      // Crash-loop bookkeeping: remember this crash for the breaker window.
      if (crashed) {
        const crashNow = Date.now();
        crashHistory.set(server.id, [...windowedCrashes(crashHistory.get(server.id) ?? [], crashNow), crashNow]);
        // Everyone effectively left; re-baseline silently on the next run.
        lastRoster.delete(server.id);
        const { recordServerEvent } = await import("@/lib/server-events");
        void recordServerEvent(server.id, "crashed");
      }

      // Auto-restart. The panel has always shown an "Auto-restart on" badge and
      // the column was copied when cloning, but nothing ever acted on it, so a
      // crashed server stayed down regardless of the setting.
      let restarted = false;
      if (shouldAutoRestart({ status: server.status, alive, autoRestart: server.autoRestart }, autoRestarting.has(server.id))) {
        // Breaker: a server that crashes repeatedly on boot would otherwise be
        // restarted forever. After CRASH_LOOP_MAX crashes inside the window it
        // stays down until a human starts it (which clears the history).
        if (isCrashLooping(crashHistory.get(server.id) ?? [], Date.now())) {
          console.log(
            `[auto-restart] breaker tripped for "${server.name}" — ${CRASH_LOOP_MAX} crashes in ${Math.round(CRASH_LOOP_WINDOW_MS / 60000)} minutes, leaving it down for an operator`
          );
        } else {
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
          if (back) {
            const { recordServerEvent } = await import("@/lib/server-events");
            void recordServerEvent(server.id, "auto-restarted", `pid ${pid}`);
          }

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
      }

      // ── Player join/leave notifications ─────────────────────────────────
      // Compare this poll's roster against the last one; the difference is
      // who joined or left. Only probes when it would actually be reported —
      // a running server with a webhook and the toggle on — so a panel with
      // notifications off pays no extra query cost.
      const isUp = alive || restarted;
      if (isUp && server.discordNotifyPlayers !== false) {
        const { resolveWebhookUrl } = await import("@/lib/discord");
        const hook = resolveWebhookUrl(server.discordWebhook);
        if (hook) {
          try {
            const { probePlayers } = await import("@/lib/players");
            const probe = await probePlayers({
              gameSlug: server.gameSlug ?? "",
              host: server.ipv4 ?? "127.0.0.1",
              port: server.port,
              queryPort: server.queryPort,
              attempts: 1,
            });
            // A failed probe is not an empty server — it is a network blip or
            // a firewalled query port. Keep the old baseline and say nothing;
            // reporting a mass-leave on every blip would be spam, not signal.
            if (probe.ok) {
              const { diffRosters, describeRosterChange } = await import("@/lib/roster-diff");
              const current = probe.names ?? [];
              const change = diffRosters(lastRoster.get(server.id), current);
              lastRoster.set(server.id, current);
              const post = describeRosterChange(server.name, change);
              if (post) {
                const { queueDiscordWebhook } = await import("@/lib/discord");
                queueDiscordWebhook(hook, {
                  serverName: server.name,
                  gameName: server.gameName || "Unknown",
                  ipv4: server.ipv4,
                  ipv6: server.ipv6,
                  port: server.port,
                  event: post.event,
                  message: post.message,
                  playerCount: probe.players,
                  maxPlayers: probe.maxPlayers,
                  serverStatus: "online",
                });
              }
            }
          } catch {
            // A roster notification must never disturb the status poll.
          }
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
      // A deliberate (re)start is human intervention: give the crash-loop
      // breaker a clean slate so it can protect the next run from scratch.
      crashHistory.delete(server.id);
      limitStrikes.delete(server.id);
      lastRoster.delete(server.id);
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


/**
 * Process control for a server on a REMOTE node: every action is executed by
 * the gsm-agent over RPC, then the panel's stored status is updated to match.
 * The response shapes mirror the local path so the UI needs no fork.
 */
async function handleRemoteAction(
  req: NextRequest,
  server: {
    id: number;
    name: string;
    installPath: string;
    status: string;
    pid: number | null;
    ipv4: string | null;
    ipv6: string | null;
    port: number;
    gameName: string | null;
    nodeApiUrl: string | null;
    nodeApiKey: string | null;
    discordWebhook: string | null;
    discordNotifyStart: boolean | null;
    discordNotifyStop: boolean | null;
    discordNotifyCrash: boolean | null;
    ownerEmail: string | null;
  },
  action: string
): Promise<NextResponse> {
  const { remoteProcessStatus, remoteProcessStart, remoteProcessStop, NodeRpcError } =
    await import("@/lib/node-client");
  const node = { apiUrl: server.nodeApiUrl ?? "", apiKey: server.nodeApiKey ?? "" };
  if (!node.apiUrl || !node.apiKey) {
    return NextResponse.json(
      { error: "This server's node has no agent URL/key configured. Add them in Nodes first." },
      { status: 400 }
    );
  }

  const fail = (e: unknown) => {
    const msg = e instanceof NodeRpcError ? e.message : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Node agent: ${msg}` }, { status: 502 });
  };

  try {
    if (action === "status") {
      const st = await remoteProcessStatus(node, server.installPath, server.pid);
      const wasRunning = server.status === "running";
      const crashed = wasRunning && !st.alive;
      const newStatus = crashed ? "crashed" : st.alive ? "running" : "stopped";
      if (newStatus !== server.status) {
        await db
          .update(gameServers)
          .set({ status: newStatus, pid: st.alive ? st.pid : null, updatedAt: new Date() })
          .where(eq(gameServers.id, server.id));
      }
      if (crashed) {
        const { recordServerEvent } = await import("@/lib/server-events");
        void recordServerEvent(server.id, "crashed", "remote node");
        // Same wake-up calls as a local crash.
        if (server.ownerEmail) {
          const { sendServerCrashEmail } = await import("@/lib/email");
          void sendServerCrashEmail(server.ownerEmail, server.name, server.gameName || "Unknown").catch(() => {});
        }
        if (server.discordNotifyCrash !== false) {
          const { resolveWebhookUrl, notifyServerCrashed } = await import("@/lib/discord");
          const hook = resolveWebhookUrl(server.discordWebhook);
          if (hook) {
            await notifyServerCrashed(hook, server.name, server.gameName || "Unknown", server.port, undefined, {
              serverStatus: "offline",
            }).catch(() => {});
          }
        }
      }
      return NextResponse.json({ alive: st.alive, pid: st.pid, status: newStatus });
    }

    if (action === "start" || action === "restart") {
      if (action === "restart" && server.pid) {
        await remoteProcessStop(node, server.installPath, server.pid);
      }
      const r = await remoteProcessStart(node, server.installPath);
      await db
        .update(gameServers)
        .set({
          status: r.alive ? "running" : "stopped",
          pid: r.alive ? r.pid : null,
          lastStarted: r.alive ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, server.id));
      if (r.alive && server.discordNotifyStart !== false) {
        const { resolveWebhookUrl, notifyServerStarted } = await import("@/lib/discord");
        const hook = resolveWebhookUrl(server.discordWebhook);
        if (hook) {
          await notifyServerStarted(hook, server.name, server.gameName || "Unknown", server.ipv4, server.ipv6, server.port).catch(() => {});
        }
      }
      return NextResponse.json({ ok: r.alive, alive: r.alive, pid: r.pid, status: r.alive ? "running" : "stopped" });
    }

    if (action === "stop") {
      await remoteProcessStop(node, server.installPath, server.pid);
      await db
        .update(gameServers)
        .set({ status: "stopped", pid: null, lastStopped: new Date(), updatedAt: new Date() })
        .where(eq(gameServers.id, server.id));
      if (server.discordNotifyStop !== false) {
        const { resolveWebhookUrl, notifyServerStopped } = await import("@/lib/discord");
        const hook = resolveWebhookUrl(server.discordWebhook);
        if (hook) {
          await notifyServerStopped(hook, server.name, server.gameName || "Unknown", server.port).catch(() => {});
        }
      }
      return NextResponse.json({ ok: true, alive: false, status: "stopped" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: unknown) {
    return fail(e);
  }
}

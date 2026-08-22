import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/servers/[id]/process — Start or stop the actual game server process
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
        status: gameServers.status,
        pid: gameServers.pid,
        discordWebhook: gameServers.discordWebhook,
        discordNotifyStart: gameServers.discordNotifyStart,
        discordNotifyStop: gameServers.discordNotifyStop,
        discordNotifyRestart: gameServers.discordNotifyRestart,
        discordNotifyCrash: gameServers.discordNotifyCrash,
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
      const crashed = !alive && server.status === "running";

      if (alive !== (server.status === "running")) {
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
          await notifyServerCrashed(
            hook,
            server.name,
            server.gameName || "Unknown",
            server.port
          ).catch(() => {});
        }
      }

      return NextResponse.json({
        alive,
        pid: server.pid,
        status: crashed ? "crashed" : alive ? "running" : "stopped",
      });
    }

    // ─── STOP ───
    if (action === "stop") {
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

      const stopHook = server.discordNotifyStop === false
        ? null
        : await import("@/lib/discord").then((m) => m.resolveWebhookUrl(server.discordWebhook));
      if (stopHook) {
        const { sendDiscordWebhook } = await import("@/lib/discord");
        await sendDiscordWebhook(stopHook, {
          serverName: server.name, gameName: server.gameName || "Unknown",
          ipv4: server.ipv4, ipv6: server.ipv6, port: server.port,
          event: "server_stopped", message: `**${server.name}** has been stopped.`,
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
        await sendDiscordWebhook(startHook, {
          serverName: server.name, gameName: server.gameName || "Unknown",
          ipv4: server.ipv4, ipv6: server.ipv6, port: server.port,
          event: action === "restart" ? "server_restarted" : "server_started",
          message: `**${server.name}** is now ${action === "restart" ? "restarting" : "online"}!`,
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

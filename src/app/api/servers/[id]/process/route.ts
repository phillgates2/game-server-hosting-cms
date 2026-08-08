import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { join } from "node:path";

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
      if (alive !== (server.status === "running")) {
        await db.update(gameServers).set({
          status: alive ? "running" : "stopped",
          pid: alive ? server.pid : null,
          updatedAt: new Date(),
        }).where(eq(gameServers.id, server.id));
      }
      return NextResponse.json({ alive, pid: server.pid, status: alive ? "running" : "stopped" });
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

      if (server.discordWebhook) {
        const { sendDiscordWebhook } = await import("@/lib/discord");
        await sendDiscordWebhook(server.discordWebhook, {
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

      if (server.discordWebhook && alive) {
        const { sendDiscordWebhook } = await import("@/lib/discord");
        await sendDiscordWebhook(server.discordWebhook, {
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
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

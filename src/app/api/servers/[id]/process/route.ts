import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { sendDiscordWebhook } from "@/lib/discord";
import { eq } from "drizzle-orm";
import { access, constants, readFile } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findBash(): Promise<string> {
  for (const p of ["/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash"]) {
    try { await access(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return "bash";
}

function killProcess(pid: number): boolean {
  try {
    process.kill(pid, 0); // check if alive
    process.kill(pid, "SIGTERM");
    // Give it 5s then force kill
    setTimeout(() => {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }, 5000);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

    // ─── STATUS ───
    if (action === "status") {
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
      if (server.pid && isProcessAlive(server.pid)) {
        killProcess(server.pid);
      }
      await db.update(gameServers).set({
        status: "stopped",
        pid: null,
        lastStopped: new Date(),
        updatedAt: new Date(),
      }).where(eq(gameServers.id, server.id));

      if (server.discordWebhook) {
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
      // Kill existing process if restarting
      if (server.pid && isProcessAlive(server.pid)) {
        killProcess(server.pid);
        // Wait a moment for the process to die
        await new Promise((r) => setTimeout(r, 2000));
      }

      const startScript = join(server.installPath, "gsm-start.sh");

      try {
        await access(startScript, constants.X_OK);
      } catch {
        return NextResponse.json({
          error: `Start script not found at ${startScript}. Run "Install Files" first to generate it.`,
        }, { status: 400 });
      }

      const bashPath = await findBash();

      // Read the start script to log what we're running
      let scriptContent = "";
      try { scriptContent = await readFile(startScript, "utf8"); } catch { /* ignore */ }

      // Spawn the game server as a detached background process
      const logPath = join(server.installPath, "gsm-server.log");

      const child = spawn(bashPath, [startScript], {
        cwd: server.installPath,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...(process.env as NodeJS.ProcessEnv),
          HOME: process.env.HOME || "/root",
          PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        },
      });

      // Write stdout/stderr to log file
      const { createWriteStream } = await import("fs");
      const logStream = createWriteStream(logPath, { flags: "a" });
      logStream.write(`\n=== GSM Server Start — ${new Date().toISOString()} ===\n`);
      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      child.unref(); // Let the panel process exit without killing the game server

      const pid = child.pid || null;

      // Wait a moment to see if it crashes immediately
      await new Promise((r) => setTimeout(r, 1500));

      const alive = pid ? isProcessAlive(pid) : false;

      await db.update(gameServers).set({
        status: alive ? "running" : "stopped",
        pid: alive ? pid : null,
        lastStarted: new Date(),
        updatedAt: new Date(),
      }).where(eq(gameServers.id, server.id));

      if (server.discordWebhook && alive) {
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
        script: scriptContent.slice(0, 500),
        logPath,
      });
    }

    return NextResponse.json({ error: "Invalid action. Use: start, stop, restart, status" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

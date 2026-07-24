import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { sendDiscordWebhook } from "@/lib/discord";
import { eq } from "drizzle-orm";
import { rm } from "fs/promises";
import { resolve, relative } from "path";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcess(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
    setTimeout(() => {
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    }, 5000);
  } catch {
    // ignore
  }
}

function isSafeToDeleteFolder(installPath: string, nodeBasePath: string | null) {
  const installResolved = resolve(installPath);
  const baseResolved = nodeBasePath ? resolve(nodeBasePath) : null;

  // Never allow deleting these dangerous roots
  const forbidden = new Set([
    "/",
    "/home",
    "/home/admin",
    "/opt",
    "/opt/gameservers",
    "/tmp",
    "/tmp/gameservers",
  ]);

  if (forbidden.has(installResolved)) return false;
  if (!baseResolved) return false;
  if (installResolved === baseResolved) return false;

  // Must be inside the node's configured game server path
  const rel = relative(baseResolved, installResolved);
  if (rel.startsWith("..") || rel === "") return false;

  return true;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const [server] = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        ipv4: gameServers.ipv4,
        ipv6: gameServers.ipv6,
        port: gameServers.port,
        status: gameServers.status,
        pid: gameServers.pid,
        config: gameServers.config,
        installPath: gameServers.installPath,
        autoRestart: gameServers.autoRestart,
        discordWebhook: gameServers.discordWebhook,
        createdAt: gameServers.createdAt,
        gameName: gameDefinitions.name,
        gameSlug: gameDefinitions.slug,
        gameIcon: gameDefinitions.iconEmoji,
        installScript: gameDefinitions.installScript,
        startCommand: gameDefinitions.startCommand,
        defaultConfig: gameDefinitions.defaultConfig,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ server });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json();

    const [current] = await db
      .select({
        name: gameServers.name,
        status: gameServers.status,
        ipv4: gameServers.ipv4,
        ipv6: gameServers.ipv6,
        port: gameServers.port,
        discordWebhook: gameServers.discordWebhook,
        gameName: gameDefinitions.name,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    const [updated] = await db
      .update(gameServers)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(gameServers.id, Number(id)))
      .returning();

    if (current?.discordWebhook && body.status && body.status !== current.status) {
      let event: "server_started" | "server_stopped" | "server_restarted" | null = null;
      if (body.status === "running") event = "server_started";
      else if (body.status === "stopped") event = "server_stopped";
      else if (body.status === "restarting") event = "server_restarted";

      if (event) {
        await sendDiscordWebhook(current.discordWebhook, {
          serverName: current.name,
          gameName: current.gameName || "Unknown",
          ipv4: current.ipv4,
          ipv6: current.ipv6,
          port: current.port,
          event,
          message: `**${current.name}** status changed to ${body.status}`,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ server: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const deleteMode = body?.deleteMode === "db" ? "db" : "all";

    const [server] = await db
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        name: gameServers.name,
        status: gameServers.status,
        pid: gameServers.pid,
        installPath: gameServers.installPath,
        discordWebhook: gameServers.discordWebhook,
        port: gameServers.port,
        gameName: gameDefinitions.name,
        nodeIsLocal: nodes.isLocal,
        nodeBasePath: nodes.gameServerPath,
        nodeApiUrl: nodes.apiUrl,
        nodeApiKey: nodes.apiKey,
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

    // Stop process first if it is running locally.
    if (server.pid && isProcessAlive(server.pid)) {
      stopProcess(server.pid);
    }

    let filesDeleted = false;
    let filesDeleteSkippedReason: string | null = null;

    if (deleteMode === "db") {
      filesDeleteSkippedReason = "User selected DB-only deletion.";
    } else if (server.nodeIsLocal) {
      // Delete local folder directly, but only if the path is clearly safe.
      if (isSafeToDeleteFolder(server.installPath, server.nodeBasePath)) {
        try {
          await rm(server.installPath, { recursive: true, force: true });
          filesDeleted = true;
        } catch (e: unknown) {
          filesDeleteSkippedReason = e instanceof Error ? e.message : "Unknown file delete error";
        }
      } else {
        filesDeleteSkippedReason = `Refused to delete unsafe path: ${server.installPath}`;
      }
    } else if (server.nodeApiUrl) {
      // Remote deletion through node-agent API
      try {
        const res = await fetch(`${server.nodeApiUrl.replace(/\/$/, "")}/files/delete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(server.nodeApiKey ? { "X-API-Key": server.nodeApiKey } : {}),
          },
          body: JSON.stringify({ path: server.installPath }),
        });
        if (res.ok) {
          filesDeleted = true;
        } else {
          const text = await res.text();
          filesDeleteSkippedReason = `Remote node API refused deletion: ${text}`;
        }
      } catch (e: unknown) {
        filesDeleteSkippedReason = e instanceof Error ? e.message : "Remote node delete failed";
      }
    } else {
      filesDeleteSkippedReason = "Remote node file deletion requires a node-agent API URL";
    }

    await db.delete(gameServers).where(eq(gameServers.id, Number(id)));

    if (server.discordWebhook) {
      await sendDiscordWebhook(server.discordWebhook, {
        serverName: server.name,
        gameName: server.gameName || "Unknown",
        port: server.port,
        event: "server_deleted",
        message: `**${server.name}** has been deleted.${filesDeleted ? " Server files were removed." : ""}`,
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, filesDeleted, filesDeleteSkippedReason });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

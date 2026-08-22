import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { sendDiscordWebhook, resolveWebhookUrl } from "@/lib/discord";
import { allowServerPorts, denyServerPorts, updateServerPorts } from "@/lib/firewall";
import { eq, and, ne } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { apiError } from "@/lib/api-error";
import { pickServerPatch, validatePorts } from "@/lib/server-lifecycle";

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
  if (!(await hasPermission(auth.userId, "servers.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
    return apiError(e, "Unknown", 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
        queryPort: gameServers.queryPort,
        rconPort: gameServers.rconPort,
        discordWebhook: gameServers.discordWebhook,
        gameName: gameDefinitions.name,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    // Only client-writable columns. Spreading the raw body here let a caller
    // with servers.edit rewrite installPath (which the process route hands to
    // a shell script) or userId (which reassigns ownership).
    const { updates, rejected } = pickServerPatch(body);
    if (rejected.length) {
      return NextResponse.json(
        { error: `Unknown or read-only field(s): ${rejected.join(", ")}` },
        { status: 400 }
      );
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    // The allowlist controls which fields may be written, not what they may
    // contain: a port still has to be a real port. Only validate when one of
    // them is actually being changed.
    if (updates.port !== undefined || updates.queryPort !== undefined || updates.rconPort !== undefined) {
      const [existing] = await db
        .select({
          nodeId: gameServers.nodeId,
          port: gameServers.port,
          queryPort: gameServers.queryPort,
          rconPort: gameServers.rconPort,
        })
        .from(gameServers)
        .where(eq(gameServers.id, Number(id)))
        .limit(1);
      if (!existing) {
        return NextResponse.json({ error: "Server not found" }, { status: 404 });
      }

      // Other servers on the same node, excluding this one.
      const siblings = existing.nodeId
        ? await db
            .select({ port: gameServers.port, queryPort: gameServers.queryPort, rconPort: gameServers.rconPort })
            .from(gameServers)
            .where(and(eq(gameServers.nodeId, existing.nodeId), ne(gameServers.id, Number(id))))
        : [];
      const takenPorts = siblings.flatMap((s) =>
        [s.port, s.queryPort, s.rconPort].filter((n): n is number => typeof n === "number")
      );

      const portCheck = validatePorts(
        {
          port: updates.port ?? existing.port,
          queryPort: updates.queryPort ?? existing.queryPort,
          rconPort: updates.rconPort ?? existing.rconPort,
        },
        takenPorts
      );
      if (portCheck.error !== null || portCheck.ports === null) {
        return NextResponse.json({ error: portCheck.error }, { status: 400 });
      }
      updates.port = portCheck.ports.port;
      updates.queryPort = portCheck.ports.queryPort;
      updates.rconPort = portCheck.ports.rconPort;
    }

    const [updated] = await db
      .update(gameServers)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(gameServers.id, Number(id)))
      .returning();

    // Update firewall rules if any port changed
    if (current) {
      const portChanged = (updates.port !== undefined && Number(updates.port) !== current.port)
        || (updates.queryPort !== undefined && Number(updates.queryPort) !== current.queryPort)
        || (updates.rconPort !== undefined && Number(updates.rconPort) !== current.rconPort);

      if (portChanged) {
        updateServerPorts(
          Number(id),
          updated.name,
          { port: current.port, queryPort: current.queryPort, rconPort: current.rconPort },
          { port: updated.port, queryPort: updated.queryPort, rconPort: updated.rconPort },
        ).catch((e) => console.warn("[firewall] Failed to update ports:", e));
      }
    }

    const updateHook = resolveWebhookUrl(current?.discordWebhook);
    if (updateHook && updates.status && updates.status !== current.status) {
      let event: "server_started" | "server_stopped" | "server_restarted" | null = null;
      if (updates.status === "running") event = "server_started";
      else if (updates.status === "stopped") event = "server_stopped";
      else if (updates.status === "restarting") event = "server_restarted";

      if (event) {
        await sendDiscordWebhook(updateHook, {
          serverName: current.name,
          gameName: current.gameName || "Unknown",
          ipv4: current.ipv4,
          ipv6: current.ipv6,
          port: current.port,
          event,
          message: `**${current.name}** status changed to ${updates.status}`,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ server: updated });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.delete"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

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
        discordChannelId: gameServers.discordChannelId,
        port: gameServers.port,
        queryPort: gameServers.queryPort,
        rconPort: gameServers.rconPort,
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

    // Remove firewall rules for the deleted server (best-effort)
    denyServerPorts({
      port: server.port,
      queryPort: server.queryPort,
      rconPort: server.rconPort,
    }).catch((e) => console.warn("[firewall] Failed to remove ports:", e));

    const deleteHook = resolveWebhookUrl(server.discordWebhook);
    if (deleteHook) {
      await sendDiscordWebhook(deleteHook, {
        serverName: server.name,
        gameName: server.gameName || "Unknown",
        port: server.port,
        event: "server_deleted",
        message: `**${server.name}** has been deleted.${filesDeleted ? " Server files were removed." : ""}`,
      }).catch(() => {});
    }

    // Tidy up the Discord channel the panel created for this server. Only ones
    // we provisioned are removed - a channel the operator made by hand has no
    // stored id and is left alone.
    if (server.discordChannelId) {
      try {
        const { getBotConfig } = await import("@/lib/discord-settings");
        const cfg = await getBotConfig();
        if (cfg) {
          const { deleteChannel } = await import("@/lib/discord");
          await deleteChannel(cfg, server.discordChannelId);
        }
      } catch (e: unknown) {
        console.warn("[discord] channel cleanup failed:", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, filesDeleted, filesDeleteSkippedReason });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}

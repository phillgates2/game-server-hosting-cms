import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, gameDefinitions, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import { apiError } from "@/lib/api-error";
import { nodeRpc } from "@/lib/node-client";
import {
  computeDestInstallPath,
  createLocalMigrationArchive,
  downloadRemoteArchive,
  extractLocalArchive,
  migrationBlockReason,
  uploadAndExtractRemote,
  cleanupLocalArchive,
} from "@/lib/migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600; // large servers take a while

/** Wrap the typed client so migration helpers can inject/mock it. */
function rpc<T = Record<string, unknown>>(
  node: { apiUrl: string; apiKey: string },
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number }
): Promise<T> {
  return nodeRpc<T>(node, path, body, opts);
}

// POST /api/servers/[id]/migrate — move a server to another node
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const serverId = Number(id);
  if (!Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const destNodeId = Number(body.nodeId);
  if (!Number.isInteger(destNodeId) || destNodeId <= 0) {
    return NextResponse.json({ error: "A destination node is required" }, { status: 400 });
  }

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        name: gameServers.name,
        status: gameServers.status,
        nodeId: gameServers.nodeId,
        installPath: gameServers.installPath,
        gameSlug: gameDefinitions.slug,
      })
      .from(gameServers)
      .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
      .where(eq(gameServers.id, serverId))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const block = migrationBlockReason(server.status);
    if (block) return NextResponse.json({ error: block }, { status: 400 });
    if (server.nodeId === destNodeId) {
      return NextResponse.json({ error: "The server is already on that node." }, { status: 400 });
    }

    const [dest] = await db.select().from(nodes).where(eq(nodes.id, destNodeId)).limit(1);
    if (!dest) return NextResponse.json({ error: "Destination node not found" }, { status: 404 });

    const [source] = await db.select().from(nodes).where(eq(nodes.id, server.nodeId ?? 0)).limit(1);

    const srcLocal = source?.isLocal !== false;
    const dstLocal = dest.isLocal !== false;
    const destInstallPath = computeDestInstallPath(dest.gameServerPath, server.gameSlug, server.name);

    // Remote endpoints must be configured to participate.
    const srcRpc = !srcLocal ? { apiUrl: source?.apiUrl ?? "", apiKey: source?.apiKey ?? "" } : null;
    const dstRpc = !dstLocal ? { apiUrl: dest.apiUrl ?? "", apiKey: dest.apiKey ?? "" } : null;
    if (!srcLocal && (!srcRpc?.apiUrl || !srcRpc.apiKey)) {
      return NextResponse.json({ error: "The source node has no agent URL/key configured." }, { status: 400 });
    }
    if (!dstLocal && (!dstRpc?.apiUrl || !dstRpc.apiKey)) {
      return NextResponse.json({ error: "The destination node has no agent URL/key configured." }, { status: 400 });
    }

    // Mark the move in progress so the UI reflects it.
    await db.update(gameServers).set({ status: "installing", updatedAt: new Date() }).where(eq(gameServers.id, server.id));

    let archivePath: string | null = null;
    try {
      // ── 1. Export from the source ──────────────────────────────────────
      if (srcLocal) {
        archivePath = createLocalMigrationArchive(server.installPath);
      } else {
        // Ask the source agent to build a clean archive, then stream it down.
        const created = await rpc<{ name?: string; error?: string }>(srcRpc!, "/rpc/backup", {
          action: "create",
          installPath: server.installPath,
        }, { timeoutMs: 600_000 });
        if (created.error || !created.name) {
          throw new Error(`Source could not create the archive: ${created.error || "unknown error"}`);
        }
        archivePath = await downloadRemoteArchive(srcRpc!, server.installPath, created.name, rpc);
        // The source's copy has served its purpose; free the space.
        await rpc(srcRpc!, "/rpc/fs", { op: "delete", path: `${server.installPath}/gsm-backups/${created.name}` }, { timeoutMs: 60_000 }).catch(() => {});
      }

      // ── 2. Import on the destination ───────────────────────────────────
      if (dstLocal) {
        await mkdir(destInstallPath, { recursive: true });
        extractLocalArchive(archivePath, destInstallPath);
      } else {
        await uploadAndExtractRemote(dstRpc!, destInstallPath, archivePath, rpc);
      }

      // ── 3. Re-point the record ─────────────────────────────────────────
      await db
        .update(gameServers)
        .set({
          nodeId: dest.id,
          installPath: destInstallPath,
          status: "stopped",
          pid: null,
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, server.id));

      return NextResponse.json({
        ok: true,
        message: `"${server.name}" moved to "${dest.name}" at ${destInstallPath}.`,
        installPath: destInstallPath,
      });
    } catch (e: unknown) {
      // The move failed: leave the server where it was so nothing is lost.
      await db
        .update(gameServers)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(gameServers.id, server.id))
        .catch(() => undefined);
      throw e;
    } finally {
      if (archivePath) await cleanupLocalArchive(archivePath);
    }
  } catch (e: unknown) {
    return apiError(e, "Migration failed", 500);
  }
}

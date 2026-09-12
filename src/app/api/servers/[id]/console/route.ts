import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { consoleLogPath, clampTailLines, tailLines } from "@/lib/console-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never read more than this from the tail of the log in one request. */
const READ_WINDOW_BYTES = 512 * 1024;

// GET /api/servers/[id]/console?lines=200 — tail the captured console log.
// Console output can contain secrets (RCON, chat, IPs), so viewers are out:
// owner, admin, or operator collaborator only.
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
        userId: gameServers.userId,
        installPath: gameServers.installPath,
        nodeIsLocal: nodes.isLocal,
      })
      .from(gameServers)
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (auth.role !== "admin" && server.userId !== auth.userId) {
      const { getCollaboratorRole } = await import("@/lib/server-collab");
      const collabRole = await getCollaboratorRole(server.id, auth.userId);
      if (collabRole !== "operator") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const url = new URL(req.url);
    const lines = clampTailLines(url.searchParams.get("lines"));

    if (server.nodeIsLocal === false) {
      return NextResponse.json({
        lines: [],
        note: "Console capture is available on local nodes only — this server runs on a remote node.",
      });
    }

    const logPath = consoleLogPath(String(server.installPath));
    const { open, stat } = await import("node:fs/promises");
    let size: number;
    try {
      size = (await stat(logPath)).size;
    } catch {
      return NextResponse.json({ lines: [], note: "No console output captured yet — start the server to begin capturing." });
    }
    if (size === 0) {
      return NextResponse.json({ lines: [], note: "Console log is empty." });
    }

    const window = Math.min(size, READ_WINDOW_BYTES);
    const buf = Buffer.alloc(window);
    const handle = await open(logPath, "r");
    try {
      await handle.read(buf, 0, window, size - window);
    } finally {
      await handle.close();
    }

    return NextResponse.json({
      lines: tailLines(buf.toString("utf8"), lines, size <= READ_WINDOW_BYTES),
      size,
    });
  } catch (e: unknown) {
    return apiError(e, "Failed to read console", 500);
  }
}

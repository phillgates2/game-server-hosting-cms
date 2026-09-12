import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { apiError } from "@/lib/api-error";
import { intParam } from "@/lib/pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/[id]/log?tail=200&offset=0
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!((await hasPermission(auth.userId, "servers.view.logs", auth.keyScope)) || (await hasPermission(auth.userId, "servers.edit", auth.keyScope)))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [server] = await db
      .select({
        id: gameServers.id,
        userId: gameServers.userId,
        installPath: gameServers.installPath,
        status: gameServers.status,
        pid: gameServers.pid,
        nodeIsLocal: nodes.isLocal,
        nodeApiUrl: nodes.apiUrl,
        nodeApiKey: nodes.apiKey,
      })
      .from(gameServers)
      .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    // Raw parseInt let "-5" return an empty log (indistinguishable from a
    // server that produced no output) and "1e9" return a single line, because
    // parseInt stops at the "e". Clamped to a sane range instead.
    const tailLines = intParam(url.searchParams.get("tail"), 200, 1, 5000);

    // Remote node: the log lives on the agent's machine.
    if (server.nodeIsLocal === false) {
      if (!server.nodeApiUrl || !server.nodeApiKey) {
        return NextResponse.json({ error: "This server's node has no agent URL/key configured." }, { status: 400 });
      }
      const { remoteLogTail } = await import("@/lib/node-client");
      try {
        const log = await remoteLogTail(
          { apiUrl: server.nodeApiUrl, apiKey: server.nodeApiKey },
          server.installPath,
          tailLines
        );
        return NextResponse.json({ log, lines: log ? log.split("\n").length : 0, offset: 0, fileSizeKb: 0, status: server.status, pid: server.pid });
      } catch (e: unknown) {
        return NextResponse.json({ error: `Node agent: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
      }
    }

    const logPath = join(server.installPath, "gsm-server.log");

    let content = "";
    let fileSize = 0;
    try {
      const s = await stat(logPath);
      fileSize = s.size;

      if (fileSize > 2 * 1024 * 1024) {
        // For large files, read only the last chunk
        const { createReadStream } = await import("fs");
        const start = Math.max(0, fileSize - 256 * 1024); // last 256KB
        const stream = createReadStream(logPath, { start, encoding: "utf8" });
        const chunks: string[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk as string);
        }
        content = chunks.join("");
        // Trim to complete lines
        const firstNewline = content.indexOf("\n");
        if (firstNewline > 0 && start > 0) {
          content = content.slice(firstNewline + 1);
        }
      } else {
        content = await readFile(logPath, "utf8");
      }
    } catch {
      return NextResponse.json({
        log: "",
        lines: 0,
        fileSize: 0,
        status: server.status,
        pid: server.pid,
        message: "No log file yet. Start the server first.",
      });
    }

    // Tail to requested line count
    const allLines = content.split("\n");
    const lines = allLines.slice(-tailLines);

    // Strip ANSI color codes for clean display
    const clean = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[[\d;]*m/g, ""));

    return NextResponse.json({
      log: clean.join("\n"),
      lines: clean.length,
      totalLines: allLines.length,
      fileSize,
      fileSizeKb: Math.round(fileSize / 1024),
      status: server.status,
      pid: server.pid,
    });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

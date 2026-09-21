import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, nodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getServer(id: number) {
  const [server] = await db
    .select({
      id: gameServers.id,
      userId: gameServers.userId,
      installPath: gameServers.installPath,
      nodeIsLocal: nodes.isLocal,
      nodeApiUrl: nodes.apiUrl,
      nodeApiKey: nodes.apiKey,
    })
    .from(gameServers)
    .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
    .where(eq(gameServers.id, id))
    .limit(1);
  return server || null;
}

type ServerRow = Awaited<ReturnType<typeof getServer>> & object;

function remoteNodeOf(server: NonNullable<ServerRow>): { apiUrl: string; apiKey: string } | null {
  if (server.nodeIsLocal !== false) return null;
  if (!server.nodeApiUrl || !server.nodeApiKey) return null;
  return { apiUrl: server.nodeApiUrl, apiKey: server.nodeApiKey };
}

// GET — Browse a SQLite database inside a server directory (read-only).
//
//   action=tables                      → { tables: [{ name, kind, rows, sql }] }
//   action=rows&table=<name>&limit&offset → { columns, rows, total, ... }
//
// Same guards as the file manager: the caller needs `servers.files` plus
// either panel-wide `servers.edit` or a file-transfer grant on this server.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.files", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const server = await getServer(Number(id));
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

  const canEditAny = await hasPermission(auth.userId, "servers.edit", auth.keyScope);
  if (!canEditAny) {
    const { canTransferToServer } = await import("@/lib/server-collab");
    if (!(await canTransferToServer(server.id, auth.userId, auth.keyScope))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const url = new URL(req.url);
  const reqPath = url.searchParams.get("path") || ".";
  const action = url.searchParams.get("action") || "tables";
  const table = url.searchParams.get("table") || "";
  const limit = Number(url.searchParams.get("limit") || "100");
  const offset = Number(url.searchParams.get("offset") || "0");

  // Remote node: the database lives on the agent's machine, so it browses.
  const remoteNode = remoteNodeOf(server);
  if (remoteNode) {
    const { remoteFs } = await import("@/lib/node-client");
    try {
      if (action === "rows") {
        if (!table) return NextResponse.json({ error: "Table is required" }, { status: 400 });
        const r = await remoteFs(remoteNode, "dbrows", {
          installPath: server.installPath,
          path: reqPath,
          table,
          limit,
          offset,
        });
        return NextResponse.json(r);
      }
      const r = await remoteFs(remoteNode, "dbtables", {
        installPath: server.installPath,
        path: reqPath,
      });
      return NextResponse.json(r);
    } catch (e: unknown) {
      return NextResponse.json({ error: `Node agent: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
    }
  }

  try {
    const fileOps = await import("@/lib/server-file-ops");
    const { fullPath, stat: s, relPath } = await fileOps.getPathStat(server.installPath, reqPath);
    if (!s.isFile()) {
      return NextResponse.json({ error: "Path is not a file" }, { status: 400 });
    }

    const browser = await import("@/lib/sqlite-browser");
    const { basename } = await import("node:path");

    if (action === "rows") {
      if (!table) return NextResponse.json({ error: "Table is required" }, { status: 400 });
      try {
        const page = await browser.readDbRows(fullPath, table, { limit, offset });
        return NextResponse.json({
          type: "dbrows" as const,
          path: relPath,
          name: basename(fullPath),
          size: s.size,
          ...page,
        });
      } catch (e: unknown) {
        const { SqliteBrowseError } = browser;
        if (e instanceof SqliteBrowseError) {
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        throw e;
      }
    }

    try {
      const tables = await browser.listDbTables(fullPath);
      return NextResponse.json({
        type: "db" as const,
        path: relPath,
        name: basename(fullPath),
        size: s.size,
        tables,
      });
    } catch (e: unknown) {
      const { SqliteBrowseError } = browser;
      if (e instanceof SqliteBrowseError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  } catch (e: unknown) {
    return apiError(e, "Failed to browse database", 500);
  }
}

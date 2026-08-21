import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
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
    })
    .from(gameServers)
    .where(eq(gameServers.id, id))
    .limit(1);
  return server || null;
}

// GET — List directory or read file
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.files"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const server = await getServer(Number(id));
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

  if (server.userId !== auth.userId && !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const reqPath = url.searchParams.get("path") || ".";
  const action = url.searchParams.get("action") || "list"; // list | read | download

  try {
    const fileOps = await import("@/lib/server-file-ops");
    const { stat: s } = await fileOps.getPathStat(server.installPath, reqPath);

    if (action === "download" && s.isFile()) {
      const { content, fileName } = await fileOps.readBinary(server.installPath, reqPath);
      return new NextResponse(content, {
        headers: {
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(content.length),
        },
      });
    }

    if (s.isFile()) {
      const result = await fileOps.readText(server.installPath, reqPath);
      return NextResponse.json(result);
    }

    const result = await fileOps.listDirectory(server.installPath, reqPath);
    return NextResponse.json(result);
  } catch (e: unknown) {
    return apiError(e, "Failed to read path", 500);
  }
}

// POST — Create file, create directory, rename, delete, upload (save content)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.files"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const server = await getServer(Number(id));
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

  if (server.userId !== auth.userId && !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const fileOps = await import("@/lib/server-file-ops");
    const body = await req.json();
    const { action, path: reqPath, content, newName, newPath, paths, targetDir } = body;

    if (!action) return NextResponse.json({ error: "Action required" }, { status: 400 });

    if (action === "save") {
      await fileOps.writeTextFile(server.installPath, reqPath, content || "");
      return NextResponse.json({ ok: true });
    }

    if (action === "createFile") {
      await fileOps.writeTextFile(server.installPath, reqPath, content || "");
      return NextResponse.json({ ok: true });
    }

    if (action === "createDir") {
      await fileOps.createDirectory(server.installPath, reqPath);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      await fileOps.deletePath(server.installPath, reqPath);
      return NextResponse.json({ ok: true });
    }

    if (action === "rename") {
      const sourcePath = String(reqPath || "");
      const nextPath = String(newPath || "");
      const fallback = sourcePath.split("/").slice(0, -1).concat(String(newName || "")).join("/");
      await fileOps.renamePath(server.installPath, sourcePath, nextPath || fallback);
      return NextResponse.json({ ok: true });
    }

    if (action === "deleteMany") {
      const selected: string[] = Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : [];
      if (selected.length === 0) return NextResponse.json({ error: "No paths selected" }, { status: 400 });
      const result = await fileOps.deleteMany(server.installPath, selected);
      return NextResponse.json(result, { status: result.ok ? 200 : 207 });
    }

    if (action === "moveMany") {
      const selected: string[] = Array.isArray(paths) ? paths.filter((p) => typeof p === "string") : [];
      if (selected.length === 0) return NextResponse.json({ error: "No paths selected" }, { status: 400 });
      if (!targetDir || typeof targetDir !== "string") {
        return NextResponse.json({ error: "Target directory is required" }, { status: 400 });
      }
      const result = await fileOps.moveMany(server.installPath, selected, targetDir);
      return NextResponse.json(result, { status: result.ok ? 200 : 207 });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

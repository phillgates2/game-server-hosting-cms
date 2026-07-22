import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { readdir, stat, readFile, writeFile, mkdir, rm, rename } from "fs/promises";
import { join, resolve, relative, extname, basename } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ensure the resolved path stays inside the server's install directory
function safePath(basePath: string, requestedPath: string): string | null {
  const resolved = resolve(basePath, requestedPath || ".");
  if (!resolved.startsWith(resolve(basePath))) return null;
  return resolved;
}

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

  const { id } = await params;
  const server = await getServer(Number(id));
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

  if (server.userId !== auth.userId && !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const reqPath = url.searchParams.get("path") || ".";
  const action = url.searchParams.get("action") || "list"; // list | read | download

  const fullPath = safePath(server.installPath, reqPath);
  if (!fullPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 403 });

  try {
    const s = await stat(fullPath);

    if (action === "download" && s.isFile()) {
      const content = await readFile(fullPath);
      return new NextResponse(content, {
        headers: {
          "Content-Disposition": `attachment; filename="${basename(fullPath)}"`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(content.length),
        },
      });
    }

    if (s.isFile()) {
      // Read file content (text files only, cap at 2MB)
      if (s.size > 2 * 1024 * 1024) {
        return NextResponse.json({
          type: "file",
          path: relative(server.installPath, fullPath),
          name: basename(fullPath),
          size: s.size,
          tooLarge: true,
          content: null,
        });
      }
      const content = await readFile(fullPath, "utf8");
      return NextResponse.json({
        type: "file",
        path: relative(server.installPath, fullPath),
        name: basename(fullPath),
        size: s.size,
        modified: s.mtime.toISOString(),
        content,
      });
    }

    // Directory listing
    const entries = await readdir(fullPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      try {
        const entryPath = join(fullPath, entry.name);
        const entryStat = await stat(entryPath);
        items.push({
          name: entry.name,
          path: relative(server.installPath, entryPath),
          isDir: entry.isDirectory(),
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
          ext: entry.isFile() ? extname(entry.name).slice(1) : null,
        });
      } catch {
        items.push({ name: entry.name, path: entry.name, isDir: entry.isDirectory(), size: 0, modified: "", ext: null });
      }
    }

    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      type: "directory",
      path: relative(server.installPath, fullPath) || ".",
      items,
      basePath: server.installPath,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to read path" }, { status: 500 });
  }
}

// POST — Create file, create directory, rename, delete, upload (save content)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const server = await getServer(Number(id));
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

  if (server.userId !== auth.userId && !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { action, path: reqPath, content, newName, newPath } = body;

    if (!action) return NextResponse.json({ error: "Action required" }, { status: 400 });

    if (action === "save") {
      const fullPath = safePath(server.installPath, reqPath);
      if (!fullPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 403 });
      await writeFile(fullPath, content || "", "utf8");
      return NextResponse.json({ ok: true });
    }

    if (action === "createFile") {
      const fullPath = safePath(server.installPath, reqPath);
      if (!fullPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 403 });
      await writeFile(fullPath, content || "", "utf8");
      return NextResponse.json({ ok: true });
    }

    if (action === "createDir") {
      const fullPath = safePath(server.installPath, reqPath);
      if (!fullPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 403 });
      await mkdir(fullPath, { recursive: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const fullPath = safePath(server.installPath, reqPath);
      if (!fullPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 403 });
      if (fullPath === resolve(server.installPath)) return NextResponse.json({ error: "Cannot delete root" }, { status: 400 });
      await rm(fullPath, { recursive: true, force: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "rename") {
      const fullPath = safePath(server.installPath, reqPath);
      const fullNewPath = safePath(server.installPath, newPath || join(reqPath, "..", newName));
      if (!fullPath || !fullNewPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 403 });
      await rename(fullPath, fullNewPath);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

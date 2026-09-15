import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { db } from "@/db";
import { gameServers, nodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { sanitizeEntryName } from "@/lib/ftp-protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streamed (single-shot) upload for large files.
 *
 * The multipart route reads the whole file into memory before writing it: fine
 * for a plugin jar, fatal for a 4 GB world archive on a panel box with 2 GB of
 * RAM. This endpoint takes the file as the raw request body and pipes it
 * straight to disk, so memory use is a constant ~64 KB per upload no matter
 * how large the file is.
 *
 * The write is atomic — bytes land in a hidden `.part` file in the destination
 * directory and are renamed into place only once the last chunk arrived, so an
 * interrupted upload can never leave a truncated file where the game reads it.
 *
 * Clients that can do better than a single request (every FTP client you can
 * name) should use the built-in FTP/FTPS server instead; this exists for the
 * panel's own drag-and-drop.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.files", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const targetDir = url.searchParams.get("path") || ".";
  const fileName = url.searchParams.get("name") || "";
  if (!fileName) return NextResponse.json({ error: "A file name is required" }, { status: 400 });

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

  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
  // Owner, a panel-wide `servers.edit` holder, or a per-server file-transfer
  // grant — the same rule the FTP login path applies, so a shared server
  // behaves identically whichever way the file arrives.
  const canEditAny = await hasPermission(auth.userId, "servers.edit", auth.keyScope);
  if (!canEditAny) {
    const { canTransferToServer } = await import("@/lib/server-collab");
    if (!(await canTransferToServer(server.id, auth.userId, auth.keyScope))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (server.nodeIsLocal === false) {
    // The node agent has no streamed-write RPC; the caller falls back to the
    // multipart route, which proxies to it.
    return NextResponse.json(
      { error: "Streamed uploads are only supported for servers on this machine", fallback: "multipart" },
      { status: 400 }
    );
  }
  if (!req.body) return NextResponse.json({ error: "Request body is empty" }, { status: 400 });

  const fileOps = await import("@/lib/server-file-ops");
  const finalPath = fileOps.safePath(server.installPath, join(/* turbopackIgnore: true */ targetDir, fileName));
  if (!finalPath) return NextResponse.json({ error: "Path outside server directory" }, { status: 400 });

  // A name is a name, not a path: the same single-entry rule the FTP server
  // applies to STOR/RNTO.
  const safeName = sanitizeEntryName(fileName);
  if (!safeName) return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  const partPath = join(
    /* turbopackIgnore: true */ dirname(finalPath),
    `.gsm-upload-${randomBytes(8).toString("hex")}.part`
  );

  try {
    await mkdir(dirname(finalPath), { recursive: true });
    const source = Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(source, createWriteStream(partPath, { flags: "wx" }));
    await rename(partPath, finalPath);
    const { size } = await (await import("node:fs/promises")).stat(finalPath);
    return NextResponse.json({ ok: true, name: safeName, size, path: fileOps.relativePathOf(server.installPath, finalPath) });
  } catch (e: unknown) {
    // A failed or aborted upload must not leave debris behind.
    await rm(partPath, { force: true }).catch(() => undefined);
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOSPC") {
      return NextResponse.json({ error: "No space left on the panel machine" }, { status: 507 });
    }
    return apiError(e, "Upload failed", 500);
  }
}

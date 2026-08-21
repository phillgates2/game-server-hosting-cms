import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — Upload a file via multipart form data
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

  try {
    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId, installPath: gameServers.installPath })
      .from(gameServers)
      .where(eq(gameServers.id, Number(id)))
      .limit(1);

    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });

    if (server.userId !== auth.userId && !(await hasPermission(auth.userId, "servers.edit"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const targetDir = (formData.get("path") as string) || ".";

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    // Write the uploaded file
    const bytes = await file.arrayBuffer();
    const fileOps = await import("@/lib/server-file-ops");
    const result = await fileOps.saveUploadedFile(server.installPath, targetDir, file.name, Buffer.from(bytes));

    return NextResponse.json({
      ok: true,
      name: result.name,
      size: file.size,
      path: result.path,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}

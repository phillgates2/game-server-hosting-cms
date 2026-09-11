import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, serverChanges, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { desc, eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { CHANGE_LIST_MAX } from "@/lib/server-changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/servers/[id]/changes — recent field-level edits, newest first.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  try {
    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId })
      .from(gameServers)
      .where(eq(gameServers.id, idNum))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await db
      .select({
        field: serverChanges.field,
        fromValue: serverChanges.fromValue,
        toValue: serverChanges.toValue,
        createdAt: serverChanges.createdAt,
        username: users.username,
      })
      .from(serverChanges)
      .leftJoin(users, eq(serverChanges.userId, users.id))
      .where(eq(serverChanges.serverId, idNum))
      .orderBy(desc(serverChanges.createdAt))
      .limit(CHANGE_LIST_MAX);

    return NextResponse.json({
      changes: rows.map((r) => ({
        field: r.field,
        from: r.fromValue,
        to: r.toValue,
        at: r.createdAt.toISOString(),
        by: r.username ?? null,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load change history", 500);
  }
}

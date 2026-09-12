import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, serverEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, and, desc, inArray } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many changelog rows the panel asks for. */
export const UPDATE_HISTORY_MAX = 25;

// GET /api/servers/[id]/updates — the server's update changelog
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const [server] = await db
      .select({ id: gameServers.id, userId: gameServers.userId })
      .from(gameServers)
      .where(eq(gameServers.id, Number(id)))
      .limit(1);
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (auth.role !== "admin" && server.userId !== auth.userId) {
      const { getCollaboratorRole } = await import("@/lib/server-collab");
      const collabRole = await getCollaboratorRole(server.id, auth.userId);
      if (!collabRole) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { ensureServerEventsTable } = await import("@/lib/server-events");
    await ensureServerEventsTable();
    const rows = await db
      .select({
        kind: serverEvents.kind,
        detail: serverEvents.detail,
        createdAt: serverEvents.createdAt,
      })
      .from(serverEvents)
      .where(and(eq(serverEvents.serverId, server.id), inArray(serverEvents.kind, ["updated", "update-report"])))
      .orderBy(desc(serverEvents.createdAt))
      .limit(UPDATE_HISTORY_MAX);

    return NextResponse.json({ updates: rows });
  } catch (e: unknown) {
    return apiError(e, "Failed to load update history", 500);
  }
}

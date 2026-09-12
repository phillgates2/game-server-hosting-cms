import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { generateStatusToken } from "@/lib/status-share";
import { apiError } from "@/lib/api-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Upgrades predate the share link; add the column lazily on first use. */
async function ensureStatusTokenColumn() {
  await db.execute(sql`ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS status_token VARCHAR(64) UNIQUE`);
}

async function loadOwnedServer(id: number, auth: { userId: number; role: string }) {
  const [server] = await db
    .select({ id: gameServers.id, userId: gameServers.userId, name: gameServers.name, statusToken: gameServers.statusToken })
    .from(gameServers)
    .where(eq(gameServers.id, id))
    .limit(1);
  if (!server) return { error: "Not found", status: 404 } as const;
  if (auth.role !== "admin" && server.userId !== auth.userId) {
    return { error: "Forbidden", status: 403 } as const;
  }
  return { server };
}

// POST /api/servers/[id]/status-link — create or rotate the share token
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.edit", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const serverId = Number(id);
  if (!Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  try {
    await ensureStatusTokenColumn();
    const found = await loadOwnedServer(serverId, auth);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status });

    // Every POST rotates: handing out a link is trust, and a leaked one must
    // be replaceable without deleting the server.
    const token = generateStatusToken();
    await db
      .update(gameServers)
      .set({ statusToken: token, updatedAt: new Date() })
      .where(eq(gameServers.id, serverId));

    return NextResponse.json({ ok: true, token, url: `/status/${token}` });
  } catch (e: unknown) {
    return apiError(e, "Could not create status link", 500);
  }
}

// DELETE /api/servers/[id]/status-link — revoke the share link
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.edit", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const serverId = Number(id);
  if (!Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  try {
    await ensureStatusTokenColumn();
    const found = await loadOwnedServer(serverId, auth);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status });

    await db
      .update(gameServers)
      .set({ statusToken: null, updatedAt: new Date() })
      .where(eq(gameServers.id, serverId));

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Could not revoke status link", 500);
  }
}

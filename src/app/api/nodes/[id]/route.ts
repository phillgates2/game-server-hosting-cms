import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

// GET /api/nodes/[id] - Get single node details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, Number(id))).limit(1);

    if (!node) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    // Get servers on this node
    const servers = await db
      .select({
        id: gameServers.id,
        name: gameServers.name,
        status: gameServers.status,
        port: gameServers.port,
      })
      .from(gameServers)
      .where(eq(gameServers.nodeId, Number(id)));

    return NextResponse.json({ node, servers });
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}

// PATCH /api/nodes/[id] - Update a node
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "nodes.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    // If setting as default, unset other defaults
    if (body.isDefault) {
      await db.update(nodes).set({ isDefault: false });
    }

    const [updated] = await db
      .update(nodes)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(nodes.id, Number(id)))
      .returning();

    return NextResponse.json({ node: updated });
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}

// DELETE /api/nodes/[id] - Delete a node
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "nodes.delete"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Check if node has servers
    const serverCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gameServers)
      .where(eq(gameServers.nodeId, Number(id)));

    if (serverCount[0]?.count > 0) {
      return NextResponse.json(
        { error: "Cannot delete node with active servers. Move or delete servers first." },
        { status: 400 }
      );
    }

    await db.delete(nodes).where(eq(nodes.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Unknown error", 500);
  }
}

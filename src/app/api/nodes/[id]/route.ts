import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { nodes, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { publicNode, pickNodePatch } from "@/lib/server-lifecycle";

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
    const [row] = await db.select().from(nodes).where(eq(nodes.id, Number(id))).limit(1);
    // Never ship SSH credentials or the node API key to a browser: nodes.view
    // is held by the built-in moderator role.
    const node = row ? publicNode(row) : undefined;

    if (!row || !node) {
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

    const { updates, rejected } = pickNodePatch(body);
    if (rejected.length) {
      return NextResponse.json(
        { error: `Unknown or read-only field(s): ${rejected.join(", ")}` },
        { status: 400 }
      );
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const [updated] = await db
      .update(nodes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(nodes.id, Number(id)))
      .returning();

    return NextResponse.json({ node: updated ? publicNode(updated) : updated });
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

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameServers, serverCollaborators, users, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, and } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import {
  ensureServerCollaboratorsTable,
  isCollaboratorRole,
  type CollaboratorRole,
} from "@/lib/server-collab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadServer(id: number) {
  const [server] = await db
    .select({ id: gameServers.id, name: gameServers.name, userId: gameServers.userId })
    .from(gameServers)
    .where(eq(gameServers.id, id))
    .limit(1);
  return server ?? null;
}

/** Only the server owner or an admin may manage sharing. */
function canManageSharing(auth: { userId: number; role: string }, server: { userId: number | null }): boolean {
  return auth.role === "admin" || server.userId === auth.userId;
}

// GET /api/servers/[id]/collaborators — list (owner/admin only)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const server = await loadServer(Number(id));
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canManageSharing({ userId: auth.userId as number, role: auth.role }, server)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ensureServerCollaboratorsTable();
    const rows = await db
      .select({
        id: serverCollaborators.id,
        userId: serverCollaborators.userId,
        role: serverCollaborators.role,
        createdAt: serverCollaborators.createdAt,
        email: users.email,
      })
      .from(serverCollaborators)
      .leftJoin(users, eq(serverCollaborators.userId, users.id))
      .where(eq(serverCollaborators.serverId, server.id));

    return NextResponse.json({
      collaborators: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        email: r.email,
        role: r.role,
        createdAt: r.createdAt,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Failed to list collaborators", 500);
  }
}

// POST /api/servers/[id]/collaborators — { userId, role } (owner/admin only)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const role = b.role;
  if (!isCollaboratorRole(role)) {
    return NextResponse.json({ error: "role must be viewer or operator" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const server = await loadServer(Number(id));
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canManageSharing({ userId: auth.userId as number, role: auth.role }, server)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Resolve the target user by id or (case-insensitive) email.
    let target: { id: number } | undefined;
    if (typeof b.email === "string" && b.email.trim()) {
      const { sql } = await import("drizzle-orm");
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = lower(${b.email.trim()})`)
        .limit(1);
      target = rows[0];
    } else {
      const targetUserId = Number(b.userId);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return NextResponse.json({ error: "userId must be a positive integer (or pass email)" }, { status: 400 });
      }
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, targetUserId)).limit(1);
      target = rows[0];
    }
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetUserId = target.id;
    if (targetUserId === server.userId) {
      return NextResponse.json({ error: "The owner already has full access" }, { status: 400 });
    }

    await ensureServerCollaboratorsTable();
    const [existing] = await db
      .select({ id: serverCollaborators.id })
      .from(serverCollaborators)
      .where(and(eq(serverCollaborators.serverId, server.id), eq(serverCollaborators.userId, targetUserId)))
      .limit(1);
    if (existing) {
      return NextResponse.json({ error: "Already a collaborator — update their role instead" }, { status: 409 });
    }

    const [row] = await db
      .insert(serverCollaborators)
      .values({
        serverId: server.id,
        userId: targetUserId,
        role: role as CollaboratorRole,
        grantedBy: auth.userId as number,
      })
      .returning({ id: serverCollaborators.id });

    try {
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "server.collaborator.add",
        entityType: "server",
        entityId: server.id,
        details: { targetUserId, role, serverName: server.name },
        ipAddress:
          (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 45),
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Failed to add collaborator", 500);
  }
}

// PATCH /api/servers/[id]/collaborators — { userId, role } update role (owner/admin)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const targetUserId = Number(b.userId);
  const role = b.role;
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return NextResponse.json({ error: "userId must be a positive integer" }, { status: 400 });
  }
  if (!isCollaboratorRole(role)) {
    return NextResponse.json({ error: "role must be viewer or operator" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const server = await loadServer(Number(id));
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canManageSharing({ userId: auth.userId as number, role: auth.role }, server)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ensureServerCollaboratorsTable();
    const [updated] = await db
      .update(serverCollaborators)
      .set({ role: role as CollaboratorRole })
      .where(and(eq(serverCollaborators.serverId, server.id), eq(serverCollaborators.userId, targetUserId)))
      .returning({ id: serverCollaborators.id });
    if (!updated) return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed to update collaborator", 500);
  }
}

// DELETE /api/servers/[id]/collaborators — { userId } (owner/admin, or self-removal)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const targetUserId = Number(b.userId);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return NextResponse.json({ error: "userId must be a positive integer" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const server = await loadServer(Number(id));
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const manager = canManageSharing({ userId: auth.userId as number, role: auth.role }, server);
    const selfRemoval = targetUserId === (auth.userId as number);
    if (!manager && !selfRemoval) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ensureServerCollaboratorsTable();
    const [removed] = await db
      .delete(serverCollaborators)
      .where(and(eq(serverCollaborators.serverId, server.id), eq(serverCollaborators.userId, targetUserId)))
      .returning({ id: serverCollaborators.id });
    if (!removed) return NextResponse.json({ error: "Collaborator not found" }, { status: 404 });

    try {
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "server.collaborator.remove",
        entityType: "server",
        entityId: server.id,
        details: { targetUserId, serverName: server.name, self: selfRemoval && !manager },
        ipAddress:
          (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 45),
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed to remove collaborator", 500);
  }
}

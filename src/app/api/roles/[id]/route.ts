import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { roles } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, invalidateRoleCache } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// PATCH /api/roles/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "roles.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.displayName !== undefined) update.displayName = body.displayName;
    if (body.color !== undefined) update.color = body.color;
    if (body.icon !== undefined) update.icon = body.icon;
    if (body.permissions !== undefined) update.permissions = body.permissions;
    if (body.priority !== undefined) update.priority = body.priority;
    if (body.isDefault !== undefined) update.isDefault = body.isDefault;

    const [updated] = await db.update(roles).set(update).where(eq(roles.id, Number(id))).returning();
    invalidateRoleCache();
    return NextResponse.json({ role: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// DELETE /api/roles/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "roles.delete"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [role] = await db.select().from(roles).where(eq(roles.id, Number(id))).limit(1);
    if (!role) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (role.isSystem) return NextResponse.json({ error: "Cannot delete system roles" }, { status: 400 });

    await db.delete(roles).where(eq(roles.id, Number(id)));
    invalidateRoleCache();
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

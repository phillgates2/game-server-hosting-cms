import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { serverBlueprints } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { validateBlueprintInput, ensureServerBlueprintsTable } from "@/lib/blueprints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadBlueprint(id: number) {
  const [row] = await db.select().from(serverBlueprints).where(eq(serverBlueprints.id, id)).limit(1);
  return row ?? null;
}

function canAccess(auth: { userId: number; role: string }, blueprint: { userId: number | null }): boolean {
  return auth.role === "admin" || blueprint.userId === auth.userId;
}

// GET /api/blueprints/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    await ensureServerBlueprintsTable();
    const blueprint = await loadBlueprint(Number(id));
    if (!blueprint) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canAccess({ userId: auth.userId as number, role: auth.role }, blueprint)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ blueprint });
  } catch (e: unknown) {
    return apiError(e, "Failed to load blueprint", 500);
  }
}

// PATCH /api/blueprints/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.create", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const valid = validateBlueprintInput(body);
  if (!valid.ok || !valid.value) {
    return NextResponse.json({ error: valid.error || "Invalid blueprint" }, { status: 400 });
  }

  try {
    const { id } = await params;
    await ensureServerBlueprintsTable();
    const blueprint = await loadBlueprint(Number(id));
    if (!blueprint) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canAccess({ userId: auth.userId as number, role: auth.role }, blueprint)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .update(serverBlueprints)
      .set({
        name: valid.value.name,
        description: valid.value.description,
        entries: valid.value.entries,
        updatedAt: new Date(),
      })
      .where(eq(serverBlueprints.id, blueprint.id));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed to update blueprint", 500);
  }
}

// DELETE /api/blueprints/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.create", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await ensureServerBlueprintsTable();
    const blueprint = await loadBlueprint(Number(id));
    if (!blueprint) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canAccess({ userId: auth.userId as number, role: auth.role }, blueprint)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.delete(serverBlueprints).where(eq(serverBlueprints.id, blueprint.id));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed to delete blueprint", 500);
  }
}

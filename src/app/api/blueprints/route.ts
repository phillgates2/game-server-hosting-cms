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

// GET /api/blueprints — own blueprints (admins see all)
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await ensureServerBlueprintsTable();
    const rows = await db
      .select()
      .from(serverBlueprints)
      .orderBy(serverBlueprints.createdAt);
    const visible = rows
      .filter((r) => auth.role === "admin" || r.userId === auth.userId)
      .map((r) => ({ ...r, mine: r.userId === auth.userId }));
    return NextResponse.json({ blueprints: visible });
  } catch (e: unknown) {
    return apiError(e, "Failed to list blueprints", 500);
  }
}

// POST /api/blueprints — create
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "servers.create"))) {
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
    await ensureServerBlueprintsTable();
    const [row] = await db
      .insert(serverBlueprints)
      .values({
        userId: auth.userId as number,
        name: valid.value.name,
        description: valid.value.description,
        entries: valid.value.entries,
      })
      .returning({ id: serverBlueprints.id });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Failed to create blueprint", 500);
  }
}

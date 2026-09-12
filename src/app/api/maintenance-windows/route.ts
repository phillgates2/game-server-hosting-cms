import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { maintenanceWindows, nodes, auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { asc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { validateMaintenanceWindowInput, ensureMaintenanceWindowsTable } from "@/lib/maintenance-windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/maintenance-windows — open (uncompleted) windows
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.view", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    await ensureMaintenanceWindowsTable();
    const { isNull, eq } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: maintenanceWindows.id,
        nodeId: maintenanceWindows.nodeId,
        startsAt: maintenanceWindows.startsAt,
        endsAt: maintenanceWindows.endsAt,
        reason: maintenanceWindows.reason,
        appliedAt: maintenanceWindows.appliedAt,
        nodeName: nodes.name,
      })
      .from(maintenanceWindows)
      .leftJoin(nodes, eq(maintenanceWindows.nodeId, nodes.id))
      .where(isNull(maintenanceWindows.completedAt))
      .orderBy(asc(maintenanceWindows.startsAt));
    return NextResponse.json({
      windows: rows.map((r) => ({
        id: r.id,
        nodeId: r.nodeId,
        nodeName: r.nodeName,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        reason: r.reason,
        applied: r.appliedAt !== null,
      })),
    });
  } catch (e: unknown) {
    return apiError(e, "Failed to list maintenance windows", 500);
  }
}

// POST /api/maintenance-windows — { nodeId, startsAt, endsAt, reason? }
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.maintenance", auth.keyScope))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const valid = validateMaintenanceWindowInput(body, Date.now());
  if (!valid.ok || !valid.value) {
    return NextResponse.json({ error: valid.error || "Invalid window" }, { status: 400 });
  }

  try {
    const [node] = await db.select({ id: nodes.id }).from(nodes).where(
      (await import("drizzle-orm")).eq(nodes.id, valid.value.nodeId)
    ).limit(1);
    if (!node) return NextResponse.json({ error: "Node not found" }, { status: 404 });

    await ensureMaintenanceWindowsTable();
    const [row] = await db
      .insert(maintenanceWindows)
      .values({
        nodeId: valid.value.nodeId,
        startsAt: valid.value.startsAt,
        endsAt: valid.value.endsAt,
        reason: valid.value.reason,
        createdBy: auth.userId as number,
      })
      .returning({ id: maintenanceWindows.id });

    try {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      await db.insert(auditLog).values({
        userId: auth.userId as number,
        action: "maintenance-window.schedule",
        entityType: "node",
        entityId: valid.value.nodeId,
        details: { startsAt: valid.value.startsAt.toISOString(), endsAt: valid.value.endsAt.toISOString(), reason: valid.value.reason },
        ipAddress: ip.slice(0, 45),
      });
    } catch {
      /* best-effort */
    }

    return NextResponse.json({ ok: true, id: row.id });
  } catch (e: unknown) {
    return apiError(e, "Failed to schedule maintenance window", 500);
  }
}

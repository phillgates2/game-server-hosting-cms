import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { maintenanceWindows } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { ensureMaintenanceWindowsTable } from "@/lib/maintenance-windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/maintenance-windows/[id] — cancel a window (admin or node manager)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "nodes.maintenance"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await ensureMaintenanceWindowsTable();
    const [win] = await db
      .select({ id: maintenanceWindows.id, completedAt: maintenanceWindows.completedAt })
      .from(maintenanceWindows)
      .where(eq(maintenanceWindows.id, Number(id)))
      .limit(1);
    if (!win) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Deleting the row is enough: an unapplied window never flips the node,
    // and an applied-but-open window stays applied until the scheduler closes
    // it — except when we cancel it NOW, in which case release the node too.
    if (win.completedAt === null) {
      const [full] = await db
        .select({ appliedAt: maintenanceWindows.appliedAt, nodeId: maintenanceWindows.nodeId })
        .from(maintenanceWindows)
        .where(eq(maintenanceWindows.id, win.id))
        .limit(1);
      if (full && full.appliedAt) {
        const { nodes } = await import("@/db/schema");
        await db.update(nodes).set({ maintenanceMode: false }).where(eq(nodes.id, full.nodeId));
      }
      await db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, win.id));
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed to cancel maintenance window", 500);
  }
}

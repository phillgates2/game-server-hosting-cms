import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTasks } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// PATCH /api/scheduler/[id] — Update a task
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const update: Record<string, unknown> = {};
    if (body.enabled !== undefined) update.enabled = body.enabled;
    if (body.cronExpression !== undefined) update.cronExpression = body.cronExpression;
    if (body.taskType !== undefined) update.taskType = body.taskType;
    if (body.command !== undefined) update.command = body.command;

    const [updated] = await db.update(scheduledTasks).set(update).where(eq(scheduledTasks.id, Number(id))).returning();
    return NextResponse.json({ task: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// DELETE /api/scheduler/[id] — Delete a task
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await db.delete(scheduledTasks).where(eq(scheduledTasks.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

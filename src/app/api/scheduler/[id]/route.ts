import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTasks, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { parseCron, nextCronRun } from "@/lib/cron";
import { TASK_TYPES, MAX_COMMAND_LENGTH } from "@/lib/scheduler";

// PATCH /api/scheduler/[id] — Update a task
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || (!(await hasPermission(auth.userId, "scheduler.edit")) && !(await hasPermission(auth.userId, "servers.edit")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const [existing] = await db
      .select({ serverId: scheduledTasks.serverId })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, Number(id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // scheduler.edit is admin-only today, but a role could grant it: a
    // non-admin must not touch tasks aimed at someone else's server.
    if (auth.role !== "admin" && existing.serverId) {
      const [owner] = await db
        .select({ userId: gameServers.userId })
        .from(gameServers)
        .where(eq(gameServers.id, existing.serverId))
        .limit(1);
      if (!owner || owner.userId !== auth.userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const update: Record<string, unknown> = {};
    if (body.enabled !== undefined) update.enabled = body.enabled;
    if (body.cronExpression !== undefined) {
      const cron = String(body.cronExpression).trim();
      if (!parseCron(cron)) {
        return NextResponse.json(
          { error: `Invalid cron expression — use a 5-field schedule like "0 4 * * *"` },
          { status: 400 }
        );
      }
      update.cronExpression = cron.slice(0, 64);
      update.nextRun = nextCronRun(cron);
    }
    if (body.taskType !== undefined) {
      if (typeof body.taskType !== "string" || !(TASK_TYPES as readonly string[]).includes(body.taskType)) {
        return NextResponse.json({ error: `taskType must be one of: ${TASK_TYPES.join(", ")}` }, { status: 400 });
      }
      update.taskType = body.taskType;
    }
    if (body.command !== undefined) {
      const cmd = String(body.command ?? "").trim();
      if (cmd.length > MAX_COMMAND_LENGTH) {
        return NextResponse.json({ error: `command is limited to ${MAX_COMMAND_LENGTH} characters` }, { status: 400 });
      }
      update.command = cmd || null;
    }

    const [updated] = await db.update(scheduledTasks).set(update).where(eq(scheduledTasks.id, Number(id))).returning();
    return NextResponse.json({ task: updated });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

// DELETE /api/scheduler/[id] — Delete a task
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || (!(await hasPermission(auth.userId, "scheduler.delete")) && !(await hasPermission(auth.userId, "servers.edit")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  try {
    await db.delete(scheduledTasks).where(eq(scheduledTasks.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

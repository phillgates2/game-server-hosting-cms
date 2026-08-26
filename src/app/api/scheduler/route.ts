import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTasks, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, desc } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { parseCron, nextCronRun } from "@/lib/cron";
import { TASK_TYPES, MAX_COMMAND_LENGTH } from "@/lib/scheduler";

// GET /api/scheduler — List all scheduled tasks
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "scheduler.view")) && !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const tasks = await db
      .select({
        id: scheduledTasks.id,
        serverId: scheduledTasks.serverId,
        taskType: scheduledTasks.taskType,
        cronExpression: scheduledTasks.cronExpression,
        command: scheduledTasks.command,
        enabled: scheduledTasks.enabled,
        lastRun: scheduledTasks.lastRun,
        nextRun: scheduledTasks.nextRun,
        createdAt: scheduledTasks.createdAt,
        serverName: gameServers.name,
      })
      .from(scheduledTasks)
      .leftJoin(gameServers, eq(scheduledTasks.serverId, gameServers.id))
      .orderBy(desc(scheduledTasks.createdAt));

    return NextResponse.json({ tasks });
  } catch {
    return NextResponse.json({ tasks: [] });
  }
}

// POST /api/scheduler — Create a scheduled task
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || (!(await hasPermission(auth.userId, "scheduler.create")) && !(await hasPermission(auth.userId, "servers.edit")))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { serverId, taskType, cronExpression, command, enabled } = body;

    if (serverId === undefined || !taskType || !cronExpression) {
      return NextResponse.json({ error: "serverId, taskType, and cronExpression required" }, { status: 400 });
    }

    // The taskType maps to a switch in the runner; anything else would be
    // silently skipped at run time, so refuse it now.
    if (typeof taskType !== "string" || !(TASK_TYPES as readonly string[]).includes(taskType)) {
      return NextResponse.json({ error: `taskType must be one of: ${TASK_TYPES.join(", ")}` }, { status: 400 });
    }

    // The old "parser" returned +1h for anything it did not understand, so
    // `*/30` silently became a 1-hour-ish schedule. Invalid cron is a 400.
    const cron = String(cronExpression).trim();
    if (!parseCron(cron)) {
      return NextResponse.json(
        { error: `Invalid cron expression — use a 5-field schedule like "0 4 * * *"` },
        { status: 400 }
      );
    }

    const serverIdNum = Number(serverId);
    if (!Number.isInteger(serverIdNum) || serverIdNum <= 0) {
      return NextResponse.json({ error: "Invalid serverId" }, { status: 400 });
    }
    const [target] = await db
      .select({ id: gameServers.id, userId: gameServers.userId })
      .from(gameServers)
      .where(eq(gameServers.id, serverIdNum))
      .limit(1);
    if (!target) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    // scheduler.create is admin-only today, but a role could grant it: never
    // let a non-admin schedule commands against someone else's server.
    if (auth.role !== "admin" && target.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cmd = String(command ?? "").trim();
    if (taskType === "command" && !cmd) {
      return NextResponse.json({ error: "command is required for command tasks" }, { status: 400 });
    }
    if (cmd.length > MAX_COMMAND_LENGTH) {
      return NextResponse.json({ error: `command is limited to ${MAX_COMMAND_LENGTH} characters` }, { status: 400 });
    }

    // The runner advances nextRun itself; this is the initial schedule.
    const nextRun = nextCronRun(cron);

    const [task] = await db.insert(scheduledTasks).values({
      serverId: serverIdNum,
      taskType,
      cronExpression: cron.slice(0, 64),
      command: cmd || null,
      enabled: enabled !== false,
      nextRun,
    }).returning();

    return NextResponse.json({ task }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Failed", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTasks, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { and, eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { nextCronRun } from "@/lib/cron";
import {
  buildDailyRestartCron,
  parseDailyRestartCron,
  normalizeDailyRestartInput,
} from "@/lib/daily-restart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-click daily backups: same strict "M H * * *" shape and the same
// never-clobber-custom-schedules rules as the daily restart toggle — the
// cron builder/parser are shared on purpose.

type BackupTask = {
  id: number;
  cronExpression: string | null;
  enabled: boolean | null;
  nextRun: Date | null;
};

async function loadServerAndTasks(idNum: number) {
  const [server] = await db
    .select({ id: gameServers.id, userId: gameServers.userId })
    .from(gameServers)
    .where(eq(gameServers.id, idNum))
    .limit(1);
  if (!server) return { server: null, tasks: [] as BackupTask[] };
  const tasks = (await db
    .select({
      id: scheduledTasks.id,
      cronExpression: scheduledTasks.cronExpression,
      enabled: scheduledTasks.enabled,
      nextRun: scheduledTasks.nextRun,
    })
    .from(scheduledTasks)
    .where(and(eq(scheduledTasks.serverId, idNum), eq(scheduledTasks.taskType, "backup")))) as BackupTask[];
  return { server, tasks };
}

function dailyTask(tasks: BackupTask[]): { task: BackupTask; hour: number; minute: number } | null {
  for (const task of tasks) {
    const parsed = parseDailyRestartCron(task.cronExpression);
    if (parsed) return { task, ...parsed };
  }
  return null;
}

// GET — current daily-backup state for this server
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !(await hasPermission(auth.userId, "scheduler.view", auth.keyScope)) &&
    !(await hasPermission(auth.userId, "servers.edit", auth.keyScope))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  try {
    const { server, tasks } = await loadServerAndTasks(idNum);
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const daily = dailyTask(tasks);
    if (!daily) return NextResponse.json({ scheduled: false });
    return NextResponse.json({
      scheduled: true,
      enabled: daily.task.enabled !== false,
      hour: daily.hour,
      minute: daily.minute,
      taskId: daily.task.id,
      nextRun: daily.task.nextRun?.toISOString() ?? null,
    });
  } catch (e: unknown) {
    return apiError(e, "Could not load the daily backup schedule", 500);
  }
}

// POST — { enabled, hour?, minute? }: create/update/disable the daily backup
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    !(await hasPermission(auth.userId, "scheduler.create", auth.keyScope)) &&
    !(await hasPermission(auth.userId, "servers.edit", auth.keyScope))
  ) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const idNum = Number((await params).id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: "Invalid server id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const valid = normalizeDailyRestartInput(body);
  if (!valid.ok || !valid.value) {
    return NextResponse.json({ error: valid.error || "Invalid payload" }, { status: 400 });
  }
  const { enabled, hour, minute } = valid.value;

  const cron = buildDailyRestartCron(hour, minute);
  if (!cron) return NextResponse.json({ error: "Invalid time" }, { status: 400 });

  try {
    const { server, tasks } = await loadServerAndTasks(idNum);
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (auth.role !== "admin" && server.userId !== auth.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const daily = dailyTask(tasks);

    if (!enabled) {
      if (daily) {
        await db
          .update(scheduledTasks)
          .set({ enabled: false })
          .where(eq(scheduledTasks.id, daily.task.id));
      }
      return NextResponse.json({ scheduled: false });
    }

    const nextRun = nextCronRun(cron);
    if (daily) {
      await db
        .update(scheduledTasks)
        .set({ cronExpression: cron, enabled: true, nextRun })
        .where(eq(scheduledTasks.id, daily.task.id));
      return NextResponse.json({
        scheduled: true,
        enabled: true,
        hour,
        minute,
        taskId: daily.task.id,
        nextRun: nextRun?.toISOString() ?? null,
      });
    }

    const [task] = await db
      .insert(scheduledTasks)
      .values({
        serverId: idNum,
        taskType: "backup",
        cronExpression: cron,
        command: null,
        enabled: true,
        nextRun,
      })
      .returning({ id: scheduledTasks.id });

    return NextResponse.json(
      {
        scheduled: true,
        enabled: true,
        hour,
        minute,
        taskId: task?.id ?? null,
        nextRun: nextRun?.toISOString() ?? null,
      },
      { status: 201 }
    );
  } catch (e: unknown) {
    return apiError(e, "Could not update the daily backup schedule", 500);
  }
}

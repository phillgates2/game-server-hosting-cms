import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTasks, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, desc } from "drizzle-orm";

// GET /api/scheduler — List all scheduled tasks
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  if (!auth || !(await hasPermission(auth.userId, "servers.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { serverId, taskType, cronExpression, command, enabled } = body;

    if (!serverId || !taskType || !cronExpression) {
      return NextResponse.json({ error: "serverId, taskType, and cronExpression required" }, { status: 400 });
    }

    // Calculate next run from cron expression
    const nextRun = calculateNextRun(cronExpression);

    const [task] = await db.insert(scheduledTasks).values({
      serverId: Number(serverId),
      taskType,
      cronExpression,
      command: command || null,
      enabled: enabled !== false,
      nextRun,
    }).returning();

    return NextResponse.json({ task }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

function calculateNextRun(cron: string): Date {
  // Simple cron parser for common patterns
  const now = new Date();
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return new Date(now.getTime() + 3600000); // fallback 1h

  const [minStr, hourStr] = parts;
  const min = minStr === "*" ? now.getMinutes() : parseInt(minStr);
  const hour = hourStr === "*" ? now.getHours() : parseInt(hourStr);

  const next = new Date(now);
  next.setMinutes(min);
  next.setSeconds(0);
  next.setMilliseconds(0);

  if (hourStr !== "*") {
    next.setHours(hour);
    if (next <= now) next.setDate(next.getDate() + 1);
  } else {
    if (next <= now) next.setHours(next.getHours() + 1);
  }

  return next;
}

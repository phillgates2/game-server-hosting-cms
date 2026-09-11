import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings, serverPresets, scheduledTasks, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { validatePanelImport } from "@/lib/panel-export";
import { nextCronRun } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/maintenance/import — admin-only conservative restore.
// Settings (safe keys only) + presets + schedules matched to servers that
// exist on THIS panel by name. Everything else stays reference-only.
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const valid = validatePanelImport(body);
  if (!valid.ok || !valid.value) {
    return NextResponse.json({ error: valid.error || "Invalid import" }, { status: 400 });
  }
  const { settings: importSettings, skippedSettings, presets, tasks, skippedTasks } = valid.value;

  try {
    // 1. Settings — upsert each whitelisted key.
    let settingsRestored = 0;
    for (const s of importSettings) {
      const [existing] = await db.select({ id: settings.id }).from(settings).where(eq(settings.key, s.key)).limit(1);
      if (existing) {
        await db.update(settings).set({ value: s.value, updatedAt: new Date() }).where(eq(settings.key, s.key));
      } else {
        await db.insert(settings).values({ key: s.key, value: s.value });
      }
      settingsRestored += 1;
    }

    // 2. Presets — insert under the importing admin.
    let presetsRestored = 0;
    for (const p of presets) {
      await db.insert(serverPresets).values({
        userId: auth.userId,
        name: p.name,
        description: p.description,
        gameId: p.gameId,
        variables: p.variables,
      });
      presetsRestored += 1;
    }

    // 3. Schedules — only for servers that exist here, matched by name.
    let tasksRestored = 0;
    let tasksUnmatched = 0;
    for (const t of tasks) {
      const [server] = await db
        .select({ id: gameServers.id })
        .from(gameServers)
        .where(eq(gameServers.name, t.serverName))
        .limit(1);
      if (!server) {
        tasksUnmatched += 1;
        continue;
      }
      await db.insert(scheduledTasks).values({
        serverId: server.id,
        taskType: t.taskType,
        cronExpression: t.cronExpression,
        command: null,
        enabled: t.enabled,
        nextRun: nextCronRun(t.cronExpression),
      });
      tasksRestored += 1;
    }

    return NextResponse.json({
      settingsRestored,
      skippedSettings,
      presetsRestored,
      tasksRestored,
      tasksUnmatched,
      skippedTasks,
    });
  } catch (e: unknown) {
    return apiError(e, "Import failed", 500);
  }
}

/**
 * The scheduled-task runner.
 *
 * The scheduler has always been display-only: tasks could be created, edited
 * and listed, but nothing in the panel ever executed them, so "restart every
 * night at 4am" did nothing. This module runs the tasks.
 *
 * One timer lives in the panel process (started from the boot hook), ticks
 * every 30s, claims every due enabled task, executes it, then advances the
 * schedule with a proper cron calculation. Everything is best-effort: a
 * failing task logs and moves on, and it can never take the panel down.
 *
 * The panel is a single-process deployment; a multi-instance deployment
 * would need a distributed claim (e.g. FOR UPDATE SKIP LOCKED) instead of
 * the in-process guard used here.
 */

import { db } from "@/db";
import { scheduledTasks, gameServers, gameDefinitions, nodes } from "@/db/schema";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import { nextCronRun, parseCron } from "@/lib/cron";

const log = createLogger("scheduler");

export const TASK_TYPES = ["restart", "backup", "update", "command"] as const;
export type ScheduledTaskType = (typeof TASK_TYPES)[number];

const TICK_MS = 30_000;
/** A tick executes at most this many tasks; the next tick picks up the rest. */
const MAX_TASKS_PER_TICK = 20;
/** Command tasks are shell commands; cap them so a paste cannot grow unbounded. */
export const MAX_COMMAND_LENGTH = 4_096;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

/** Start the periodic runner (idempotent). Returns a stop handle. */
export function startScheduler(): () => void {
  if (timer) return () => stopScheduler();
  timer = setInterval(() => void tickOnce(), TICK_MS);
  // Don't keep the process alive just for the scheduler.
  timer.unref?.();
  void tickOnce();
  return () => stopScheduler();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** One pass: claim due tasks, run them, advance their schedules. */
export async function tickOnce(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = await db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.enabled, true), isNotNull(scheduledTasks.nextRun), lt(scheduledTasks.nextRun, new Date())))
      .limit(MAX_TASKS_PER_TICK);

    if (due.length === 0) return;

    for (const task of due) {
      try {
        await runTask(task);
      } catch (e: unknown) {
        log.warn("scheduled task failed", {
          task: task.id,
          type: task.taskType,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e: unknown) {
    // No database yet, or a transient failure: never crash the loop.
    log.warn("scheduler tick skipped", {
      error: e instanceof Error ? e.message : String(e),
    });
  } finally {
    ticking = false;
  }
}

type DueTask = typeof scheduledTasks.$inferSelect;

async function runTask(task: DueTask): Promise<void> {
  // Advance the schedule first (claim). If the run fails, the task retries at
  // its next due time instead of retrying every 30 seconds forever.
  const next = nextRunAfterCron(task.cronExpression, new Date());
  await db
    .update(scheduledTasks)
    .set({ lastRun: new Date(), nextRun: next })
    .where(eq(scheduledTasks.id, task.id));

  // A task without a server has nothing to act on; type `command` may not
  // need one, but every type here operates on a server directory.
  if (!task.serverId) {
    log.warn(`scheduled task ${task.id} has no serverId — skipped`);
    return;
  }

  const [server] = await db
    .select({
      id: gameServers.id,
      name: gameServers.name,
      status: gameServers.status,
      pid: gameServers.pid,
      installPath: gameServers.installPath,
      steamAppId: gameDefinitions.steamAppId,
      gameName: gameDefinitions.name,
      nodeIsLocal: nodes.isLocal,
    })
    .from(gameServers)
    .leftJoin(gameDefinitions, eq(gameServers.gameId, gameDefinitions.id))
    .leftJoin(nodes, eq(gameServers.nodeId, nodes.id))
    .where(eq(gameServers.id, task.serverId))
    .limit(1);

  if (!server) {
    log.warn(`scheduled task ${task.id} references missing server ${task.serverId} — skipped`);
    return;
  }
  // Only this machine's servers: the start/stop route refuses remote nodes
  // for the same reason, and spawning on another node would not work anyway.
  if (server.nodeIsLocal === false) {
    log.warn(`scheduled task ${task.id} targets a remote node — skipped`);
    return;
  }

  const installPath = String(server.installPath);
  log.info("running scheduled task", { task: task.id, type: task.taskType, server: server.name });

  switch (task.taskType) {
    case "restart": {
      const { isProcessAlive, killProcess, startDetachedScript } = await import("@/lib/process-control");
      if (server.pid && isProcessAlive(server.pid)) {
        await killProcess(server.pid);
        await new Promise((r) => setTimeout(r, 500));
      }
      const { pid, alive } = await startDetachedScript(join(/* turbopackIgnore: true */ installPath, "gsm-start.sh"));
      await db
        .update(gameServers)
        .set({
          status: alive ? "running" : "stopped",
          pid: alive ? pid : null,
          lastStarted: alive ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, server.id));
      log.info(`scheduled restart of "${server.name}" ${alive ? `recovered (pid ${pid})` : "failed to start"}`);
      break;
    }
    case "backup": {
      const { createServerBackup } = await import("@/lib/backup");
      const result = await createServerBackup(installPath);
      log.info(`scheduled backup of "${server.name}" → ${result.name}`);
      break;
    }
    case "update": {
      if (server.status === "running") {
        log.warn(`scheduled update of "${server.name}" skipped — server must be stopped`);
        break;
      }
      if (!server.steamAppId) {
        log.warn(`scheduled update of "${server.name}" skipped — no Steam App ID`);
        break;
      }
      const { runSteamUpdate } = await import("@/lib/server-update-runner");
      await db.update(gameServers).set({ status: "installing", updatedAt: new Date() }).where(eq(gameServers.id, server.id));
      try {
        await runSteamUpdate({
          installPath,
          gameName: server.gameName || "game",
          steamAppId: String(server.steamAppId),
        });
      } finally {
        await db
          .update(gameServers)
          .set({ status: "stopped", updatedAt: new Date() })
          .where(eq(gameServers.id, server.id))
          .catch(() => undefined);
      }
      log.info(`scheduled update of "${server.name}" complete`);
      break;
    }
    case "command": {
      const command = String(task.command ?? "").trim();
      if (!command) break;
      const { execFile } = await import("node:child_process");
      // The task is explicitly a shell command created by an operator with
      // scheduler.create; run it in the server's own directory.
      await new Promise<void>((resolve, reject) => {
        execFile(
          "/bin/bash",
          ["-lc", command],
          { cwd: installPath, timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) {
              log.warn(`scheduled command on "${server.name}" exited`, {
                error: `${err.message} ${stderr.slice(-500)}`,
              });
              reject(err);
            } else {
              log.info(`scheduled command on "${server.name}" ok ${stdout.length} bytes`);
              resolve();
            }
          }
        );
      });
      break;
    }
    default:
      log.warn(`scheduled task ${task.id} has unknown type "${task.taskType}" — skipped`);
  }
}

/**
 * Next run after `now`, tolerating schedules that match only rarely (a leap
 * day): fall back to a retry a year out rather than parking the task.
 */
function nextRunAfterCron(expr: string | null, now: Date): Date | null {
  if (!expr || !parseCron(expr)) return null;
  return nextCronRun(expr, now) ?? nextCronRun(expr, new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()));
}

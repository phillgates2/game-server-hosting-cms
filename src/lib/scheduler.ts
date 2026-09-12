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
import { scheduledTasks, gameServers, gameDefinitions, nodes, settings } from "@/db/schema";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";
import { nextCronRun, parseCron } from "@/lib/cron";
import { DEFAULT_ALERT_SUSTAINED } from "@/lib/threshold-alerts";

const log = createLogger("scheduler");

export const TASK_TYPES = ["restart", "backup", "update", "command", "fleet-digest", "idle-update"] as const;
export type ScheduledTaskType = (typeof TASK_TYPES)[number];

const TICK_MS = 30_000;
/** Ephemeral-server expiry sweeps run on a slower clock. */
const EPHEMERAL_SWEEP_INTERVAL_MS = 5 * 60_000;
let lastEphemeralSweep = 0;
let lastLicenseHeartbeat = 0;
/** A tick executes at most this many tasks; the next tick picks up the rest. */
const MAX_TASKS_PER_TICK = 20;
/** Command tasks are shell commands; cap them so a paste cannot grow unbounded. */
export const MAX_COMMAND_LENGTH = 4_096;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

// ── Host threshold alerts ────────────────────────────────────────────────────
// Checked at most once a minute from the tick; fires at most once per
// episode so a pegged host cannot spam Discord.
const ALERT_INTERVAL_MS = 60_000;
let lastAlertCheck = 0;
let alertEpisode: { strikes: number; alerted: boolean } = { strikes: 0, alerted: false };

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
  // Ephemeral TTL servers: stop+delete anything whose time has come.
  const nowForSweep = Date.now();
  if (nowForSweep - lastEphemeralSweep >= EPHEMERAL_SWEEP_INTERVAL_MS) {
    lastEphemeralSweep = nowForSweep;
    try {
      const { sweepExpiredServers } = await import("./ephemeral-sweeper");
      await sweepExpiredServers();
    } catch { /* sweeping must never break task execution */ }
  }

  if (ticking) return;
  ticking = true;
  try {
    // Host health alerts ride on the tick so they run whether or not any
    // task is due. Best-effort: never disturbs the schedule on failure.
    await runThresholdAlerts();
    await markStaleNodesOffline();

    // License heartbeat: licensed panels re-prove their activation against
    // the master panel on a throttle. Best-effort like every other chore.
    const { LICENSE_HEARTBEAT_INTERVAL_MS } = await import("./license-heartbeat");
    if (Date.now() - lastLicenseHeartbeat >= LICENSE_HEARTBEAT_INTERVAL_MS) {
      lastLicenseHeartbeat = Date.now();
      try {
        const { runLicenseHeartbeat } = await import("./license-heartbeat");
        await runLicenseHeartbeat();
      } catch (e: unknown) {
        log.warn("license heartbeat failed", { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Scheduled maintenance windows: drain nodes at their planned start and
    // release them at the end. Best-effort like every other tick chore.
    try {
      const { applyMaintenanceWindows } = await import("./maintenance-windows");
      await applyMaintenanceWindows();
    } catch (e: unknown) {
      log.warn("maintenance window sweep failed", { error: e instanceof Error ? e.message : String(e) });
    }

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

  // Panel-level task: the weekly fleet digest (serverId is null by design).
  if (task.taskType === "fleet-digest") {
    const { sendFleetDigest } = await import("./fleet-digest");
    await sendFleetDigest();
    return;
  }

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
      port: gameServers.port,
      installPath: gameServers.installPath,
      discordWebhook: gameServers.discordWebhook,
      steamAppId: gameDefinitions.steamAppId,
      gameName: gameDefinitions.name,
      nodeIsLocal: nodes.isLocal,
      nodeApiUrl: nodes.apiUrl,
      nodeApiKey: nodes.apiKey,
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
  // Remote node: restarts run through the gsm-agent; the file-based task
  // types (backup/update/command) still need the agent's file APIs, so they
  // are reported as failures rather than skipped silently.
  if (server.nodeIsLocal === false) {
    let ok = false;
    let detail = "this task type needs the node agent's file APIs and is not supported remotely yet";
    let serverStatus: "online" | "offline" | undefined;
    if (task.taskType === "restart" && server.nodeApiUrl && server.nodeApiKey) {
      try {
        const { remoteProcessStop, remoteProcessStart } = await import("@/lib/node-client");
        const node = { apiUrl: server.nodeApiUrl, apiKey: server.nodeApiKey };
        const remotePath = String(server.installPath);
        if (server.pid) await remoteProcessStop(node, remotePath, server.pid);
        const r = await remoteProcessStart(node, remotePath);
        await db
          .update(gameServers)
          .set({
            status: r.alive ? "running" : "stopped",
            pid: r.alive ? r.pid : null,
            lastStarted: r.alive ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(gameServers.id, server.id));
        ok = r.alive;
        detail = r.alive ? `back online via node agent (pid ${r.pid})` : "the node agent reported the server failed to start";
        serverStatus = r.alive ? "online" : "offline";
      } catch (e: unknown) {
        detail = `node agent error: ${e instanceof Error ? e.message : String(e)}`;
      }
    } else if (task.taskType === "restart") {
      detail = "the remote node has no agent URL/key configured";
    }
    log.warn(`scheduled ${task.taskType} on remote server "${server.name}": ${detail}`);
    await notifyTaskResult(task, server, next, ok, detail, serverStatus);
    return;
  }

  const installPath = String(server.installPath);
  log.info("running scheduled task", { task: task.id, type: task.taskType, server: server.name });

  // Every case records an outcome; the notification at the end reports it.
  let ok = true;
  let detail: string | undefined;
  let serverStatus: "online" | "offline" | undefined;

  try {
    switch (task.taskType) {
      case "restart": {
        const { isProcessAlive, killProcess, startDetachedScript } = await import("@/lib/process-control");
        const { consoleLogPath } = await import("@/lib/console-log");
        if (server.pid && isProcessAlive(server.pid)) {
          await killProcess(server.pid);
          await new Promise((r) => setTimeout(r, 500));
        }
        const { pid, alive } = await startDetachedScript(join(/* turbopackIgnore: true */ installPath, "gsm-start.sh"), consoleLogPath(installPath));
        await db
          .update(gameServers)
          .set({
            status: alive ? "running" : "stopped",
            pid: alive ? pid : null,
            lastStarted: alive ? new Date() : undefined,
            updatedAt: new Date(),
          })
          .where(eq(gameServers.id, server.id));
        ok = alive;
        detail = alive ? `back online (pid ${pid})` : "the server failed to start";
        serverStatus = alive ? "online" : "offline";
        log.info(`scheduled restart of "${server.name}" ${alive ? `recovered (pid ${pid})` : "failed to start"}`);
        break;
      }
      case "backup": {
        const { createServerBackup } = await import("@/lib/backup");
        const result = await createServerBackup(installPath);
        detail = `archive ${result.name}`;
        serverStatus = server.status === "running" ? "online" : "offline";
        log.info(`scheduled backup of "${server.name}" → ${result.name}`);
        break;
      }
      case "update": {
        if (server.status === "running") {
          ok = false;
          detail = "skipped — the server must be stopped to update";
          log.warn(`scheduled update of "${server.name}" skipped — server must be stopped`);
          break;
        }
        if (!server.steamAppId) {
          ok = false;
          detail = "skipped — this game has no Steam App ID";
          log.warn(`scheduled update of "${server.name}" skipped — no Steam App ID`);
          break;
        }
        // Same safety net as the Update button: archive first, and let a
        // failed backup veto the update rather than run without a restore
        // point. A 4am cron update must not be the one path that skips it.
        const [backupPref] = await db
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, "update_auto_backup"))
          .limit(1);
        let backupNote = "";
        if ((backupPref?.value ?? "true") !== "false") {
          const { createServerBackup } = await import("@/lib/backup");
          const preBackup = await createServerBackup(installPath);
          backupNote = ` (pre-update backup: ${preBackup.name})`;
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
        detail = `latest version installed${backupNote}`;
        serverStatus = "offline";
        log.info(`scheduled update of "${server.name}" complete`);
        break;
      }
      case "idle-update": {
        // Update only when the server is empty: stopped outright, or running
        // with a zero-player streak at/over the idle threshold. A running
        // busy server is skipped and retried at the next cron slot — players
        // are never kicked for an update.
        if (!server.steamAppId) {
          ok = false;
          detail = "skipped — this game has no Steam App ID";
          break;
        }
        // (Remote servers never reach here — executeTask's remote branch
        // reports them first, same as every other file-based task type.)

        const { IDLE_POLICY_HOURS_KEY, resolveIdleThresholdMs } = await import("./idle-math");
        const [idlePref] = await db
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, IDLE_POLICY_HOURS_KEY))
          .limit(1);
        const idleThresholdMs = resolveIdleThresholdMs(
          idlePref ? [{ key: IDLE_POLICY_HOURS_KEY, value: idlePref.value }] : []
        );

        let wasRunning = false;
        if (server.status === "running") {
          const { serverIdleState } = await import("@/db/schema");
          const [idleRow] = await db
            .select({ zeroPlayersSince: serverIdleState.zeroPlayersSince })
            .from(serverIdleState)
            .where(eq(serverIdleState.serverId, server.id))
            .limit(1);
          const { idleDurationMs } = await import("./idle-math");
          const idleFor = idleDurationMs(idleRow?.zeroPlayersSince ?? null, Date.now());
          if (idleFor === null || idleFor < idleThresholdMs) {
            ok = false;
            detail = `skipped — players may be online (idle ${idleFor === null ? "clock not running" : `${Math.round(idleFor / 3_600_000)}h`} < ${Math.round(idleThresholdMs / 3_600_000)}h)`;
            log.info(`idle-update of "${server.name}" ${detail}`);
            break;
          }
          // Idle long enough: stop it first — updates need the server down.
          const { killProcess } = await import("./process-control");
          if (server.pid) await killProcess(server.pid);
          await new Promise((r) => setTimeout(r, 500));
          wasRunning = true;
        }

        // Same pre-update safety net as the plain update task.
        const [idleBackupPref] = await db
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, "update_auto_backup"))
          .limit(1);
        let idleBackupNote = "";
        if ((idleBackupPref?.value ?? "true") !== "false") {
          const { createServerBackup } = await import("@/lib/backup");
          const preBackup = await createServerBackup(installPath);
          idleBackupNote = ` (pre-update backup: ${preBackup.name})`;
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

        if (wasRunning) {
          // Bring it back: it only went down for the update.
          const { startDetachedScript } = await import("./process-control");
          const { consoleLogPath } = await import("./console-log");
          const { join } = await import("node:path");
          const restarted = await startDetachedScript(join(/* turbopackIgnore: true */ installPath, "gsm-start.sh"), consoleLogPath(installPath));
          await db
            .update(gameServers)
            .set({
              status: restarted.alive ? "running" : "stopped",
              pid: restarted.alive ? restarted.pid : null,
              lastStarted: restarted.alive ? new Date() : undefined,
              updatedAt: new Date(),
            })
            .where(eq(gameServers.id, server.id));
          ok = restarted.alive;
          detail = restarted.alive
            ? `updated while empty, back online (pid ${restarted.pid})${idleBackupNote}`
            : `updated but failed to restart${idleBackupNote}`;
          serverStatus = restarted.alive ? "online" : "offline";
        } else {
          detail = `updated while stopped${idleBackupNote}`;
          serverStatus = "offline";
        }
        log.info(`idle-update of "${server.name}" complete: ${detail}`);
        break;
      }
      case "command": {
        const command = String(task.command ?? "").trim();
        if (!command) {
          ok = false;
          detail = "the task has no command to run";
          break;
        }
        const { execFile } = await import("node:child_process");
        // The task is explicitly a shell command created by an operator with
        // scheduler.create; run it in the server's own directory.
        const bytes = await new Promise<number>((resolve, reject) => {
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
                resolve(stdout.length);
              }
            }
          );
        });
        detail = `${bytes.toLocaleString()} bytes of output`;
        serverStatus = server.status === "running" ? "online" : "offline";
        break;
      }
      default:
        ok = false;
        detail = `unknown task type "${task.taskType}"`;
        log.warn(`scheduled task ${task.id} has unknown type "${task.taskType}" — skipped`);
    }
  } catch (e: unknown) {
    ok = false;
    detail = e instanceof Error ? e.message : String(e);
    log.warn(`scheduled ${task.taskType} on "${server.name}" failed`, { error: detail });
  }

  await notifyTaskResult(task, server, next, ok, detail, serverStatus);
}

/**
 * Report a task outcome to Discord (server webhook, else the panel-wide one).
 * The panel setting `scheduler_discord_notify` (default on) silences these
 * wholesale. Never throws: a dead webhook must not affect the schedule.
 */
async function notifyTaskResult(
  task: DueTask,
  server: { name: string; gameName: string | null; port: number; discordWebhook: string | null },
  next: Date | null,
  ok: boolean,
  detail: string | undefined,
  serverStatus: "online" | "offline" | undefined
): Promise<void> {
  try {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "scheduler_discord_notify"))
      .limit(1);
    if ((row?.value ?? "true") === "false") return;

    const { resolveWebhookUrl, notifyScheduledTask } = await import("@/lib/discord");
    const url = resolveWebhookUrl(server.discordWebhook);
    if (!url) return;

    notifyScheduledTask(url, {
      serverName: server.name,
      gameName: server.gameName || "Game server",
      port: server.port,
      taskType: task.taskType,
      ok,
      detail,
      serverStatus,
      nextRun: next,
    });
  } catch (e: unknown) {
    log.warn("could not send scheduled-task notification", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * A remote node whose heartbeats stopped is offline — flip it so the panel
 * stops presenting it as healthy. Local nodes never heartbeat and are exempt.
 */
async function markStaleNodesOffline(): Promise<void> {
  try {
    const { NODE_STALE_MS } = await import("@/lib/server-lifecycle");
    const cutoff = new Date(Date.now() - NODE_STALE_MS);
    await db
      .update(nodes)
      .set({ status: "offline", updatedAt: new Date() })
      .where(and(eq(nodes.status, "online"), eq(nodes.isLocal, false), isNotNull(nodes.lastHeartbeat), lt(nodes.lastHeartbeat, cutoff)));
  } catch (e: unknown) {
    log.warn("stale-node check skipped", { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Sample host CPU load, RAM and disk usage. Everything degrades to null
 * (never throws) where procfs or statfs is unavailable.
 */
async function sampleHost(): Promise<{ cpuPercent: number | null; ramPercent: number | null; diskPercent: number | null }> {
  const os = await import("node:os");
  const { readFile } = await import("node:fs/promises");
  const { statfs } = await import("node:fs");
  const { promisify } = await import("node:util");

  // Load-per-core reads like a utilisation percentage and needs no baseline
  // sample, which suits a once-a-minute check.
  let cpuPercent: number | null = null;
  try {
    const load1 = os.loadavg()[0];
    const cores = Math.max(1, os.cpus().length);
    cpuPercent = Math.min(999, (load1 / cores) * 100);
  } catch { /* leave null */ }

  let ramPercent: number | null = null;
  try {
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const kb = (key: string) => {
      const m = meminfo.match(new RegExp(`${key}:\\s+(\\d+)`));
      return m ? Number.parseInt(m[1], 10) : null;
    };
    const total = kb("MemTotal");
    const available = kb("MemAvailable");
    if (total && available !== null) ramPercent = ((total - available) / total) * 100;
  } catch { /* leave null */ }

  let diskPercent: number | null = null;
  try {
    const st = await promisify(statfs)("/");
    if (st.blocks > 0) diskPercent = (1 - st.bavail / st.blocks) * 100;
  } catch { /* leave null */ }

  return { cpuPercent, ramPercent, diskPercent };
}

/** Evaluate the host against the alert thresholds and notify once per episode. */
async function runThresholdAlerts(): Promise<void> {
  const now = Date.now();
  if (now - lastAlertCheck < ALERT_INTERVAL_MS) return;
  lastAlertCheck = now;

  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ["alert_cpu_percent", "alert_ram_percent", "alert_disk_percent", "alert_mute_until"]))
      .limit(4);
    const num = (key: string, fallback: number): number => {
      const raw = rows.find((r) => r.key === key)?.value;
      const n = Number.parseInt(String(raw ?? ""), 10);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    // On by default at 90%: with no webhook configured the send is a silent
    // no-op, and with one configured the operator wants these.
    const cfg = {
      cpuPercent: num("alert_cpu_percent", 90),
      ramPercent: num("alert_ram_percent", 90),
      diskPercent: num("alert_disk_percent", 90),
      sustained: DEFAULT_ALERT_SUSTAINED,
    };
    if (cfg.cpuPercent === 0 && cfg.ramPercent === 0 && cfg.diskPercent === 0) {
      alertEpisode = { strikes: 0, alerted: false };
      return;
    }

    const { evaluateThresholds, alertDecision } = await import("@/lib/threshold-alerts");
    const reading = await sampleHost();
    const breaches = evaluateThresholds(reading, cfg);
    const decision = alertDecision(alertEpisode, breaches.length > 0, cfg.sustained);
    alertEpisode = decision.episode;
    if (!decision.fire) return;

    // Planned-work mute: swallow the alert but mark the episode as handled
    // so it cannot burst the moment the window ends.
    const { isAlertMuted, ALERT_MUTE_SETTING_KEY } = await import("@/lib/alert-mute");
    const muteUntil = rows.find((r) => r.key === ALERT_MUTE_SETTING_KEY)?.value ?? null;
    if (isAlertMuted(muteUntil, now)) {
      alertEpisode = { ...alertEpisode, alerted: true };
      return;
    }

    const { resolveWebhookUrl, sendDiscordWebhook } = await import("@/lib/discord");
    const hook = resolveWebhookUrl(null);
    if (!hook) return;
    await sendDiscordWebhook(hook, {
      serverName: "Host",
      gameName: "Panel node",
      port: 0,
      event: "threshold_alert",
      message: `⚠️ Host thresholds exceeded for ${cfg.sustained} consecutive checks: ${breaches.join("; ")}.`,
    }).catch(() => {});
    log.warn("host threshold alert fired", { breaches });
  } catch (e: unknown) {
    log.warn("threshold alert check skipped", { error: e instanceof Error ? e.message : String(e) });
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

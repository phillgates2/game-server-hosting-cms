import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { clientIpForRecord } from "@/lib/ip-allowlist";
import {
  detachedUpdateCommand,
  selfUpdateCommand,
  stateFromLaunchFailure,
  updateAvailability,
  updateIsRunning,
  updateProgress,
  updateSummary,
  type UpdateState,
} from "@/lib/panel-update";
import {
  canRunViaSudo,
  fileExists,
  readGitRefs,
  readInstallInfoFile,
  readPackageVersion,
  readUpdateLogTail,
  readUpdateState,
  seedUpdateState,
  selfUpdateWrapperPath,
  updatePaths,
  updaterPathFor,
} from "@/lib/panel-update-fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Panel self-update.
 *
 * GET  — version, last run, whether a run is in progress, and whether this
 *        panel is allowed to run the updater at all (with the reason when not).
 * POST — start an update, detached from the panel process so it survives the
 *        restart it performs at the end.
 *
 * The button is only a convenience wrapper around `public/update.sh`: it runs
 * the script with fixed arguments (or a fixed argument-checking wrapper via
 * sudo) and reads the state file the script publishes. No request field ever
 * reaches a shell.
 */

interface Environment {
  installDir: string;
  updaterPath: string;
  wrapperPath: string;
  statePath: string;
  logPath: string;
  spawnLogPath: string;
  isRoot: boolean;
  updaterPresent: boolean;
  wrapperPresent: boolean;
  sudoAllowed: boolean;
}

async function inspectEnvironment(): Promise<Environment> {
  const installDir = process.cwd();
  const { statePath, logPath, spawnLogPath } = updatePaths();
  const wrapperPath = selfUpdateWrapperPath();
  const updaterPath = updaterPathFor(installDir);
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  const [updaterPresent, wrapperPresent] = await Promise.all([
    fileExists(updaterPath),
    fileExists(wrapperPath),
  ]);

  const sudoAllowed =
    !isRoot && wrapperPresent && updaterPresent ? await canRunViaSudo(wrapperPath) : false;

  return {
    installDir,
    updaterPath,
    wrapperPath,
    statePath,
    logPath,
    spawnLogPath,
    isRoot,
    updaterPresent,
    wrapperPresent,
    sudoAllowed,
  };
}

async function authorise(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await hasPermission(auth.userId, "panel.updates", auth.keyScope))) {
    return { error: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
  }
  return { auth };
}

async function statusPayload(env: Environment, nowMs: number) {
  const [storedState, updateLog, spawnLog, installInfo, version, git] = await Promise.all([
    readUpdateState(env.statePath),
    readUpdateLogTail(env.logPath),
    readUpdateLogTail(env.spawnLogPath, 4_000),
    readInstallInfoFile(env.installDir),
    readPackageVersion(env.installDir),
    readGitRefs(env.installDir),
  ]);

  // The updater truncates its own log when it starts, so anything left in the
  // spawn log means it never got that far. Show that instead of "never run".
  const state = storedState ?? stateFromLaunchFailure(spawnLog);
  const logTail = updateLog.trim() ? updateLog : spawnLog;

  const availability = updateAvailability({
    updaterPresent: env.updaterPresent,
    isRoot: env.isRoot,
    wrapperPresent: env.wrapperPresent,
    sudoAllowed: env.sudoAllowed,
  });

  return {
    now: nowMs,
    panel: {
      version,
      commit: git.commit ?? installInfo.version,
      branch: git.branch,
      installDir: env.installDir,
      installedVersion: installInfo.version,
      lastUpdate: installInfo.lastUpdate,
      port: installInfo.port,
    },
    updater: {
      path: env.updaterPath,
      wrapperPath: env.wrapperPath,
      present: env.updaterPresent,
      wrapperPresent: env.wrapperPresent,
      isRoot: env.isRoot,
      sudoAllowed: env.sudoAllowed,
      canUpdate: availability.canUpdate,
      reason: availability.reason,
      command: availability.canUpdate
        ? env.isRoot
          ? `sudo bash ${env.updaterPath} --force`
          : `sudo ${env.wrapperPath}`
        : null,
    },
    state,
    running: updateIsRunning(storedState, nowMs),
    progress: updateProgress(state),
    summary: updateSummary(state, nowMs),
    logTail,
  };
}

export async function GET(req: NextRequest) {
  const allowed = await authorise(req);
  if ("error" in allowed) return allowed.error;

  try {
    const env = await inspectEnvironment();
    return NextResponse.json({ ok: true, ...(await statusPayload(env, Date.now())) });
  } catch (e: unknown) {
    return apiError(e, "Could not read the update status", 500);
  }
}

/**
 * POST /api/system/update
 *
 * Body: `{ confirm: "update", noBackup?: boolean }`.
 *
 * The `confirm` string is deliberate friction: the panel restarts itself, so an
 * accidental double-click (or a stray retry) is not something the operator can
 * undo, and a bare empty POST from a script should not start an update by
 * itself.
 */
export async function POST(req: NextRequest) {
  const allowed = await authorise(req);
  if ("error" in allowed) return allowed.error;
  const auth = allowed.auth;

  try {
    const body: unknown = await req.json().catch(() => null);
    const input = (body ?? {}) as Record<string, unknown>;

    if (input.confirm !== "update") {
      return NextResponse.json(
        { error: 'Send { "confirm": "update" } to start an update.' },
        { status: 400 }
      );
    }

    const noBackup = input.noBackup === true;

    const env = await inspectEnvironment();

    if (!env.updaterPresent) {
      return NextResponse.json(
        {
          error:
            "public/update.sh was not found in this installation, so the panel cannot update itself. Update from a shell instead.",
        },
        { status: 409 }
      );
    }

    const availability = updateAvailability({
      updaterPresent: env.updaterPresent,
      isRoot: env.isRoot,
      wrapperPresent: env.wrapperPresent,
      sudoAllowed: env.sudoAllowed,
    });
    if (!availability.canUpdate) {
      return NextResponse.json({ error: availability.reason }, { status: 409 });
    }

    // One update at a time. The state file is the source of truth because it
    // survives a restart; an abandoned run is reported as stale rather than
    // blocking the button forever.
    const existing = await readUpdateState(env.statePath);
    if (updateIsRunning(existing, Date.now())) {
      return NextResponse.json(
        {
          error: "An update is already running. Watch its progress here; the panel restarts when it finishes.",
          state: existing,
        },
        { status: 409 }
      );
    }

    const command = selfUpdateCommand({
      isRoot: env.isRoot,
      updaterPath: env.updaterPath,
      wrapperPath: env.wrapperPath,
      noBackup,
    });
    const spawnPlan = detachedUpdateCommand(command, env.spawnLogPath);

    // A "starting" state so the panel has something honest to show in the
    // seconds before the script writes its first phase — and so a second click
    // is refused even if the script dies immediately.
    const startedAt = new Date().toISOString();
    const optimistic: UpdateState = {
      status: "running",
      phase: "starting",
      step: 0,
      totalSteps: 7,
      message: "Starting the updater…",
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      branch: null,
      fromCommit: null,
      toCommit: null,
      exitCode: null,
      error: null,
    };

    await seedUpdateState(env.statePath, optimistic);

    try {
      const child = spawn(/*turbopackIgnore: true*/ spawnPlan.file, spawnPlan.args, {
        detached: true,
        stdio: "ignore",
        cwd: env.installDir,
        env: {
          ...process.env,
          GSM_UPDATE_STATE_FILE: env.statePath,
          GSM_UPDATE_LOG_FILE: env.logPath,
        },
      });
      // A detached child reports trouble asynchronously; without a listener an
      // ENOENT would surface as an uncaught exception and take the panel down.
      child.on("error", (error: Error) => {
        console.error("[panel-update] could not start the updater:", error.message);
        void seedUpdateState(env.statePath, {
          ...optimistic,
          status: "failed",
          error: "Could not start the updater. Check the panel's logs.",
          finishedAt: new Date().toISOString(),
        });
      });
      child.unref();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not start the updater.";
      await seedUpdateState(env.statePath, {
        ...optimistic,
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }

    try {
      await db.insert(auditLog).values({
        userId: auth.userId || null,
        action: "panel.update.start",
        entityType: "panel",
        entityId: null,
        details: { noBackup, command: env.isRoot ? "updater" : "wrapper", startedAt },
        ipAddress: clientIpForRecord(req.headers),
      });
    } catch {
      /* best effort: the update is already running */
    }

    const status = await statusPayload(env, Date.now());
    return NextResponse.json({
      ok: true,
      startedAt,
      // The freshly written file may not be visible yet; prefer what we know.
      ...status,
      state: status.state ?? optimistic,
      running: true,
      summary: updateSummary(status.state ?? optimistic, Date.now()),
    });
  } catch (e: unknown) {
    return apiError(e, "Could not start the update", 500);
  }
}

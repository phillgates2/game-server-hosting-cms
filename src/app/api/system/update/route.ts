import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { apiError } from "@/lib/api-error";
import { clientIpForRecord } from "@/lib/ip-allowlist";
import {
  resolveUpdateStatus,
  selfUpdateCommand,
  stateIsFromLaunch,
  updateAvailability,
  updateIsRunning,
  updateProgress,
  updateSummary,
  type UpdateLaunch,
} from "@/lib/panel-update";
import {
  canRunViaSudo,
  fileExists,
  readGitRefs,
  readInstallInfoFile,
  readLaunchAccount,
  readPackageVersion,
  readUpdateLogTail,
  readUpdateState,
  selfUpdateWrapperPath,
  startDetachedUpdate,
  updatePaths,
  updaterPathFor,
  waitForLaunchToSettle,
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
 *
 * Two accounts of an update exist, and `resolveUpdateStatus` picks between
 * them. The updater's state file is root's, and the panel only reads it. Until
 * the updater has written to it, the panel goes by its own launch record: which
 * process it started, and what that process printed.
 */

/**
 * The longest POST watches the process it launched before answering.
 *
 * What stops an update outright — sudo refusing, the helper rejecting its
 * arguments, a missing updater — ends the process within a few hundred
 * milliseconds, and a refusal after the fetch (local changes, a branch that
 * cannot be fast-forwarded) usually within a couple of seconds. Watching for
 * that turns "Update started" followed by nothing into an error the operator
 * can read. The wait ends early the moment the updater reports its first step,
 * so a healthy launch is answered well before the updater stops the panel.
 */
const LAUNCH_SETTLE_MS = 4_000;

/**
 * True from "nothing is running" until the launch record exists. The checks in
 * between are asynchronous, so without this two requests arriving together
 * would both pass them and start two updaters on the same checkout.
 */
let launchInFlight = false;

interface Environment {
  installDir: string;
  updaterPath: string;
  wrapperPath: string;
  statePath: string;
  logPath: string;
  isRoot: boolean;
  updaterPresent: boolean;
  wrapperPresent: boolean;
  sudoAllowed: boolean;
}

async function inspectEnvironment(): Promise<Environment> {
  const installDir = process.cwd();
  const { statePath, logPath } = updatePaths();
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
  const [storedState, updaterLog, launched, installInfo, version, git] = await Promise.all([
    readUpdateState(env.statePath),
    readUpdateLogTail(env.logPath),
    readLaunchAccount(),
    readInstallInfoFile(env.installDir),
    readPackageVersion(env.installDir),
    readGitRefs(env.installDir),
  ]);

  const { state, logTail } = resolveUpdateStatus({
    stored: storedState,
    launch: launched.launch,
    launchAlive: launched.launchAlive,
    updaterLog,
    launchLog: launched.launchLog,
    nowMs,
  });

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
    running: updateIsRunning(state, nowMs),
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

/** Start the updater with the one fixed command this install is allowed. */
async function launchUpdater(env: Environment, noBackup: boolean): Promise<UpdateLaunch> {
  const { launch, launcherError } = await startDetachedUpdate({
    command: selfUpdateCommand({
      isRoot: env.isRoot,
      updaterPath: env.updaterPath,
      wrapperPath: env.wrapperPath,
      noBackup,
    }),
    cwd: env.installDir,
    env: {
      ...process.env,
      GSM_UPDATE_STATE_FILE: env.statePath,
      GSM_UPDATE_LOG_FILE: env.logPath,
    },
    noBackup,
  });
  if (launcherError) {
    console.error("[panel-update] could not run the update launcher:", launcherError);
  }
  return launch;
}

/** Has the updater this request launched reported its first step yet? */
async function updaterHasPublished(env: Environment, launch: UpdateLaunch): Promise<boolean> {
  const stored = await readUpdateState(env.statePath);
  // Nothing was running when this launch was made (POST checked), so a state
  // that is running now is this run's — also in its first second, when its
  // timestamp cannot yet prove it.
  return stateIsFromLaunch(stored, launch) || updateIsRunning(stored, Date.now());
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
 *
 * `ok: true` means the updater is running, not merely that it was asked to. If
 * it stops at once the answer is a 500 carrying its last line of output; if it
 * stops later, but still before its first step, GET reports the same verdict.
 * Either way it stays there until the next attempt.
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

    const alreadyRunning =
      "An update is already running. Watch its progress here; the panel restarts when it finishes.";

    if (launchInFlight) {
      return NextResponse.json({ error: alreadyRunning }, { status: 409 });
    }
    launchInFlight = true;
    let launch: UpdateLaunch;
    try {
      // One update at a time. The updater's state file is the source of truth
      // once it exists, because it survives a restart; before that, the launch
      // record is. An abandoned run is reported as stale rather than blocking
      // the button forever.
      const existing = (await statusPayload(env, Date.now())).state;
      if (updateIsRunning(existing, Date.now())) {
        return NextResponse.json({ error: alreadyRunning, state: existing }, { status: 409 });
      }

      launch = await launchUpdater(env, noBackup);
    } finally {
      launchInFlight = false;
    }

    // Recorded before watching the launch, not after: once the updater has
    // reported its first step the panel can be stopped at any moment, and who
    // asked for the update must not be lost with it. It records the request —
    // how the run ends is the Updates tab's to say.
    try {
      await db.insert(auditLog).values({
        userId: auth.userId || null,
        action: "panel.update.start",
        entityType: "panel",
        entityId: null,
        details: {
          noBackup,
          command: env.isRoot ? "updater" : "wrapper",
          startedAt: launch.launchedAt,
          launched: launch.error === null,
        },
        ipAddress: clientIpForRecord(req.headers),
      });
    } catch {
      /* best effort: the update is already running */
    }

    await waitForLaunchToSettle(launch, LAUNCH_SETTLE_MS, {
      published: () => updaterHasPublished(env, launch),
    });
    const status = await statusPayload(env, Date.now());
    const failed = status.state?.status === "failed" && status.state.phase === "launch";

    if (failed) {
      const reason = status.state?.error ?? "the updater exited at once.";
      console.warn("[panel-update] the updater stopped before its first step:", reason);
      return NextResponse.json(
        { error: `The update did not start: ${reason}`, ...status },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, startedAt: launch.launchedAt, ...status });
  } catch (e: unknown) {
    return apiError(e, "Could not start the update", 500);
  }
}

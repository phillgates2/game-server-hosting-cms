/**
 * Filesystem and process helpers for the panel self-update button.
 *
 * Kept apart from `panel-update.ts` because that module is imported by the
 * Updates panel in the browser: the pure decision-making can be shared, the
 * parts that touch `node:fs` and `child_process` cannot.
 */

import { access, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { promisify } from "node:util";
import {
  DEFAULT_SELF_UPDATE_WRAPPER,
  DEFAULT_UPDATE_LAUNCH_DIR,
  DEFAULT_UPDATE_STATE_PATH,
  UPDATE_LAUNCH_LOG_NAME,
  UPDATE_LAUNCH_RECORD_NAME,
  UPDATE_LOG_TAIL_BYTES,
  detachedUpdateCommand,
  parseUpdateLaunch,
  parseUpdateState,
  readInstallInfo,
  type UpdateCommand,
  type UpdateLaunch,
  type UpdateState,
} from "./panel-update";

const execFileAsync = promisify(execFile);

/** Where the updater's state and stable log live; both are env-overridable. */
export function updatePaths(env: NodeJS.ProcessEnv = process.env): {
  statePath: string;
  logPath: string;
} {
  const statePath = env.GSM_UPDATE_STATE_FILE?.trim() || DEFAULT_UPDATE_STATE_PATH;
  const logPath = env.GSM_UPDATE_LOG_FILE?.trim() || join(dirname(statePath), "update.log");
  return { statePath, logPath };
}

export function selfUpdateWrapperPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GSM_SELF_UPDATE_WRAPPER?.trim() || DEFAULT_SELF_UPDATE_WRAPPER;
}

/** Path of the updater inside an installation. */
export function updaterPathFor(installDir: string): string {
  return join(installDir, "public", "update.sh");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export { exists as fileExists };

/** The updater's progress, or null when it has never run. */
export async function readUpdateState(statePath: string): Promise<UpdateState | null> {
  try {
    const raw = await readFile(statePath, "utf8");
    return parseUpdateState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Terminal control sequences: colours from the updater, and the "erase line,
 * column 1" pairs that npm and drizzle-kit redraw their spinners with.
 */
const TERMINAL_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Output as a browser can show it: no control sequences, no stray carriage returns. */
export function plainOutput(raw: string): string {
  return raw.replace(TERMINAL_SEQUENCE, "").replace(/\r(?!\n)/g, "\n");
}

/** The last `maxBytes` of the update log, with terminal sequences stripped. */
export async function readUpdateLogTail(
  logPath: string,
  maxBytes: number = UPDATE_LOG_TAIL_BYTES
): Promise<string> {
  try {
    const clean = plainOutput(await readFile(logPath, "utf8"));
    return clean.length > maxBytes ? clean.slice(clean.length - maxBytes) : clean;
  } catch {
    return "";
  }
}

// ── The panel's own account of a launch ─────────────────────────────────────
//
// The updater's state directory belongs to root, so nothing below ever writes
// there. The launch log and the launch record live where the panel's user can
// write, and every step degrades instead of failing: no shared directory → a
// private one; no directory at all → no log. Starting the updater never
// depends on any of it.

/** Directories that may hold the launch log and record, best first. */
export function updateLaunchDirCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = env.GSM_UPDATE_LAUNCH_DIR?.trim();
  return explicit ? [explicit, DEFAULT_UPDATE_LAUNCH_DIR] : [DEFAULT_UPDATE_LAUNCH_DIR];
}

async function writableDirectory(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK | constants.X_OK);
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Last resort for this process: a private directory under the system temp
 * directory. `mkdtemp` creates it atomically, mode 0700, with an unguessable
 * name, so nobody else on the machine can have planted anything in it.
 */
let privateLaunchDir: string | null = null;

/**
 * The directory holding the panel's launch log and record, or null.
 *
 * A status read only reports a directory that already exists. With `create`
 * (about to launch) a missing one is created where that is allowed, and a
 * private one is made when no candidate is usable.
 */
export async function findLaunchDir(
  options: { create?: boolean; candidates?: string[] } = {}
): Promise<string | null> {
  for (const dir of options.candidates ?? updateLaunchDirCandidates()) {
    if (options.create) {
      await mkdir(dir, { recursive: true, mode: 0o750 }).catch(() => undefined);
    }
    if (await writableDirectory(dir)) return dir;
  }

  if (privateLaunchDir && (await writableDirectory(privateLaunchDir))) return privateLaunchDir;
  if (!options.create) return null;

  try {
    privateLaunchDir = await mkdtemp(join(/* turbopackIgnore: true */ tmpdir(), "gsm-panel-update-"));
    return privateLaunchDir;
  } catch {
    return null;
  }
}

export function launchLogPath(dir: string): string {
  return join(dir, UPDATE_LAUNCH_LOG_NAME);
}

export function launchRecordPath(dir: string): string {
  return join(dir, UPDATE_LAUNCH_RECORD_NAME);
}

/**
 * Open the launch log, emptied, for the updater to inherit as its output.
 *
 * Null when it cannot be opened; the caller then starts the updater without
 * one. Append mode keeps every write at the end even though the updater and
 * its children share the descriptor, and O_NOFOLLOW refuses a symlink planted
 * under the log's name. Update output can name paths and settings, so the file
 * is not world-readable.
 */
export async function openLaunchLog(dir: string): Promise<FileHandle | null> {
  try {
    return await open(
      launchLogPath(dir),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_APPEND |
        constants.O_NOFOLLOW,
      0o640
    );
  } catch {
    return null;
  }
}

/** The panel's record of the last update it launched, or null. */
export async function readUpdateLaunch(dir: string | null): Promise<UpdateLaunch | null> {
  if (!dir) return null;
  try {
    return parseUpdateLaunch(JSON.parse(await readFile(launchRecordPath(dir), "utf8")));
  } catch {
    return null;
  }
}

/** Replace the launch record atomically. False when it could not be written. */
export async function writeUpdateLaunch(dir: string, launch: UpdateLaunch): Promise<boolean> {
  const target = launchRecordPath(dir);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(launch, null, 2)}\n`, { mode: 0o640 });
    await rename(temp, target);
    return true;
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

export interface DetachedLaunch {
  /** Process id of the detached command, when the launcher reported one. */
  pid: number | null;
  /** Why the launcher itself could not be run; null when it ran. */
  error: string | null;
}

function parseProcessId(reported: string): number | null {
  const match = /^\s*(\d{1,10})\s*$/.exec(reported);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

/**
 * Run a `detachedUpdateCommand` plan and report the process it left behind.
 *
 * The launcher is a shell that backgrounds the real command and exits at once,
 * so this resolves in a few milliseconds. `logFd` becomes the output of the
 * launcher and, through it, of the detached command; `null` discards it. The
 * process id arrives on descriptor 3.
 *
 * Never rejects and never throws: a launcher that cannot be run is a result,
 * because an unhandled `error` event on a child takes the whole panel down.
 */
export function launchDetached(
  plan: { file: string; args: string[] },
  options: { cwd: string; env: NodeJS.ProcessEnv; logFd: number | null; timeoutMs?: number }
): Promise<DetachedLaunch> {
  return new Promise((resolve) => {
    let settled = false;
    let reported = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: DetachedLaunch) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const output = options.logFd ?? "ignore";
    let child: ChildProcess;
    try {
      child = spawn(/*turbopackIgnore: true*/ plan.file, plan.args, {
        detached: true,
        stdio: ["ignore", output, output, "pipe"],
        cwd: options.cwd,
        env: options.env,
      });
    } catch (e: unknown) {
      finish({ pid: null, error: e instanceof Error ? e.message : "The launcher could not be run." });
      return;
    }

    const pidPipe = child.stdio[3] as Readable | null | undefined;
    pidPipe?.on("data", (chunk: Buffer | string) => {
      if (reported.length < 64) reported += String(chunk);
    });
    pidPipe?.on("error", () => undefined);

    child.on("error", (error: Error) => finish({ pid: null, error: error.message }));
    // `close` rather than `exit`: it fires once the pid pipe has drained.
    child.on("close", () => finish({ pid: parseProcessId(reported), error: null }));

    // The launcher exits immediately. If it somehow does not, stop waiting for
    // it — the request must not hang on a shell.
    timer = setTimeout(() => {
      pidPipe?.destroy();
      finish({ pid: parseProcessId(reported), error: null });
    }, options.timeoutMs ?? 5_000);

    child.unref();
  });
}

/** State and start time from /proc/<pid>/stat; null when /proc cannot say. */
async function readProcessStat(pid: number): Promise<{ state: string; startTime: string } | null> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    // "pid (command) state ppid …": the command may itself contain spaces and
    // parentheses, so the fields are counted from the LAST closing one.
    const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    const state = fields[0];
    const startTime = fields[19]; // field 22 of the line
    if (!state || !startTime || !/^\d+$/.test(startTime)) return null;
    return { state, startTime };
  } catch {
    return null;
  }
}

/** Kernel start time of a process, to tell it from a later one with the same id. */
export async function processStartTime(pid: number): Promise<string | null> {
  return (await readProcessStat(pid))?.startTime ?? null;
}

/**
 * Is the process the panel launched still there?
 *
 * Signal 0 delivers nothing and only asks whether the process exists. The
 * updater runs as root, so for the panel's user the answer to "yes" is EPERM —
 * which still means it exists. /proc then refines the answer where it is
 * readable: a zombie has finished, and a different start time means the id now
 * belongs to an unrelated process. Where /proc hides other users' processes
 * (hidepid) the signal probe alone decides.
 */
export async function processIsAlive(pid: number, startTime: string | null): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException | null)?.code !== "EPERM") return false;
  }

  const current = await readProcessStat(pid);
  if (!current) return true;
  if (current.state === "Z" || current.state === "X") return false;
  if (startTime && current.startTime !== startTime) return false;
  return true;
}

/**
 * The launch this process made, and the directory its record belongs to.
 * Normally identical to the record on disk; it is what the status falls back
 * to when that record could not be written.
 */
let lastLaunch: { launch: UpdateLaunch; dir: string | null } | null = null;

export interface StartedUpdate {
  launch: UpdateLaunch;
  /** The raw reason the launcher could not be run, for the server log only. */
  launcherError: string | null;
}

/**
 * Start the updater, detached, and record what was started.
 *
 * Only the launcher itself failing can stop the launch. The log and the record
 * are best-effort: with nowhere to write them the updater starts all the same,
 * and the launch is remembered by this process.
 */
export async function startDetachedUpdate(options: {
  command: UpdateCommand;
  cwd: string;
  env: NodeJS.ProcessEnv;
  noBackup: boolean;
  candidates?: string[];
}): Promise<StartedUpdate> {
  const plan = detachedUpdateCommand(options.command);

  // Taken before the launch, so every state the updater publishes is newer.
  const launchedAt = new Date().toISOString();
  const dir = await findLaunchDir({ create: true, candidates: options.candidates });
  const log = dir ? await openLaunchLog(dir) : null;

  let started: DetachedLaunch;
  try {
    started = await launchDetached(plan, {
      cwd: options.cwd,
      env: options.env,
      logFd: log?.fd ?? null,
    });
  } finally {
    // The updater holds its own copy of the descriptor now.
    await log?.close().catch(() => undefined);
  }

  const launch: UpdateLaunch = {
    launchedAt,
    pid: started.pid,
    startTime: started.pid ? await processStartTime(started.pid) : null,
    noBackup: options.noBackup,
    logged: log !== null,
    // The raw reason names paths; the operator gets a pointer to the log.
    error: started.error
      ? "The panel could not run the update launcher. Check the panel's logs."
      : null,
  };

  lastLaunch = { launch, dir };
  if (dir) await writeUpdateLaunch(dir, launch);
  return { launch, launcherError: started.error };
}

/** The panel's own account of the last update it launched. */
export async function readLaunchAccount(
  options: { candidates?: string[] } = {}
): Promise<{ launch: UpdateLaunch | null; launchLog: string; launchAlive: boolean | null }> {
  const dir = await findLaunchDir({ candidates: options.candidates });
  const onDisk = await readUpdateLaunch(dir);

  // The record on disk survives the restart, so it is preferred — unless this
  // process launched something newer whose record never made it there.
  const remembered =
    lastLaunch &&
    lastLaunch.dir === dir &&
    (!onDisk || Date.parse(lastLaunch.launch.launchedAt) > Date.parse(onDisk.launchedAt))
      ? lastLaunch.launch
      : null;
  const launch = remembered ?? onDisk;

  const [launchLog, launchAlive] = await Promise.all([
    launch?.logged && dir ? readUpdateLogTail(launchLogPath(dir)) : "",
    launch?.pid ? processIsAlive(launch.pid, launch.startTime) : null,
  ]);
  return { launch, launchLog, launchAlive };
}

/** How a watched launch turned out: see `waitForLaunchToSettle`. */
export type LaunchOutcome = "gone" | "published" | "timeout";

/**
 * Watch a fresh launch until its fate is known, for `timeoutMs` at most.
 *
 *   "gone"       the launched process has exited. Whatever stopped it — sudo,
 *                the fetch, a pre-flight check — is known by the time the
 *                request is answered, instead of "started" followed by nothing.
 *   "published"  `published()` says the updater has reported its first step.
 *   "timeout"    neither yet: it is still starting.
 *
 * Returning the moment the updater publishes matters as much as noticing a
 * failure. A few steps after publishing, the updater stops the panel — the
 * process holding this request open — so the answer has to be on its way
 * before that. It cannot happen earlier: publishing comes first.
 */
export async function waitForLaunchToSettle(
  launch: UpdateLaunch,
  timeoutMs: number,
  options: { published?: () => Promise<boolean>; pollMs?: number } = {}
): Promise<LaunchOutcome> {
  if (launch.error) return "gone";
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (launch.pid && !(await processIsAlive(launch.pid, launch.startTime))) return "gone";
    if (options.published && (await options.published().catch(() => false))) return "published";
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "timeout";
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  }
}

/** PANEL_VERSION / LAST_UPDATE from `.install-info`, parsed as data. */
export async function readInstallInfoFile(installDir: string) {
  let text: string | null = null;
  try {
    text = await readFile(join(installDir, ".install-info"), "utf8");
  } catch {
    text = null;
  }
  return readInstallInfo(text);
}

/** `package.json`'s version, if it can be read. */
export async function readPackageVersion(installDir: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(join(installDir, "package.json"), "utf8"));
    const version = raw?.version;
    return typeof version === "string" && version.trim() ? version.trim().slice(0, 40) : null;
  } catch {
    return null;
  }
}

/** Short commit and branch of the checked-out code, when it is a git install. */
export async function readGitRefs(
  installDir: string
): Promise<{ commit: string | null; branch: string | null }> {
  try {
    const [commit, branch] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: installDir, timeout: 3_000 }),
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: installDir, timeout: 3_000 }),
    ]);
    return {
      commit: commit.stdout.trim().slice(0, 40) || null,
      branch: branch.stdout.trim().slice(0, 80) || null,
    };
  } catch {
    return { commit: null, branch: null };
  }
}

/**
 * Can this process run the wrapper through passwordless sudo?
 *
 * `sudo -n -l <command>` asks whether that exact command is permitted without
 * prompting. It never runs the command and never blocks on a password.
 */
export async function canRunViaSudo(wrapperPath: string): Promise<boolean> {
  try {
    await execFileAsync("sudo", ["-n", "-l", wrapperPath], { timeout: 4_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Filesystem and process helpers for the panel self-update button.
 *
 * Kept apart from `panel-update.ts` because that module is imported by the
 * Updates panel in the browser: the pure decision-making can be shared, the
 * parts that touch `node:fs` and `child_process` cannot.
 */

import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_SELF_UPDATE_WRAPPER,
  DEFAULT_UPDATE_SPAWN_LOG,
  DEFAULT_UPDATE_STATE_PATH,
  UPDATE_LOG_TAIL_BYTES,
  parseUpdateState,
  readInstallInfo,
  type UpdateState,
} from "./panel-update";

const execFileAsync = promisify(execFile);

/** Where the updater's state and stable log live; both are env-overridable. */
export function updatePaths(env: NodeJS.ProcessEnv = process.env): {
  statePath: string;
  logPath: string;
  spawnLogPath: string;
} {
  const statePath = env.GSM_UPDATE_STATE_FILE?.trim() || DEFAULT_UPDATE_STATE_PATH;
  const logPath = env.GSM_UPDATE_LOG_FILE?.trim() || join(dirname(statePath), "update.log");
  const spawnLogPath =
    env.GSM_UPDATE_SPAWN_LOG_FILE?.trim() || DEFAULT_UPDATE_SPAWN_LOG;
  return { statePath, logPath, spawnLogPath };
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
 * Best-effort write of a starting state, so the very first poll after clicking
 * shows progress instead of "no update has been run". The updater overwrites
 * this within a second; permission failures are not fatal because the script
 * runs as root and will publish its own state regardless.
 */
export async function seedUpdateState(statePath: string, state: UpdateState): Promise<void> {
  try {
    await mkdir(dirname(statePath), { recursive: true });
    const temp = `${statePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
    await rename(temp, statePath);
  } catch {
    /* the updater reports its own state */
  }
}

/** The last `maxBytes` of the update log, with terminal colours stripped. */
export async function readUpdateLogTail(
  logPath: string,
  maxBytes: number = UPDATE_LOG_TAIL_BYTES
): Promise<string> {
  try {
    const raw = await readFile(logPath, "utf8");
    const clean = raw.replace(/\u001b\[[0-9;]*m/g, "");
    return clean.length > maxBytes ? clean.slice(clean.length - maxBytes) : clean;
  } catch {
    return "";
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

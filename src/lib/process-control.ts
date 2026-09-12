import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";

export async function findBash(): Promise<string> {
  for (const p of ["/usr/bin/bash", "/bin/bash", "/usr/local/bin/bash"]) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // next candidate
    }
  }
  return "bash";
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

export function killProcess(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return Promise.resolve(false);
  }

  const terminateProcessGroup = (signal: NodeJS.Signals | number) => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      try {
        process.kill(pid, signal);
        return true;
      } catch {
        return false;
      }
    }
  };

  terminateProcessGroup("SIGTERM");

  return new Promise((resolve) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      if (!isProcessAlive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        terminateProcessGroup("SIGKILL");
        setTimeout(() => resolve(true), 500);
        return;
      }
      setTimeout(check, 200);
    };
    setTimeout(check, 200);
  });
}

export async function startDetachedScript(
  scriptPath: string,
  logFile?: string
): Promise<{ pid: number | null; alive: boolean }> {
  const bashPath = await findBash();

  // Optional console capture: stdout/stderr of the game server land in a
  // per-server log file so the panel can tail it live.
  let logFd: number | "ignore" = "ignore";
  if (logFile) {
    try {
      const { openSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dirname(logFile), { recursive: true });
      // Rotate an oversized log before appending to it.
      try {
        const { statSync, renameSync } = await import("node:fs");
        const { shouldRotateLog, CONSOLE_LOG_ROTATED_NAME } = await import("./console-log");
        if (shouldRotateLog(statSync(logFile).size)) {
          renameSync(logFile, join(dirname(logFile), CONSOLE_LOG_ROTATED_NAME));
        }
      } catch { /* no existing log: nothing to rotate */ }
      logFd = openSync(logFile, "a");
    } catch {
      logFd = "ignore"; // console capture must never block a start
    }
  }

  const child = spawn(bashPath, [scriptPath], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      NODE_ENV: process.env.NODE_ENV || "production",
      HOME: process.env.HOME || "/root",
      PATH: process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      LANG: process.env.LANG || "C.UTF-8",
      LC_ALL: process.env.LC_ALL || process.env.LANG || "C.UTF-8",
    } as NodeJS.ProcessEnv,
  });

  child.unref();
  if (typeof logFd === "number") {
    try {
      const { closeSync } = await import("node:fs");
      closeSync(logFd); // the child inherited its own copy
    } catch { /* best-effort */ }
  }

  const pid = child.pid || null;
  await new Promise((r) => setTimeout(r, 1500));
  const alive = pid ? isProcessAlive(pid) : false;
  return { pid, alive };
}

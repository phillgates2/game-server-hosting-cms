/**
 * Server backup archives.
 *
 * Shared by the backup route (manual create) and the scheduler runner
 * (scheduled backup tasks), so the archive format and exclusions cannot
 * drift between the two.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const BACKUP_NAME = /^backup-[A-Za-z0-9._-]+\.tar\.gz$/;

export interface BackupResult {
  name: string;
  path: string;
  output: string;
}

/**
 * Create `backup-<timestamp>.tar.gz` inside <installPath>/gsm-backups.
 *
 * Uses the same tar invocation as the route always has: argument array (no
 * shell), the backups folder and steamcmd artifacts excluded.
 */
export async function createServerBackup(installPath: string): Promise<BackupResult> {
  const backupDir = join(installPath, "gsm-backups");
  await mkdir(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `backup-${ts}.tar.gz`;
  const path = join(backupDir, name);

  const result = await runCmd(
    "tar",
    ["czf", path, "--exclude=gsm-backups", "--exclude=steamcmd", "--exclude=.steam", "-C", installPath, "."],
    installPath,
    600_000
  );
  return { name, path, output: result.stdout };
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;

    const child = spawn(cmd, args, { cwd });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill("SIGKILL");
        reject(new Error(`${cmd} timed out`));
      }
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e: Error) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on("close", (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

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

  // Refuse to start an archive the disk cannot hold — dying mid-tar leaves a
  // torn archive and less free space than before.
  await ensureBackupSpace(installPath);

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `backup-${ts}.tar.gz`;
  const path = join(backupDir, name);

  const result = await runCmd(
    "tar",
    ["czf", path, "--exclude=gsm-backups", "--exclude=steamcmd", "--exclude=.steam", "-C", installPath, "."],
    installPath,
    600_000
  );

  // Keep the newest N archives (panel setting) so archives from every path —
  // manual, scheduled, pre-update — cannot fill the disk over time. A prune
  // failure must never fail a backup that just succeeded.
  await pruneServerBackups(installPath).catch(() => []);

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

// ── Retention & disk-space guard ─────────────────────────────────────────────
//
// Every code path that archives a server lands files in <install>/gsm-backups:
// the manual button, the scheduled task, and the pre-update safety net. With
// pre-update backups on by default those archives pile up forever and the disk
// eventually fills — at which point backups AND updates fail. So retention is
// enforced at creation time (keep the newest N), and a free-space check runs
// before the tar starts rather than dying mid-archive with a torn file.

import { readdir, stat as fsStat, rm } from "node:fs/promises";
import { statfs } from "node:fs";
import { promisify } from "node:util";

const statfsAsync = promisify(statfs);

/** How many archives to keep per server when the panel setting is absent. */
export const DEFAULT_BACKUP_RETENTION = 10;

/** Free space required on top of the estimated archive size. */
export const BACKUP_SPACE_MARGIN_BYTES = 256 * 1024 * 1024;

/** Directory names never archived, so never counted in size estimates. */
const SIZE_EXCLUDES = new Set(["gsm-backups", "steamcmd", ".steam"]);

/**
 * Decide which archives to delete, purely from their names.
 *
 * Archive names embed an ISO timestamp (`backup-2026-09-10T…`), so a plain
 * descending string sort IS chronological order — no stat calls needed, which
 * keeps this pure and cheap. Names that do not match the panel's shape are
 * left alone: this routine must never delete something it did not create.
 */
export function selectBackupsToPrune(names: readonly string[], keep: number): string[] {
  if (keep < 0) return [];
  const ours = names.filter((n) => BACKUP_NAME.test(n)).sort((a, b) => b.localeCompare(a));
  return ours.slice(keep);
}

/**
 * Delete archives beyond the retention count. The count comes from the
 * `backup_retention_count` panel setting (0 keeps everything).
 * Returns the names removed.
 */
export async function pruneServerBackups(installPath: string): Promise<string[]> {
  const backupDir = join(installPath, "gsm-backups");
  let keep = DEFAULT_BACKUP_RETENTION;
  try {
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "backup_retention_count"))
      .limit(1);
    const n = Number.parseInt(String(row?.value ?? ""), 10);
    if (Number.isFinite(n) && n >= 0) keep = n;
  } catch {
    // No settings table yet — the default retention still protects the disk.
  }
  if (keep === 0) return [];

  let entries: string[] = [];
  try {
    entries = await readdir(backupDir);
  } catch {
    return []; // no backups dir, nothing to prune
  }

  const doomed = selectBackupsToPrune(entries, keep);
  for (const name of doomed) {
    await rm(join(backupDir, name), { force: true }).catch(() => undefined);
  }
  return doomed;
}

/**
 * Sum file sizes under `root`, skipping the never-archived directories.
 * Stops as soon as `capBytes` is exceeded — callers only need to know
 * "does it fit?", and a full walk of a 50 GB install is wasted work.
 */
export async function estimateDirBytes(root: string, capBytes: number): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const e of entries) {
      if (total > capBytes) return false;
      const full = join(dir, e.name);
      try {
        if (e.isSymbolicLink()) continue; // never follow links out of the tree
        if (e.isDirectory()) {
          if (dir === root && SIZE_EXCLUDES.has(e.name)) continue;
          if (!(await walk(full))) return false;
        } else if (e.isFile()) {
          const s = await fsStat(full).catch(() => null);
          if (s) total += s.size;
        }
      } catch {
        // unreadable entry — skip it; the estimate is deliberately approximate
      }
    }
    return true;
  };
  await walk(root);
  return total;
}

/**
 * Pure decision: is there room to write an archive of `neededBytes` given
 * `freeBytes` available? Kept separate from the filesystem so the boundary
 * cases are unit-testable.
 */
export function spacePlanForBackup(
  freeBytes: number,
  neededBytes: number,
  marginBytes: number = BACKUP_SPACE_MARGIN_BYTES
): { ok: boolean; reason?: string } {
  if (!Number.isFinite(freeBytes) || freeBytes <= 0) {
    return { ok: false, reason: "the disk reports no free space" };
  }
  const required = neededBytes + marginBytes;
  if (freeBytes < required) {
    const fmt = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;
    return {
      ok: false,
      reason: `not enough free disk space (need ~${fmt(required)}, have ${fmt(freeBytes)})`,
    };
  }
  return { ok: true };
}

/**
 * Refuse to start an archive when the disk cannot hold it. Throws with an
 * operator-readable reason; callers surface it unchanged.
 */
export async function ensureBackupSpace(installPath: string): Promise<void> {
  const fsStats = await statfsAsync(installPath).catch(() => null);
  if (!fsStats) return; // statfs unsupported — degrade to the old behaviour
  const freeBytes = fsStats.bavail * fsStats.bsize;
  // Cap the walk at "free space" — exceeding it already means "won't fit".
  const needed = await estimateDirBytes(installPath, freeBytes);
  const plan = spacePlanForBackup(freeBytes, needed);
  if (!plan.ok) {
    throw new Error(`Backup refused: ${plan.reason}. Free up space or lower the retention count in Settings.`);
  }
}

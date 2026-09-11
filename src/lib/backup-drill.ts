/**
 * Backup restore drills: an untested backup is just a hope. A drill unpacks
 * the newest archive into a scratch directory, checks it actually contains
 * files, and throws the scratch away — the live server is never touched.
 *
 * Pure verdict logic lives here; the route owns the filesystem.
 */

import { BACKUP_NAME } from "./backup";

export const DRILL_MAX_ENTRIES = 50_000;

export interface DrillEntry {
  name: string;
  size: number;
  isFile: boolean;
}

export interface DrillVerdict {
  ok: boolean;
  fileCount: number;
  dirCount: number;
  totalBytes: number;
  reason: string;
}

/** Does the extracted tree look like a real restore? */
export function assessDrill(entries: readonly DrillEntry[]): DrillVerdict {
  let fileCount = 0;
  let dirCount = 0;
  let totalBytes = 0;
  for (const e of entries) {
    if (e.isFile) {
      fileCount += 1;
      totalBytes += Math.max(0, e.size);
    } else {
      dirCount += 1;
    }
  }
  if (fileCount === 0) {
    return { ok: false, fileCount, dirCount, totalBytes, reason: "the archive extracted no files" };
  }
  if (totalBytes === 0) {
    return { ok: false, fileCount, dirCount, totalBytes, reason: "every extracted file is empty" };
  }
  return {
    ok: true,
    fileCount,
    dirCount,
    totalBytes,
    reason: `restored ${fileCount} file${fileCount === 1 ? "" : "s"} (${formatBytes(totalBytes)}) cleanly`,
  };
}

/**
 * Backups are named backup-<ISO-timestamp>.tar.gz, so lexicographic order IS
 * chronological order — the newest backup is simply the last name.
 */
export function latestBackupName(names: readonly string[]): string | null {
  const candidates = names.filter((n) => BACKUP_NAME.test(n)).sort();
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

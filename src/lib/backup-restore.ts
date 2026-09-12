/**
 * Real backup restore: replace a server's live files with a chosen backup.
 *
 * Safety rails (all enforced before anything is touched):
 *   1. The server must be stopped AND its process actually dead.
 *   2. Local nodes only in v1.
 *   3. The backup is first fully extracted into a scratch dir and assessed
 *      (same verdict logic as restore drills) — a torn archive never gets
 *      anywhere near the live directory.
 *   4. The live directory is renamed aside (cheap same-fs rename), the
 *      verified staging dir swapped in, and gsm-backups is carried across
 *      so a restore can never eat your restore points.
 */

import { resolve, sep } from "node:path";

export const RESTORE_BACKUP_NAME = /^backup-[A-Za-z0-9._-]+\.tar\.gz$/;

/** Strict name validation + traversal guard. */
export function resolveBackupPath(backupDir: string, name: unknown): string | null {
  if (typeof name !== "string" || !RESTORE_BACKUP_NAME.test(name)) return null;
  const base = resolve(backupDir);
  const full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export interface RestorePrecheck {
  status: string;
  processAlive: boolean;
  nodeIsLocal: boolean | null;
}

/** Pure gate: refuse anything that could destroy a running game or files. */
export function precheckRestore(input: RestorePrecheck): { ok: boolean; reason?: string } {
  if (input.nodeIsLocal === false) {
    return { ok: false, reason: "Restores run on local nodes only (the agent has no restore RPC yet)." };
  }
  if (input.status === "running" || input.status === "installing") {
    return { ok: false, reason: `The server is ${input.status} — stop it before restoring.` };
  }
  if (input.processAlive) {
    return { ok: false, reason: "The server process is still alive — stop it before restoring." };
  }
  return { ok: true };
}

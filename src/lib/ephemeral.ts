/**
 * Ephemeral test servers: clones with a TTL that the panel stops and
 * deletes automatically when they expire. Pure helpers keep the TTL math
 * and the delete-path safety rules unit-tested.
 */

export const TTL_MIN_HOURS = 1;
export const TTL_MAX_HOURS = 168;
export const EXPIRE_SWEEP_LIMIT = 5;

/** Clamp a requested TTL into the allowed window. */
export function clampTtlHours(hours: unknown): number | null {
  const n = Number(hours);
  if (!Number.isFinite(n) || n < TTL_MIN_HOURS) return null;
  return Math.min(TTL_MAX_HOURS, Math.floor(n));
}

export function isExpired(expiresAt: string | number | Date | null | undefined, nowMs: number): boolean {
  if (expiresAt == null) return false;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return false; // garbage stamps never auto-delete
  return t <= nowMs;
}

/** Compact "2d 3h" / "5h 12m" / "40m" for badges. */
export function describeTimeLeft(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Directories that must never be handed to a recursive delete. */
const FORBIDDEN_PATHS = new Set(["/", "/opt", "/home", "/root", "/srv", "/var", "/etc", "/usr"]);

/**
 * A delete-safe install path: absolute, not a system directory, at least
 * three segments deep (e.g. /opt/gameservers/tf2/my-server). The sweeper
 * refuses anything else rather than guessing.
 */
export function isSafeInstallPath(p: string | null | undefined): boolean {
  if (typeof p !== "string") return false;
  const trimmed = p.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("/") || trimmed.includes("..")) return false;
  if (FORBIDDEN_PATHS.has(trimmed)) return false;
  const segments = trimmed.split("/").filter(Boolean);
  return segments.length >= 3;
}

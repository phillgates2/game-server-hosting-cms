/**
 * Key hygiene: age, staleness and expiry math for API keys and panel access
 * keys. Pure so the nudges are unit-tested.
 *
 * A key is "stale" when it has not been used for STALE_UNUSED_DAYS — or was
 * never used at all and is older than STALE_NEVER_USED_DAYS (minted and
 * forgotten is the classic leak).
 */

export const STALE_UNUSED_DAYS = 90;
export const STALE_NEVER_USED_DAYS = 30;
/** Warn when a key expires within this many days. */
export const EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;

export function ageDays(createdAt: string | number | Date, nowMs: number): number {
  const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

export function daysUntilExpiry(expiresAt: string | number | Date | null, nowMs: number): number | null {
  if (expiresAt == null) return null;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - nowMs) / DAY_MS);
}

export interface KeyUsage {
  createdAt: string | number | Date;
  lastUsedAt: string | number | Date | null;
}

export function isKeyStale(
  usage: KeyUsage,
  nowMs: number,
  unusedDays: number = STALE_UNUSED_DAYS,
  neverUsedDays: number = STALE_NEVER_USED_DAYS
): boolean {
  if (usage.lastUsedAt == null) {
    return ageDays(usage.createdAt, nowMs) >= neverUsedDays;
  }
  const last = usage.lastUsedAt instanceof Date ? usage.lastUsedAt.getTime() : new Date(usage.lastUsedAt).getTime();
  if (!Number.isFinite(last)) return true; // unreadable stamp: treat as stale, safe default
  return nowMs - last >= unusedDays * DAY_MS;
}

/** One-line verdict for UI badges. */
export function keyVerdict(
  usage: KeyUsage & { expiresAt?: string | number | Date | null },
  nowMs: number
): { tone: "ok" | "warn" | "danger"; label: string } {
  const until = daysUntilExpiry(usage.expiresAt ?? null, nowMs);
  if (until !== null && until <= 0) return { tone: "danger", label: "expired" };
  if (until !== null && until <= EXPIRY_WARNING_DAYS) return { tone: "warn", label: `expires in ${until}d` };
  if (isKeyStale(usage, nowMs)) {
    return usage.lastUsedAt == null
      ? { tone: "warn", label: `never used (${ageDays(usage.createdAt, nowMs)}d old)` }
      : { tone: "warn", label: `unused ${Math.floor((nowMs - new Date(usage.lastUsedAt as string | number | Date).getTime()) / DAY_MS)}d` };
  }
  return { tone: "ok", label: "healthy" };
}

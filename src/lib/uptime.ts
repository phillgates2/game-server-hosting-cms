/**
 * Server stability tracking.
 *
 * Every few minutes the panel samples each server it believes is running on
 * a local node: is the process actually alive? Each sample appends a row to
 * server_uptime_history; "stability %" over a window is the share of samples
 * that were alive. Servers that are deliberately stopped record nothing, so
 * the number measures "while up, stayed up" — a stability score, not an
 * availability SLA.
 */

export const UPTIME_CHECK_INTERVAL_MS = 5 * 60_000;
export const UPTIME_RETENTION_DAYS = 14;
export const UPTIME_DEFAULT_HOURS = 168;
export const UPTIME_MAX_HOURS = UPTIME_RETENTION_DAYS * 24;
/** Below this, a server shows up on the Overview's attention list. */
export const UPTIME_ATTENTION_PERCENT = 99;

export interface UptimeSample {
  online: boolean;
  /** Epoch ms. */
  checkedAt: number;
}

/** Clamp the hours query param into 1..retention. */
export function clampUptimeHours(param: string | null | undefined): number {
  if (param == null || param.trim() === "") return UPTIME_DEFAULT_HOURS;
  const n = Number(param);
  if (!Number.isFinite(n)) return UPTIME_DEFAULT_HOURS;
  return Math.max(1, Math.min(UPTIME_MAX_HOURS, Math.floor(n)));
}

/** Filter samples into a window and summarise them. */
export function summarizeUptime(
  samples: readonly UptimeSample[],
  windowMs: number,
  nowMs: number
): { checks: number; onlineChecks: number; percent: number | null } {
  const cutoff = nowMs - windowMs;
  let checks = 0;
  let onlineChecks = 0;
  for (const s of samples) {
    if (s.checkedAt < cutoff) continue;
    checks += 1;
    if (s.online) onlineChecks += 1;
  }
  if (checks === 0) return { checks: 0, onlineChecks: 0, percent: null };
  return { checks, onlineChecks, percent: Math.round((onlineChecks / checks) * 10000) / 100 };
}

/** Grade wording for the UI — pure so it is pinned by tests. */
export function uptimeGrade(percent: number | null): "unknown" | "excellent" | "good" | "poor" {
  if (percent === null) return "unknown";
  if (percent >= 99.5) return "excellent";
  if (percent >= 95) return "good";
  return "poor";
}

export type UptimeGrade = ReturnType<typeof uptimeGrade>;

/** Which checks should be dropped given the retention window. */
export function uptimeCutoffMs(nowMs: number): number {
  return nowMs - UPTIME_RETENTION_DAYS * 24 * 3_600_000;
}

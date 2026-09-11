/**
 * Alert mute windows: silence host threshold alerts during planned work
 * (reboots, re-imaging, deliberate load tests) without turning the alert
 * system off.
 */

export const ALERT_MUTE_SETTING_KEY = "alert_mute_until";
export const ALERT_MUTE_MAX_HOURS = 72;

/** Is the mute window currently covering `nowMs`? */
export function isAlertMuted(muteUntilIso: string | null | undefined, nowMs: number): boolean {
  if (!muteUntilIso) return false;
  const t = new Date(muteUntilIso).getTime();
  if (!Number.isFinite(t)) return false; // garbage value: fail open to alerting
  return t > nowMs;
}

/** Clamp a requested mute length into 1..max hours. */
export function clampMuteHours(hours: unknown, maxHours: number = ALERT_MUTE_MAX_HOURS): number | null {
  const n = Number(hours);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(maxHours, Math.floor(n));
}

export function muteUntilIso(hours: number, nowMs: number): string {
  return new Date(nowMs + hours * 3_600_000).toISOString();
}

/** Compact "2h 15m" remaining, or null when not muted. */
export function describeRemainingMute(muteUntilIso: string | null | undefined, nowMs: number): string | null {
  if (!isAlertMuted(muteUntilIso, nowMs)) return null;
  const ms = new Date(muteUntilIso as string).getTime() - nowMs;
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

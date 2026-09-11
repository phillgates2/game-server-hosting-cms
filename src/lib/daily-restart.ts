/**
 * One-click daily restarts: "restart this server every day at 04:00" without
 * making the operator think in cron.
 *
 * The panel stores a normal restart task with a strict daily cron
 * ("M H * * *"); the helpers here build and recognise exactly that shape so
 * the toggle never touches custom schedules a user wrote in the Scheduler
 * panel.
 */

export const DAILY_RESTART_DEFAULT_HOUR = 4;
export const DAILY_RESTART_DEFAULT_MINUTE = 0;

export function isValidHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

export function isValidMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 59;
}

/** Build the strict daily cron, or null for out-of-range input. */
export function buildDailyRestartCron(hour: number, minute: number): string | null {
  if (!isValidHour(hour) || !isValidMinute(minute)) return null;
  return `${minute} ${hour} * * *`;
}

/**
 * Recognise a strict daily cron ("M H * * *"). Anything else — weekly days,
 * month rules, steps, lists — is a custom schedule and returns null so the
 * quick toggle leaves it alone.
 */
export function parseDailyRestartCron(
  cron: string | null | undefined
): { hour: number; minute: number } | null {
  if (typeof cron !== "string") return null;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteStr, hourStr, dom, mon, dow] = fields;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  if (!/^\d+$/.test(minuteStr) || !/^\d+$/.test(hourStr)) return null;
  const minute = Number(minuteStr);
  const hour = Number(hourStr);
  if (!isValidMinute(minute) || !isValidHour(hour)) return null;
  return { hour, minute };
}

export interface DailyRestartInput {
  ok: boolean;
  error?: string;
  value?: { enabled: boolean; hour: number; minute: number };
}

/** Validate a POST body for the daily-restart endpoint. */
export function normalizeDailyRestartInput(body: unknown): DailyRestartInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid payload" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.enabled !== "boolean") {
    return { ok: false, error: "enabled must be true or false" };
  }
  const hour = b.hour === undefined ? DAILY_RESTART_DEFAULT_HOUR : Number(b.hour);
  const minute = b.minute === undefined ? DAILY_RESTART_DEFAULT_MINUTE : Number(b.minute);
  if (!isValidHour(hour)) return { ok: false, error: "hour must be an integer 0-23" };
  if (!isValidMinute(minute)) return { ok: false, error: "minute must be an integer 0-59" };
  return { ok: true, value: { enabled: b.enabled, hour, minute } };
}
